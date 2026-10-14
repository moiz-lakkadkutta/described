import type { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { meter } from '../cost'
import { contentWords, stem } from '../contentWords'
import { textSpans, withoutSpans } from '../textClause'
import { GENERAL_WORDS, VERIFY_PROMPT_VERSION, verifySystemPrompt, verifyUserText } from '../verifyPrompt'
import { parseDescription, replyText, type Converse, type RawReply } from './04-describe'

/**
 * Visual verify pass (DESC-027, docs/decisions/0010-verify-pass.md). After a shot is described, one more Qwen3-VL Converse call
 * with the same key frames and the draft: delete every detail the frames do not show (verifyPrompt.ts). Deterministic guards
 * (checkVerified) keep the draft whenever the reply adds a word, changes on-screen text, is empty or grows. Part of the describe
 * step (describeShots calls verifyReply per shot), so the frames are already in hand and a re-run is served from cache/verify/.
 * Converse: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
 * ImageBlock: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ImageBlock.html
 */

/** On unless DESCRIBE_VERIFY=0. */
export const verifyEnabled = () => process.env.DESCRIBE_VERIFY !== '0'
/** VERIFY_MODEL_ID, else the describe model: the check needs the same eyes. */
export const verifyModelId = (describeModel: string) => process.env.VERIFY_MODEL_ID ?? describeModel
/** Room for {"text": …, "removed": […]} around a ≤ 25-word description. */
export const VERIFY_MAX_TOKENS = 200
/**
 * A sentence made from a noun list ("Dense city under hazy sky, central pyramid structure.") needs articles and a copula:
 * the reply may have this many more words than the draft, as long as it has no more content words.
 */
export const MAX_ADDED_FUNCTION_WORDS = 5

/** The request: the describe request's image blocks (same frames, same order), then the draft; temperature 0. */
export function buildVerifyRequest(system: string, frames: Uint8Array[], modelId: string, draft: string): ConverseCommandInput {
  return {
    modelId,
    system: [{ text: system }],
    messages: [{ role: 'user', content: [
      ...frames.map((bytes) => ({ image: { format: 'jpeg' as const, source: { bytes } } })),
      { text: verifyUserText(draft) },
    ] }],
    inferenceConfig: { maxTokens: VERIFY_MAX_TOKENS, temperature: 0 },
  }
}

/** sha256(verify + model id + system prompt + key-frame bytes + draft). The prompt version is in the system prompt's text. */
export function verifyCacheKey(modelId: string, system: string, frames: Uint8Array[], draft: string): string {
  const h = createHash('sha256').update(`verify v${VERIFY_PROMPT_VERSION}\0`).update(modelId).update('\0').update(system)
  for (const f of frames) h.update('\0').update(f)
  return h.update('\0draft\0').update(draft).digest('hex')
}

/** Like cachedDescribe: {work}/cache/verify/{key}.json, else one metered call; a max_tokens reply is not cached; atomic write. */
export async function cachedVerify(work: string, modelId: string, system: string, frames: Uint8Array[], draft: string, send: Converse): Promise<RawReply> {
  const file = `${work}/cache/verify/${verifyCacheKey(modelId, system, frames, draft)}.json`
  const hit = await readFile(file, 'utf8').then((t) => { try { return JSON.parse(t) as RawReply } catch { return undefined } }, () => undefined)
  if (hit && typeof hit.text === 'string' && hit.usage) return { ...hit, usage: { inputTokens: 0, outputTokens: 0 }, cached: true }
  const r = await send(buildVerifyRequest(system, frames, modelId, draft))
  const reply: RawReply = { text: replyText(r.output), usage: { inputTokens: r.usage?.inputTokens ?? 0, outputTokens: r.usage?.outputTokens ?? 0 }, stopReason: r.stopReason }
  meter()?.bedrock(modelId, reply.usage)
  if (reply.stopReason === 'max_tokens') return reply
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(reply))
  await rename(tmp, file)
  return reply
}

const VerifyJson = z.object({ text: z.string(), removed: z.array(z.string()).default([]) })
export type Verified = z.infer<typeof VerifyJson>
/** The reply's JSON: from its first "{" to its last "}" (a fence or prose around it is ignored); undefined if that is not {text, removed?}. */
export function parseVerifyReply(reply: string): Verified | undefined {
  const a = reply.indexOf('{'), b = reply.lastIndexOf('}')
  if (a < 0 || b <= a) return undefined
  try { const r = VerifyJson.safeParse(JSON.parse(reply.slice(a, b + 1))); return r.success ? r.data : undefined } catch { return undefined }
}

