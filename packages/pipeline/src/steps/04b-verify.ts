import type { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { meter } from '../cost'
import { contentWords, stem } from '../contentWords'
import { textSpans, withoutSpans } from '../textClause'
import { GENERAL_WORDS, PLURAL_GENERAL_WORDS, VERIFY_PROMPT_VERSION, verifySystemPrompt, verifyUserText } from '../verifyPrompt'
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
 * A sentence made from a noun list ("Dense city under hazy sky, central pyramid structure.") needs an article and a copula:
 * the reply may have this many more words than the draft (within the shot's word budget), as long as it adds no content word.
 */
export const MAX_ADDED_WORDS = 3

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

/**
 * sha256(VERIFY_PROMPT_VERSION + model id + system prompt + key-frame bytes + draft). The system prompt (which carries the word cap) is
 * hashed as text; the user text, max tokens and temperature are not — bump VERIFY_PROMPT_VERSION when those change.
 */
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
const unique = (ws: string[]) => [...new Set(ws)]
/** The description words of t: its content words (../contentWords) with the on-screen text clauses left out. */
const described = (t: string) => contentWords(withoutSpans(t, textSpans(t)))
/** The reply's word cap: the draft's length + MAX_ADDED_WORDS within the shot's word budget, never below the draft's own length. */
export const wordCap = (draft: string, maxWords: number) => Math.max(words(draft), Math.min(words(draft) + MAX_ADDED_WORDS, maxWords))
const isPlural = (w: string) => /[^s]s$/.test(w) || w === 'people'

/**
 * True when reply (content words) is a subsequence of draft (content words) by stem, where a general word stands in for exactly
 * one draft word at its position (a plural general word only for a plural draft word). Deleting, generalising and joining a noun
 * list into a sentence keep the order; "The girl hands the man a sword" from "The man hands the girl a sword" does not.
 */
export function inDraftOrder(reply: readonly string[], draft: readonly string[]): boolean {
  const d = draft.map(stem)
  const memo = new Map<number, boolean>()
  const fits = (i: number, j: number): boolean => {
    if (i === reply.length) return true
    if (j === draft.length) return false
    const key = i * (draft.length + 1) + j
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    const w = reply[i]!
    const here = stem(w) === d[j] || GENERAL_WORDS.has(w) || (PLURAL_GENERAL_WORDS.has(w) && isPlural(draft[j]!))
    const r = (here && fits(i + 1, j + 1)) || fits(i, j + 1)
    memo.set(key, r)
    return r
  }
  return fits(0, 0)
}

export interface CheckOptions { maxWords: number; names: readonly string[] }
/**
 * The guards, in order; any failure keeps the draft (applied false, reason). Description words are counted without the on-screen
 * text clauses, so a word of the text ("Words appear: DRAGON.") never licenses the same word in the description.
 * 1. empty — nothing left after parseDescription's cleaning (quotes, a SAME reply);
 * 2. on-screen text changed — the text clauses (../textClause: "Words appear: …", a sign that reads "…") differ from the draft's, in order;
 * 3. name dropped — a known name (knownNames) the draft said is missing;
 * 4. new words — a content word (../contentWords: not an article, linking conjunction, case preposition, auxiliary) whose stem is not
 *    in the draft and is not a general word. A name the draft did not have is a new word, so names follow the draft;
 * 5. words out of order — the content words are not a subsequence of the draft's (inDraftOrder): no swapped roles, sides or attributes;
 * 6. more content words than the draft — two general words for one specific one;
 * 7. more than wordCap(draft, maxWords) words.
 */
export function checkVerified(draft: string, v: Verified, o: CheckOptions): { text: string; applied: boolean; reason?: string } {
  const { description: text, sameAsPrev } = parseDescription(v.text, '')
  const keep = (reason: string) => ({ text: draft, applied: false, reason })
  if (sameAsPrev || !/[\p{L}\p{N}]/u.test(text)) return keep('empty')
  if (JSON.stringify(clauses(text)) !== JSON.stringify(clauses(draft))) return keep('on-screen text changed')
  const has = (t: string, name: string) => new RegExp(`(?<![\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(t)
  const lost = o.names.filter((n) => has(draft, n) && !has(text, n))
  if (lost.length) return keep(`name dropped: ${lost.join(', ')}`)
  const d = described(draft), r = described(text)
  const known = new Set(d.map(stem))
  const added = unique(r).filter((w) => !known.has(stem(w)) && !GENERAL_WORDS.has(w) && !PLURAL_GENERAL_WORDS.has(w))
  if (added.length) return keep(`new words: ${added.join(', ')}`)
  if (!inDraftOrder(r, d)) return keep('words out of order')
  if (unique(r).length > unique(d).length) return keep('more content words than the draft')
  const cap = wordCap(draft, o.maxWords)
  if (words(text) > cap) return keep(`more than ${cap} words`)
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

/** Per shot: which shot (for the report), its language, its describe word budget and the names known before it (knownNames). */
export interface VerifyShotInput { index: number; language: 'en' | 'de'; maxWords: number; names: readonly string[] }
/**
 * One shot: the describe reply `raw` checked against its `frames`. Returns raw unchanged when the pass is off, or when the draft
 * (parseDescription of raw) is SAME, empty or only on-screen text; otherwise raw with the checked text (or the draft, if a guard
 * rejected the reply) and the verify call's usage added, so the shot's tokens cover both calls. Each checked shot goes into `report`.
 */
export async function verifyReply(work: string, frames: Uint8Array[], raw: RawReply, send: Converse, report: VerifyReport, shot: VerifyShotInput): Promise<RawReply> {
  if (!verifyEnabled()) { report.enabled = false; return raw }
  const { description: draft, sameAsPrev } = parseDescription(raw.text, '')
  if (sameAsPrev || !draft || !withoutSpans(draft, textSpans(draft))) return raw
  const r = await cachedVerify(work, report.model, verifySystemPrompt(shot.language, wordCap(draft, shot.maxWords)), frames, draft, send)
  report.usage.inputTokens += r.usage.inputTokens
  report.usage.outputTokens += r.usage.outputTokens
  const v = parseVerifyReply(r.text)
  const checked = v ? checkVerified(draft, v, shot) : { text: draft, applied: false, reason: 'unreadable reply' }
  report.shots.push({
    index: shot.index, draft, text: checked.text, removed: v?.removed ?? [], applied: checked.applied, changed: checked.text !== draft, cached: !!r.cached,
    ...(checked.reason ? { reason: checked.reason, reply: v?.text ?? r.text } : {}),
  })
  return { ...raw, text: checked.text, usage: { inputTokens: raw.usage.inputTokens + r.usage.inputTokens, outputTokens: raw.usage.outputTokens + r.usage.outputTokens } }
}
