import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput, type ConverseCommandOutput, type ConverseOutput } from '@aws-sdk/client-bedrock-runtime'
import { createHash, randomUUID } from 'node:crypto'
import { execa } from 'execa'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Ctx } from './index'
import type { Shot } from './02-shots'
import type { Gap, Word } from './03-speech'
import { describeSystemPrompt, wordBudget } from '../prompts'
import { meter } from '../cost'

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
 * Called directly per shot, no agent layer (docs/decisions/0005-describe-direct-bedrock.md); shots run DESCRIBE_CONCURRENCY at a time,
 * replies are cached per shot (cachedDescribe), and the "nothing new" dedupe runs afterwards in time order (dedupe).
 */
export async function describeShots(ctx: Ctx, send: Converse = bedrockConverse(ctx.signal)) {
  const shots = JSON.parse(await readFile(`${ctx.work}/shots.json`, 'utf8')) as Shot[]
  const gaps = JSON.parse(await readFile(`${ctx.work}/gaps.json`, 'utf8')) as Gap[]
  const words = JSON.parse(await readFile(`${ctx.work}/words.json`, 'utf8').catch(() => '[]')) as Word[]
  const modelId = process.env.DESCRIBE_MODEL_ID ?? DEFAULT_DESCRIBE_MODEL_ID
  const videoMs = await videoDurationMs(`${ctx.work}/mezz.mp4`)
  const replies = await mapLimit(shots, describeConcurrency(), async (s) => {
    const system = describeSystemPrompt({ maxWords: wordBudget(s, gaps), knownNames: knownNames(words, s.startMs, ctx.language), language: ctx.language })
    return cachedDescribe(ctx.work, modelId, system, await keyframes(ctx.work, s, videoMs), send)
  }, ctx.signal)
  console.log(`describe: ${shots.length} shots, ${replies.filter((r) => r.cached).length} from cache`)
  await writeFile(`${ctx.work}/described.json`, JSON.stringify(dedupe(shots, replies), null, 2))
}

/** Converse via the SDK, aborted with the job's signal; tests inject their own. */
export type Converse = (input: ConverseCommandInput) => Promise<Pick<ConverseCommandOutput, 'output' | 'usage' | 'stopReason'>>
export const bedrockConverse = (abortSignal?: AbortSignal): Converse => { const c = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' }); return (i) => c.send(new ConverseCommand(i), { abortSignal }) }

/** Shots described at once (DESCRIBE_CONCURRENCY, default 4) — Converse quotas are per minute, so keep this small. */
export const describeConcurrency = () => Math.max(1, Number(process.env.DESCRIBE_CONCURRENCY) || 4)

/**
 * Like Promise.all(items.map(fn)) with at most n in flight; results keep the input order. After the first failure (or an abort)
 * no new item starts, and it rejects only once every running item has settled, so nothing keeps calling Bedrock after the step
 * has returned and its meter was read.
 */
export async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0, failed = false
  const runners = await Promise.allSettled(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (!failed && next < items.length) {
      signal?.throwIfAborted()
      const i = next++
      try { out[i] = await fn(items[i]!) } catch (e) { failed = true; throw e }
    }
  }))
  const err = runners.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (err) throw err.reason
  return out
}

/** One shot's raw reply as read from Bedrock or the cache. */
export interface RawReply { text: string; usage: { inputTokens: number; outputTokens: number }; stopReason?: string; cached?: boolean }

/** Bump when buildDescribeRequest's fixed parts (user text, inferenceConfig) or replyText change, so old replies stop matching. */
export const DESCRIBE_CACHE_VERSION = 1
/** sha256(cache version + model id + system prompt + key-frame bytes): the request's only variable inputs. */
export function describeCacheKey(modelId: string, system: string, frames: Uint8Array[]): string {
  const h = createHash('sha256').update(`v${DESCRIBE_CACHE_VERSION}\0`).update(modelId).update('\0').update(system)
  for (const f of frames) h.update('\0').update(f)
  return h.digest('hex')
}

/**
 * Raw reply for one shot from {work}/cache/describe/{key}.json, else one Converse call whose reply + usage is stored there.
 * A cache hit costs nothing and reports 0 tokens for this run (the original usage stays in the file); a miss adds its usage to
 * the job's meter. A reply cut off at max_tokens is not cached. An unreadable or truncated file is a miss; writes are atomic
 * (temp file + rename), so a crash mid-write never leaves one.
 */
