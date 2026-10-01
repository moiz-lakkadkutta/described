import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput, type ConverseOutput } from '@aws-sdk/client-bedrock-runtime'
import { execa } from 'execa'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { Ctx } from './index'
import type { Shot } from './02-shots'
import type { Gap } from './03-speech'
import { describeSystemPrompt, wordBudget } from '../prompts'

/** `tokens` = Converse input tokens (the Prisma `novaTokens` column); `outputTokens` is kept alongside for the docs/aws.md run log. */
export interface Described extends Shot { description: string; sameAsPrev: boolean; tokens: number; outputTokens: number; stopReason?: string }

/** Gate C bake-off winner (docs/decisions/0003-gate-c.md): Qwen3-VL 235B on key frames, 22/29 = 76 %, the only model ≥ 70 %. */
export const DEFAULT_DESCRIBE_MODEL_ID = 'qwen.qwen3-vl-235b-a22b'

/**
 * Qwen3-VL 235B per shot, via the Converse API with 3–6 JPEG key frames of the shot (Gate C, docs/decisions/0003-gate-c.md).
 * The request is exactly the bake-off's: frames in time order, then the task; "nothing new" is decided by parseDescription,
 * because with the previous description in the user turn the model copied it back (Gate C plan D2).
 * Qwen3 VL 235B A22B — input Text + Image, Converse supported, bedrock-runtime id `qwen.qwen3-vl-235b-a22b`, in-Region us-east-1:
 * https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-vl-235b-a22b.html
 * (conversation-inference-supported-models-features.html now redirects to the "Models at a glance" index, which links that card.)
 * Called directly per shot, no agent layer (docs/decisions/0005-describe-direct-bedrock.md).
 */
export async function describeShots(ctx: Ctx) {
  const shots = JSON.parse(await readFile(`${ctx.work}/shots.json`, 'utf8')) as Shot[]
  const gaps = JSON.parse(await readFile(`${ctx.work}/gaps.json`, 'utf8')) as Gap[]
  const client = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' })
  const modelId = process.env.DESCRIBE_MODEL_ID ?? DEFAULT_DESCRIBE_MODEL_ID
  const out: Described[] = []
  let prev = ''
  const known: string[] = [] // names heard so far — filled from words.json speaker turns in DESC-003
  for (const s of shots) {
    const system = describeSystemPrompt({ maxWords: wordBudget(s, gaps), knownNames: known, language: ctx.language })
    const r = await client.send(new ConverseCommand(buildDescribeRequest(system, await keyframes(ctx.work, s), modelId)))
    const { description, sameAsPrev } = parseDescription(replyText(r.output), prev)
    // usage.inputTokens / outputTokens — https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
    out.push({ ...s, description, sameAsPrev, tokens: r.usage?.inputTokens ?? 0, outputTokens: r.usage?.outputTokens ?? 0, stopReason: r.stopReason })
    if (!sameAsPrev && description) prev = description
  }
  await writeFile(`${ctx.work}/described.json`, JSON.stringify(out, null, 2))
}

/** The reply text: every text block joined, non-text blocks (e.g. reasoning) skipped — as the Gate C bake-off read it. */
export const replyText = (output: ConverseOutput | undefined): string =>
  output?.message?.content?.filter((c) => c.text).map((c) => c.text).join('') ?? ''

/** Grabs the shot's key frames from {work}/mezz.mp4 into {work}/frames/shot_N_k.jpg and returns their bytes in time order. */
export async function keyframes(work: string, s: Shot): Promise<Uint8Array[]> {
  await mkdir(`${work}/frames`, { recursive: true })
  const files = keyframeTimes(s.startMs, s.endMs).map((t, k) => ({ t, f: `${work}/frames/shot_${s.index}_${k}.jpg` }))
  for (const { t, f } of files) await execa('ffmpeg', keyframeArgs(`${work}/mezz.mp4`, t / 1000, f))
  return Promise.all(files.map(({ f }) => readFile(f)))
}

/** Raters found cuts land ~2 frames late (Gate C), so sampling stops this far before the shot's end. */
export const KEYFRAME_TAIL_MS = 100

/** Key-frame times (ms): 1 per second of shot, at least 3, at most 6, centred in equal slices of startMs → endMs − 100 ms (bake-off sampling). */
export function keyframeTimes(startMs: number, endMs: number): number[] {
  const n = Math.max(3, Math.min(6, Math.round((endMs - startMs) / 1000)))
  const stop = endMs - KEYFRAME_TAIL_MS > startMs ? endMs - KEYFRAME_TAIL_MS : endMs
  return Array.from({ length: n }, (_, k) => Math.round(startMs + ((stop - startMs) * (k + 0.5)) / n))
}

/** ffmpeg args for one JPEG frame at tSec: input seek (fast, frame-accurate on re-encode), ≤ 1024 wide keeping aspect, -q:v 3 — https://ffmpeg.org/ffmpeg.html#Main-options */
export const keyframeArgs = (mezz: string, tSec: number, out: string) =>
  ['-v', 'error', '-y', '-ss', tSec.toFixed(3), '-i', mezz, '-frames:v', '1', '-vf', "scale='min(1024,iw)':-2", '-q:v', '3', out]

/**
 * The Converse request, as sent in the Gate C bake-off: image blocks (JPEG bytes) in time order, then the task; temperature 0, 120 tokens.
 * ImageBlock — https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ImageBlock.html
 */
export function buildDescribeRequest(system: string, frames: Uint8Array[], modelId: string): ConverseCommandInput {
  return {
    modelId,
    system: [{ text: system }],
    messages: [{ role: 'user', content: [
      ...frames.map((bytes) => ({ image: { format: 'jpeg' as const, source: { bytes } } })),
      { text: 'These are frames from one shot, in time order. Describe this shot.' },
    ] }],
    inferenceConfig: { maxTokens: 120, temperature: 0 },
  }
}

const normalize = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim()
/** Word-set Jaccard similarity of two normalized texts. */
const jaccard = (a: string, b: string) => { const A = new Set(a.split(' ')), B = new Set(b.split(' ')); const both = [...A].filter((w) => B.has(w)).length; return both / (A.size + B.size - both) }

/**
 * Cleans one model reply: strips quotes/fences/whitespace, treats a leading SAME or a (near-)verbatim repeat of the previous
 * description (word-set Jaccard ≥ 0.8) as "nothing new", and drops a "Words appear:" clause of more than 8 words (invented text).
 */
export function parseDescription(raw: string, prev: string): { description: string; sameAsPrev: boolean } {
  let text = raw.replace(/```[a-z]*/gi, ' ').replace(/\s+/g, ' ').trim()
  const q = /^["'`“‘]([^"`“”]+)["'`”’]$/.exec(text) // one wrapping pair only: '"A." Then "B."' keeps its inner quotes
  if (q) text = q[1]!.trim()
  if (/^SAME\b/.test(text)) { if (text.replace(/^SAME\.?/, '').trim()) console.warn('describe: dropped text after SAME:', text); return { description: '', sameAsPrev: true } }
  text = text.replace(/Words appear:\s*(?:["“]([^"”]*)["”]|([^.]*))\.?\s*/gi, (m, quoted?: string, bare?: string) => {
    if ((quoted ?? bare ?? '').trim().split(/\s+/).filter(Boolean).length <= 8) return m
    console.warn('describe: dropped on-screen text longer than 8 words:', m.trim())
    return ''
  }).replace(/\s*Words appear:\s*$/i, '').trim()
  const a = normalize(text), b = normalize(prev)
  return { description: text, sameAsPrev: !!a && !!b && (a === b || jaccard(a, b) >= 0.8) }
}