const clauses = (t: string) => textSpans(t).map((s) => t.slice(s.start, s.end).trim())
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length
const unique = (t: string) => [...new Set(contentWords(t))]

/**
 * The guards, in order; any failure keeps the draft (applied false, reason):
 * 1. empty — nothing left after parseDescription's cleaning (quotes, a SAME reply);
 * 2. on-screen text changed — the text clauses (../textClause: "Words appear: …", a sign that reads "…") differ from the draft's, in order;
 * 3. new words — a content word (../contentWords: not an article, linking conjunction, case preposition, auxiliary) whose stem is not
 *    in the draft and is not one of GENERAL_WORDS. A name the draft did not have is a new word, so names follow the draft;
 * 4. more content words than the draft — two general words for one specific one;
 * 5. longer than the draft by more than MAX_ADDED_FUNCTION_WORDS words.
 */
export function checkVerified(draft: string, v: Verified): { text: string; applied: boolean; reason?: string } {
  const { description: text, sameAsPrev } = parseDescription(v.text, '')
  const keep = (reason: string) => ({ text: draft, applied: false, reason })
  if (sameAsPrev || !/[\p{L}\p{N}]/u.test(text)) return keep('empty')
  if (JSON.stringify(clauses(text)) !== JSON.stringify(clauses(draft))) return keep('on-screen text changed')
  const known = new Set(contentWords(draft).map(stem))
  const added = unique(text).filter((w) => !known.has(stem(w)) && !GENERAL_WORDS.has(w))
  if (added.length) return keep(`new words: ${added.join(', ')}`)
  if (unique(text).length > unique(draft).length) return keep('more content words than the draft')
  if (words(text) > words(draft) + MAX_ADDED_FUNCTION_WORDS) return keep('longer than the draft')
  return { text, applied: true }
}

export interface VerifyShot { index: number; draft: string; text: string; removed: string[]; applied: boolean; changed: boolean; cached: boolean; reason?: string; reply?: string }
/** {work}/verify.json: what the pass did to each shot it checked, for the evaluation. usage = this run's fresh calls only. */
export interface VerifyReport { enabled: boolean; model: string; promptVersion: number; usage: { inputTokens: number; outputTokens: number }; shots: VerifyShot[] }
export const newVerifyReport = (model: string): VerifyReport => ({ enabled: verifyEnabled(), model, promptVersion: VERIFY_PROMPT_VERSION, usage: { inputTokens: 0, outputTokens: 0 }, shots: [] })
export async function writeVerifyReport(work: string, report: VerifyReport) {
  report.shots.sort((a, b) => a.index - b.index)
  await writeFile(`${work}/verify.json`, JSON.stringify(report, null, 2))
}

/**
 * One shot: the describe reply `raw` checked against its `frames`. Returns raw unchanged when the pass is off, or when the draft
 * (parseDescription of raw) is SAME, empty or only on-screen text; otherwise raw with the checked text (or the draft, if a guard
 * rejected the reply) and the verify call's usage added, so the shot's tokens cover both calls. Each checked shot goes into `report`.
 */
export async function verifyReply(work: string, index: number, frames: Uint8Array[], raw: RawReply, send: Converse, language: 'en' | 'de', report: VerifyReport, modelId: string): Promise<RawReply> {
  if (!verifyEnabled()) { report.enabled = false; return raw }
  const { description: draft, sameAsPrev } = parseDescription(raw.text, '')
  if (sameAsPrev || !draft || !withoutSpans(draft, textSpans(draft))) return raw
  const r = await cachedVerify(work, modelId, verifySystemPrompt(language), frames, draft, send)
  report.usage.inputTokens += r.usage.inputTokens
  report.usage.outputTokens += r.usage.outputTokens
  const v = parseVerifyReply(r.text)
  const checked = v ? checkVerified(draft, v) : { text: draft, applied: false, reason: 'unreadable reply' }
  report.shots.push({
    index, draft, text: checked.text, removed: v?.removed ?? [], applied: checked.applied, changed: checked.text !== draft, cached: !!r.cached,
    ...(checked.reason ? { reason: checked.reason, reply: v?.text ?? r.text } : {}),
  })
  return { ...raw, text: checked.text, usage: { inputTokens: raw.usage.inputTokens + r.usage.inputTokens, outputTokens: raw.usage.outputTokens + r.usage.outputTokens } }
}