export async function cachedDescribe(work: string, modelId: string, system: string, frames: Uint8Array[], send: Converse): Promise<RawReply> {
  const file = `${work}/cache/describe/${describeCacheKey(modelId, system, frames)}.json`
  const hit = await readFile(file, 'utf8').then((t) => { try { return JSON.parse(t) as RawReply } catch { return undefined } }, () => undefined)
  if (hit && typeof hit.text === 'string' && hit.usage) return { ...hit, usage: { inputTokens: 0, outputTokens: 0 }, cached: true }
  const r = await send(buildDescribeRequest(system, frames, modelId))
  // usage.inputTokens / outputTokens — https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
  const reply: RawReply = { text: replyText(r.output), usage: { inputTokens: r.usage?.inputTokens ?? 0, outputTokens: r.usage?.outputTokens ?? 0 }, stopReason: r.stopReason }
  meter()?.bedrock(modelId, reply.usage)
  if (reply.stopReason === 'max_tokens') return reply
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(reply))
  await rename(tmp, file)
  return reply
}

/** Second, sequential pass: parseDescription compares each reply with the previous voiced description in time order. */
export function dedupe(shots: Shot[], replies: RawReply[]): Described[] {
  let prev = ''
  return shots.map((s, i) => {
    const r = replies[i]!
    const { description, sameAsPrev } = parseDescription(r.text, prev)
    if (!sameAsPrev && description) prev = description
    return { ...s, description, sameAsPrev, tokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, stopReason: r.stopReason }
  })
}

/** Capitalised words that are not names when Transcribe writes them mid-sentence ("So, What brings you…") or open a sentence as a call ("Wait!"). */
const NOT_NAMES = new Set(['i', "i'm", "i'll", "i've", "i'd", 'ok', 'okay', 'what', 'who', 'where', 'when', 'why', 'how', 'the', 'a', 'an', 'and', 'but', 'or', 'so', 'yes', 'no', 'oh', 'hey', 'god', 'mr', 'mrs', 'ms', 'dr', 'sir', 'miss', 'mister', 'lady', 'lord', 'king', 'queen', 'captain', 'mom', 'dad', 'mum',
  'wait', 'stop', 'help', 'come', 'look', 'listen', 'run', 'go', 'please', 'thanks', 'hello', 'hi', 'sorry', 'well', 'now', 'here', 'there', 'quick', 'careful', 'really', 'right', 'good', 'great', 'fine', 'nope', 'yeah', 'ah', 'uh', 'um', 'wow', 'father', 'mother', 'brother', 'sister', 'friend', 'everyone', 'guys'])
