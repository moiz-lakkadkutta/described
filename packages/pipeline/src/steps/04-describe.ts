import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'
import { readFile, writeFile } from 'node:fs/promises'
import { upload } from '../s3'
import type { Ctx } from './index'
import type { Shot } from './02-shots'
import type { Gap } from './03-speech'
import { describeSystemPrompt, wordBudget } from '../prompts'

/** `tokens` = Converse input tokens (the Prisma `novaTokens` column); `outputTokens` is kept alongside for the docs/aws.md run log. */
export interface Described extends Shot { description: string; sameAsPrev: boolean; tokens: number; outputTokens: number; stopReason?: string }

/**
 * Nova Pro per shot, via the Converse API with the shot clip as an S3 URI (us-east-1 ingest bucket).
 * The model sees only the clip (video first, then the task); "nothing new" is decided by parseDescription, because
 * with the previous description in the user turn Nova copied it back (Gate C plan D2).
 * Orchestration note: this is the function the Strands agent calls as a tool (see ../agent).
 */
export async function describeShots(ctx: Ctx) {
  const shots = JSON.parse(await readFile(`${ctx.work}/shots.json`, 'utf8')) as Shot[]
  const gaps = JSON.parse(await readFile(`${ctx.work}/gaps.json`, 'utf8')) as Gap[]
  const ingest = process.env.S3_BUCKET_NOVA_INGEST!
  const client = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' })
  const out: Described[] = []
  let prev = ''
  const known: string[] = [] // names heard so far — filled from words.json speaker turns in DESC-003
  for (const s of shots) {
    const key = `${ctx.slug}/shot_${s.index}.mp4`
    // Nova reads the clip by S3 URI from us-east-1 and needs Content-Type set — https://docs.aws.amazon.com/nova/latest/userguide/modalities-video.html
    await upload(`${ctx.work}/shot_${s.index}.mp4`, `s3://${ingest}/${key}`, { ContentType: 'video/mp4', region: 'us-east-1' })
    const budget = wordBudget(s, gaps)
    const r = await client.send(new ConverseCommand({
      modelId: process.env.NOVA_PRO_MODEL_ID ?? 'amazon.nova-pro-v1:0',
      system: [{ text: describeSystemPrompt({ maxWords: budget, knownNames: known, language: ctx.language }) }],
      messages: [{ role: 'user', content: [
        { video: { format: 'mp4', source: { s3Location: { uri: `s3://${ingest}/${key}` } } } },
        { text: 'Describe this shot.' },
      ] }],
      inferenceConfig: { maxTokens: 120, temperature: 0 },
    }))
    const { description, sameAsPrev } = parseDescription(r.output?.message?.content?.[0]?.text ?? '', prev)
    // usage.inputTokens / outputTokens — https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
    out.push({ ...s, description, sameAsPrev, tokens: r.usage?.inputTokens ?? 0, outputTokens: r.usage?.outputTokens ?? 0, stopReason: r.stopReason })
    if (!sameAsPrev && description) prev = description
  }
  await writeFile(`${ctx.work}/described.json`, JSON.stringify(out, null, 2))
}

const normalize = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim()
/** Word-set Jaccard similarity of two normalized texts. */
const jaccard = (a: string, b: string) => { const A = new Set(a.split(' ')), B = new Set(b.split(' ')); const both = [...A].filter((w) => B.has(w)).length; return both / (A.size + B.size - both) }

/**
 * Cleans one Nova reply: strips quotes/fences/whitespace, treats a leading SAME or a (near-)verbatim repeat of the previous
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