/** German: the pronouns, calls and kinship words that open a sentence with a comma ("Danke, …", "Komm, …"). */
const NOT_NAMES_DE = new Set(['ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'ja', 'nein', 'doch', 'hallo', 'danke', 'bitte', 'herr', 'frau', 'gott', 'mama', 'papa', 'vater', 'mutter', 'also', 'gut', 'komm', 'warte', 'hilfe', 'los', 'schnell', 'hier', 'dort', 'jetzt', 'na', 'ach', 'oh', 'hey', 'nun', 'okay', 'freund', 'leute'])
const HONORIFIC = /^(mr|mrs|ms|dr|st)\.$/i
/** German words after which a capitalised word is someone's name ("Ich heiße Sintel", "Mein Name ist Sintel"). */
const DE_NAME_CUE = new Set(['heiße', 'heisse', 'heißt', 'heisst', 'bin', 'ist'])
/** German: a name must be heard this often before the shot — every German noun is capitalised, so one mention is not enough. */
export const DE_MIN_MENTIONS = 2

/**
 * Names spoken before beforeMs, in the order first heard, each once. Never a common capitalised word, nor a word also heard lowercase.
 * - English: a capitalised word that does not open a sentence or a speaker turn — or that does open one as a call, directly followed
 *   by `,` `!` or `?` ("Sintel, wait.", "Scales!").
 * - German (every noun is capitalised): a capitalised word right after heiße/heißt/bin/ist ("Ich heiße Sintel", "Name ist Sintel"),
 *   or opening a sentence or turn with a vocative comma ("Sintel, warte."); and in both cases heard ≥ DE_MIN_MENTIONS times before beforeMs.
 */
export function knownNames(words: Word[], beforeMs: number, language: 'en' | 'de'): string[] {
  const bare = (t: string) => t.replace(/[^\p{L}\p{N}'-]/gu, '').replace(/'s$/i, '')
  const lower = new Set(words.map((w) => bare(w.text)).filter((t) => /^\p{Ll}/u.test(t)).map((t) => t.toLowerCase()))
  const heard = words.filter((w) => w.end * 1000 <= beforeMs)
  const mentions = new Map<string, number>()
  for (const w of heard) mentions.set(bare(w.text), (mentions.get(bare(w.text)) ?? 0) + 1)
  const common = language === 'de' ? NOT_NAMES_DE : NOT_NAMES
  const out: string[] = []
  heard.forEach((w, i) => {
    const p = heard[i - 1]
    const opens = !p || p.speaker !== w.speaker || (/[.?!]$/.test(p.text) && !HONORIFIC.test(p.text))
    const t = bare(w.text)
    if (!/^\p{Lu}\p{Ll}/u.test(t) || common.has(t.toLowerCase()) || NOT_NAMES.has(t.toLowerCase()) || lower.has(t.toLowerCase()) || out.includes(t)) return
    if (language === 'en') { if (opens && !/[,!?]$/.test(w.text)) return }
    else {
      const afterCue = !!p && !opens && DE_NAME_CUE.has(p.text.replace(/[^\p{L}]/gu, '').toLowerCase())
      const vocative = opens && /,$/.test(w.text)
      if (!(afterCue || vocative) || (mentions.get(t) ?? 0) < DE_MIN_MENTIONS) return
    }
    out.push(t)
  })
  return out
}

/** The reply text: every text block joined, non-text blocks (e.g. reasoning) skipped — as the Gate C bake-off read it. */
export const replyText = (output: ConverseOutput | undefined): string =>
  output?.message?.content?.filter((c) => c.text).map((c) => c.text).join('') ?? ''

/**
 * Grabs the shot's key frames from {work}/mezz.mp4 into {work}/frames/shot_N_k.jpg and returns their bytes in time order.
 * Times are clamped to the mezz video stream (videoMs). Each target is removed first and must exist afterwards: ffmpeg exits 0
 * without writing a frame when the seek lands past the last frame, and a stale JPEG from an earlier run would be sent instead.
 */
export async function keyframes(work: string, s: Shot, videoMs: number): Promise<Uint8Array[]> {
  await mkdir(`${work}/frames`, { recursive: true })
  const files = clampKeyframeTimes(keyframeTimes(s.startMs, s.endMs), videoMs).map((t, k) => ({ t, f: `${work}/frames/shot_${s.index}_${k}.jpg` }))
  for (const { t, f } of files) {
    await rm(f, { force: true })
    const { stderr } = await execa('ffmpeg', keyframeArgs(`${work}/mezz.mp4`, t / 1000, f))
    if (!(await stat(f).catch(() => null))) throw new Error(`keyframes: ffmpeg wrote no frame for shot ${s.index} at ${t} ms (${f}): ${stderr || '(no stderr)'}`)
  }
  return Promise.all(files.map(({ f }) => readFile(f)))
}

/**
 * Duration (ms) of the mezz's first video stream, from ffprobe of mezz.mp4 — not probe.json, which describes source.mp4 and
 * whose format.duration (what shots end at) is the longest stream, often the audio. https://ffmpeg.org/ffprobe.html
 */
export async function videoDurationMs(mezz: string): Promise<number> {
  const { stdout } = await execa('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'default=noprint_wrappers=1:nokey=1', mezz])
  return parseVideoDurationMs(stdout)
}
/** Pure (tested): ffprobe's `stream=duration` value in seconds → whole ms; throws on N/A or empty. */
export function parseVideoDurationMs(stdout: string): number {
  const sec = parseFloat(stdout.trim().split('\n')[0] ?? '')
  if (!Number.isFinite(sec) || sec <= 0) throw new Error(`ffprobe gave no video stream duration: ${JSON.stringify(stdout)}`)
  return Math.round(sec * 1000)
}

/** A seek this close to the end of the video stream can land after the last frame (≥ 1 frame down to 10 fps). */
export const KEYFRAME_END_GUARD_MS = 100
/** Pure (tested): no key-frame time later than videoMs − KEYFRAME_END_GUARD_MS (never below 0). */
export const clampKeyframeTimes = (times: number[], videoMs: number) => times.map((t) => Math.min(t, Math.max(0, videoMs - KEYFRAME_END_GUARD_MS)))

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
