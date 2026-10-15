import type { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { meter } from '../cost'
import { collapseNeutral, NEUTRAL_TEXT, neutralSpans, TEXT_LABEL, textSpans, withoutSpans, type TextSpan } from '../textClause'
import { COPULA, GENERAL, GRAMMAR, LINKING, PLURAL_GENERAL, VERIFY_PROMPT_VERSION, VISIBLE, verifySystemPrompt, verifyUserText } from '../verifyPrompt'
import { parseDescription, replyText, type Converse, type RawReply } from './04-describe'

/**
 * Visual verify pass (DESC-027, docs/decisions/0010-verify-pass.md). After a shot is described, one more Qwen3-VL Converse call
 * with the same key frames and the draft: delete every detail the frames do not show (verifyPrompt.ts). Deterministic guards
 * (checkVerified) keep the draft whenever the reply adds a word, changes on-screen text (other than replacing a quote that is not fully
 * legible with the neutral "Words appear.", DESC-031), is empty or grows. Part of the describe
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

/**
 * The on-screen text of a description, in order: each quoted text clause as written (label and text), and each neutral sentence
 * ("Words appear." / "Text erscheint.", NEUTRAL_TEXT) as itself — what guard 2 compares. A neutral sentence inside a text clause
 * (`Words appear: "Words appear."`) is part of the clause.
 */
const textUnits = (t: string): (TextSpan & { neutral: boolean })[] => {
  const quoted = textSpans(t)
  const neutral = neutralSpans(t).filter((n) => !quoted.some((q) => n.start < q.end && n.end > q.start))
  return [...quoted.map((q) => ({ ...q, neutral: false })), ...neutral.map((n) => ({ ...n, neutral: true }))].sort((a, b) => a.start - b.start)
}
const unitText = (t: string, u: TextSpan) => t.slice(u.start, u.end).trim()
/** The words of an unlabelled clause before its text — its carrier action ("A man reads a note" of `A man reads a note: "MEET ME".`); '' for a labelled clause. */
function carrierOf(t: string, u: TextSpan): string {
  const clause = t.slice(u.start, u.end), at = u.body ? clause.indexOf(u.body) : -1
  if (at < 0) return ''
  return clause.slice(0, at).replace(new RegExp(TEXT_LABEL.source, 'giu'), ' ').replace(/[\s:,;"“„«»]+$/u, '').trim()
}
/**
 * Guard 2 (DESC-031): the reply's on-screen text against the draft's, unit by unit and in order. A quoted clause may stay verbatim
 * or become the language's neutral sentence (NEUTRAL_TEXT) — never a corrected quote; a neutral sentence stays as it is; adjacent
 * clauses with no carrier between them may become one neutral sentence (parseDescription collapses repeats, review L2). Any other
 * change (a word of the quote changed, a clause dropped, added, the other language's sentence) is undefined. Returns the draft
 * clauses the reply replaced, and `wordsDraft`: the draft with each replaced clause written as its carrier (the words before its
 * text, review M2) and the neutral sentence — what the word guards compare the reply against, so "A man reads a note. Words appear."
 * keeps the action of `A man reads a note: "MEET ME".` while every other word still has to come from the draft.
 */
export function textUnitsChecked(draft: string, reply: string, language: 'en' | 'de'): { replaced: string[]; wordsDraft: string } | undefined {
  const d = textUnits(draft), r = textUnits(reply)
  const neutral = NEUTRAL_TEXT[language]
  const same = (i: number, k: number) => !!d[i] && !!r[k] && r[k]!.neutral === d[i]!.neutral && unitText(reply, r[k]!) === unitText(draft, d[i]!)
  const replaced: string[] = []
  const groups: [number, number][] = [] // [first, last] draft units replaced by one neutral sentence
  let i = 0
  for (let k = 0; k < r.length; k++, i++) {
    if (same(i, k)) continue
    if (!d[i] || d[i]!.neutral || !r[k]!.neutral || unitText(reply, r[k]!) !== neutral) return undefined
    const first = i
    while (d[i + 1] && !draft.slice(d[i]!.end, d[i + 1]!.start).trim() && !carrierOf(draft, d[i + 1]!) && !same(i + 1, k + 1) && !(r[k + 1]?.neutral && !d[i + 1]!.neutral)) i++
    for (let m = first; m <= i; m++) if (!d[m]!.neutral) replaced.push(unitText(draft, d[m]!))
    groups.push([first, i])
  }
  if (i !== d.length) return undefined
  let wordsDraft = draft
  for (const [first, last] of [...groups].reverse()) {
    const before = wordsDraft.slice(0, d[first]!.start).trimEnd(), after = wordsDraft.slice(d[last]!.end).trimStart()
    const carrier = carrierOf(draft, d[first]!)
    const opens = !before || /[.!?…;]["”“»«]?$/u.test(before)
    const piece = carrier ? `${carrier}. ${neutral}` : `${opens ? '' : '. '}${neutral}`
    wordsDraft = `${before}${before && (carrier || opens) ? ' ' : ''}${piece}${after ? ` ${after}` : ''}`
  }
  return { replaced, wordsDraft }
}
/** Where each on-screen text unit sits among the description's words: the number of verify tokens before it (review L1). */
const unitPositions = (t: string) => textUnits(t).map((u) => tokens(t.slice(0, u.start)).length)
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length
/** The reply's word cap: the draft's length + MAX_ADDED_WORDS within the shot's word budget, never below the draft's own length. */
export const wordCap = (draft: string, maxWords: number) => Math.max(words(draft), Math.min(words(draft) + MAX_ADDED_WORDS, maxWords))

/** One word of a description: its exact lower-cased form and its sentence (split at . ! ? ;). */
interface Tok { w: string; s: number }
/**
 * Verify's own normalisation (round-2 review): the description without its on-screen text clauses and neutral sentences, lower-cased, cut into words
 * (letters and digits, with inner ' or -: "doesn't", "red-haired"). No stop list and no stemming: "pours" ≠ "pouring", "fires" ≠ "fire".
 */
export function tokens(t: string): Tok[] {
  return withoutSpans(t, textUnits(t)).toLowerCase().replace(/’/g, "'").split(/[.!?;…]+/u)
    .flatMap((sentence, s) => (sentence.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) ?? []).map((w) => ({ w, s })))
}
const NEGATIONS = new Set(['not', 'no', 'never', 'nobody', 'nothing', 'none', 'nowhere', 'neither', 'nor', 'cannot', 'without', 'nicht', 'nie', 'niemals', 'niemand', 'nichts', 'nirgends', 'ohne', 'weder'])
export const isNegation = (w: string) => NEGATIONS.has(w) || /n't$/.test(w) || /^kein/.test(w)
/**
 * Words a reply may not drop either (round-3 review): hedges, attempts and not-real things. Without them the sentence states a fact
 * the draft did not: "almost falls" → "falls", "a statue of a dragon" → "a dragon", "appears dead" → "is dead".
 */
const PROTECTED = new Set(['almost', 'nearly', 'tries', 'try', 'trying', 'fails', 'pretends', 'about', 'appears', 'seems', 'looks', 'statue', 'statues', 'toy', 'toys',
  'fake', 'model', 'painting', 'picture', 'image', 'drawing', 'reflection', 'shadow', 'mask', 'costume', 'dreams', 'imagines',
  'fast', 'beinahe', 'versucht', 'scheint', 'statue', 'spielzeug', 'bild', 'spiegelbild', 'schatten', 'maske'])
/** A word a reply must keep as often as the draft has it: a negation or a PROTECTED word. */
export const isKept = (w: string) => isNegation(w) || PROTECTED.has(w)
/** Rough plural test for the word a plural general word replaces: English -s (not -ss) or "people"; German -e, -en, -er, -n. */
const isPlural = (w: string, lang: 'en' | 'de') => lang === 'en' ? /[^s]s$/.test(w) || w === 'people' : /(?:e|en|er|n)$/.test(w)

export interface CheckOptions { maxWords: number; names: readonly string[]; language?: 'en' | 'de' }

/**
 * The guards, in order; any failure keeps the draft (applied false, reason). Words are verify's own exact forms (tokens), without
 * the on-screen text clauses, so a word of the text ("Words appear: DRAGON.") never licenses the same word in the description.
 * 1. empty — nothing left after parseDescription's cleaning (quotes, a SAME reply);
 * 2. on-screen text changed — the text clauses (../textClause) differ from the draft's, in order, other than a quoted clause replaced
 *    whole by the language's neutral sentence (NEUTRAL_TEXT: "Words appear." / "Text erscheint."; DESC-031, textUnitsChecked) —
 *    never a corrected quote;
 * 3. name dropped — a known name (knownNames) the draft said is missing;
 * 4. negation / protected word dropped — the reply has fewer of a negation word (not, n't, no, never, without, nicht, kein…, ohne …)
 *    or a PROTECTED word (almost, tries, appears, seems, looks, statue, toy, reflection, picture … ; fast, versucht, Spiegelbild …) than the draft;
 * 5. new words — a word that is not in the draft and is not free: free are only LINKING (with: not when the draft has "without";
 *    es / gibt: only together, "es gibt"), the GENERAL words and an added "visible" (guard 6);
 * 6. words out of order — the reply's non-free words, matched in order to the draft's by exact form, where a general word stands
 *    in for exactly one draft word in place (not a linking word, a negation or a protected word; a plural general word only for a plural word); and
 *    an added "visible" only right after is / are, for a subject that is the opening of a draft sentence (only linking words
 *    before it): "A girl searches for her dragon." may become "A girl is visible.", never "Her dragon is visible.";
 * 6b. an added is / are where a draft word was deleted (unless a place word or "visible" follows), or ending a sentence
 *    (copulaFills, PR #61 review);
 * 7. more than wordCap(draft, maxWords) words — except a pure grammar fix (DESC-033): a reply whose only added words are GRAMMAR words
 *    (a, an, the, is, are) does not count them, up to MAX_ADDED_WORDS over the draft's own length.
 */
export function checkVerified(draft: string, v: Verified, o: CheckOptions): { text: string; applied: boolean; reason?: string; textRemoved?: string[] } {
  const lang = o.language ?? 'en'
  const { description: text, sameAsPrev } = parseDescription(v.text, '')
  const keep = (reason: string) => ({ text: draft, applied: false, reason })
  if (sameAsPrev || !/[\p{L}\p{N}]/u.test(text)) return keep('empty')
  const textCheck = textUnitsChecked(draft, text, lang)
  if (!textCheck) return keep('on-screen text changed')
  const has = (t: string, name: string) => new RegExp(`(?<![\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(t)
  const lost = o.names.filter((n) => has(draft, n) && !has(text, n))
  if (lost.length) return keep(`name dropped: ${lost.join(', ')}`)
  const d = tokens(draft), r = tokens(text)
  /** The draft's words as the reply may use them: a replaced clause's carrier included (textUnitsChecked). Kept words count from `d`. */
  const dw = tokens(textCheck.wordsDraft)
  const count = (ts: Tok[], w: string) => ts.filter((t) => t.w === w).length
  const lostAll = [...new Set(d.map((t) => t.w).filter(isKept))].filter((w) => count(r, w) < count(d, w))
  const negLost = lostAll.filter(isNegation), protLost = lostAll.filter((w) => !isNegation(w))
  if (negLost.length) return keep(`negation dropped: ${negLost.join(', ')}`)
  if (protLost.length) return keep(`protected word dropped: ${protLost.join(', ')}`)

  const inDraft = new Set(dw.map((t) => t.w))
  const linking = new Set<string>(LINKING[lang])
  const general = new Set<string>(GENERAL[lang]), plural = new Set<string>(PLURAL_GENERAL[lang])
  const visible = VISIBLE[lang], copula = new Set<string>(COPULA[lang])
  const withBlocked = inDraft.has('without') || inDraft.has('ohne')
  /** Free to add at reply position i: a linking word, with "with"/"mit" not after a draft "without"/"ohne", and es/gibt only as "es gibt". */
  const freeAt = (ts: Tok[], i: number) => {
    const w = ts[i]!.w
    if (!linking.has(w)) return false
    if ((w === 'with' || w === 'mit') && withBlocked) return false
    if (w === 'es') return ts[i + 1]?.w === 'gibt'
    if (w === 'gibt') return ts[i - 1]?.w === 'es'
    return true
  }
  const added = [...new Set(r.filter((t, i) => !inDraft.has(t.w) && !freeAt(r, i) && t.w !== visible && !general.has(t.w) && !plural.has(t.w)).map((t) => t.w))]
  if (added.length) return keep(`new words: ${added.join(', ')}`)

  const draftFree = (k: number) => freeAt(dw, k) || isKept(dw[k]!.w)
  const align = new Array<number | undefined>(r.length)
  let j = 0
  for (let i = 0; i < r.length; i++) {
    const w = r[i]!.w
    let k = dw.findIndex((t, m) => m >= j && t.w === w)
    if (k < 0 && freeAt(r, i)) continue
    if (k < 0 && w === visible) {
      const why = addedVisible(r, i, dw, align, copula, (m) => freeAt(dw, m))
      if (why) return keep(`"${visible}" added ${why}`)
      continue
    }
    if (k < 0 && (general.has(w) || plural.has(w))) k = dw.findIndex((t, m) => m >= j && !draftFree(m) && (!plural.has(w) || isPlural(t.w, lang)))
    if (k < 0) return keep('words out of order')
    align[i] = k
    j = k + 1
  }
  const filled = copulaFills(r, dw, align, copula, visible, new Set([...GRAMMAR[lang]].filter((w) => !copula.has(w))), (m) => freeAt(dw, m))
  if (filled) return keep(filled)
  // L1: each text unit keeps its place among the description's words — every matched word before it came from before it in the draft
  // (linking words are left out: "a" matches the draft's first "a", wherever it was)
  const pd = unitPositions(textCheck.wordsDraft), pr = unitPositions(text)
  if (pd.length !== pr.length || pr.some((p, u) => align.some((k, i) => k !== undefined && !freeAt(r, i) && (i < p) !== (k < pd[u]!)))) return keep('on-screen text changed')
  // DESC-033: a pure grammar fix — the reply adds only GRAMMAR words (articles, is / are), no other linking word and no "visible" —
  // may go past the cap by those words, up to MAX_ADDED_WORDS over the draft: a telegraphic draft at its word budget ("Man holds
  // staff.") may still become "A man holds a staff.". Any other reply keeps the shot's cap.
  const cap = wordCap(draft, o.maxWords)
  const addedOf = (ws: readonly string[]) => ws.reduce((n, w) => n + Math.max(0, count(r, w) - count(dw, w)), 0)
  const grammar = new Set<string>(GRAMMAR[lang])
  const pureGrammar = addedOf([...linking].filter((w) => !grammar.has(w))) + addedOf([visible]) === 0
  const grammarAdded = pureGrammar ? addedOf([...grammar]) : 0
  if (words(text) - grammarAdded > cap || words(text) > Math.max(cap, words(draft) + MAX_ADDED_WORDS)) return keep(`more than ${cap} words`)
  return { text: collapseNeutral(text), applied: true, ...(textCheck.replaced.length ? { textRemoved: textCheck.replaced } : {}) }
}

/**
 * Why an added "visible" at reply position i is not allowed, or undefined: it must follow is / are (ist / sind) in its sentence,
 * after a subject (the reply's matched words before the copula in that sentence) that opens a draft sentence — every draft word from
 * that sentence's start to the subject's last word is a subject word or a free linking word.
 */
function addedVisible(r: Tok[], i: number, d: Tok[], align: (number | undefined)[], copula: Set<string>, free: (m: number) => boolean): string | undefined {
  if (i === 0 || !copula.has(r[i - 1]!.w) || r[i - 1]!.s !== r[i]!.s) return 'without "is" or "are"'
  const subject = align.slice(0, i - 1).filter((k, m): k is number => k !== undefined && r[m]!.s === r[i]!.s)
  const notOpening = 'for a subject that does not open a draft sentence'
  if (!subject.length) return notOpening
  const first = Math.min(...subject), last = Math.max(...subject), s = d[first]!.s
  if (d[last]!.s !== s) return notOpening
  for (let m = d.findIndex((t) => t.s === s); m <= last; m++) if (!subject.includes(m) && !free(m)) return notOpening
  return undefined
}

/**
 * Place words (a closed list, en and de): "X is in the light", "X is with a creature" state where X is, as the draft did; "X is staff"
 * states what X is, which the draft never said. Not at / by / over (an / am / bei / über): they belong to the action, so the deleted
 * action becomes a false place — "points at the door" → "is at the door", "is attacked by the dragon" → "is by the dragon".
 */
const PLACE_WORDS = new Set(['with', 'in', 'on', 'under', 'near', 'beside', 'behind', 'inside', 'outside', 'above', 'below', 'beneath',
  'across', 'against', 'among', 'amid', 'between', 'into', 'onto', 'through', 'around', 'mit', 'in', 'im', 'auf', 'unter', 'neben', 'hinter',
  'vor', 'zwischen', 'innerhalb', 'außerhalb'])
/**
 * PR #61 review (DESC-033): an is / are (ist / sind) in the reply — added, or kept from the draft — must not stand where a draft word was deleted — "Man holds staff."
 * → "Man is staff." turns a deleted verb into a false claim. Positional, no part-of-speech tagging: for each added copula (unaligned),
 * take the nearest aligned reply words before and after it (draft positions kPrev, kNext; kNext is the end of kPrev's draft sentence
 * when nothing follows in the reply sentence). A draft word strictly between them that is neither free (linking) nor aligned means
 * the copula fills its place (a kept copula counts from its own draft position) — unless the copula's next word other than an article is a place word or "visible" (its own guard,
 * addedVisible): "The woman … blinks slowly in dim light." → "The woman … is in dim light." keeps the approved verify deletions of
 * decision 0010. A reply sentence that ends in a copula ("A woman is.") fails always. Returns the reason, or undefined.
 */
function copulaFills(r: Tok[], d: Tok[], align: (number | undefined)[], copula: Set<string>, visible: string, articles: Set<string>, free: (m: number) => boolean): string | undefined {
  const aligned = new Set(align.filter((k): k is number => k !== undefined))
  for (let i = 0; i < r.length; i++) {
    if (!copula.has(r[i]!.w)) continue
    const why = `"${r[i]!.w}" ${align[i] === undefined ? 'added' : 'kept'} in place of a deleted word`
    if (r[i + 1]?.s !== r[i]!.s) return why
    let q = i + 1
    while (q < r.length && r[q]!.s === r[i]!.s && articles.has(r[q]!.w)) q++
    const after = r[q]?.s === r[i]!.s ? r[q]!.w : undefined
    if (after === visible || (after !== undefined && PLACE_WORDS.has(after))) continue
    let p = align[i] === undefined ? i - 1 : i // a kept copula: from its own draft position ("is attacked by" → "is by")
    while (p >= 0 && align[p] === undefined) p--
    let n = i + 1
    while (n < r.length && r[n]!.s === r[i]!.s && align[n] === undefined) n++
    const kPrev = p >= 0 ? align[p]! : -1
    const s = kPrev >= 0 ? d[kPrev]!.s : d[0]?.s
    const kNext = n < r.length && r[n]!.s === r[i]!.s ? align[n]! : d.reduce((e, t, m) => (t.s === s ? m + 1 : e), kPrev + 1)
    for (let m = kPrev + 1; m < kNext; m++) if (!free(m) && !aligned.has(m)) return why
  }
  return undefined
}

/** textRemoved: the draft's quoted on-screen text clauses the applied reply replaced with the neutral sentence (DESC-031). */
export interface VerifyShot { index: number; draft: string; text: string; removed: string[]; applied: boolean; changed: boolean; cached: boolean; reason?: string; reply?: string; textRemoved?: string[] }
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
 * (parseDescription of raw) is SAME, empty or only neutral sentences ("Words appear."); a draft of on-screen text only is checked
 * too (DESC-031: is the quote fully legible and exactly right?); otherwise raw with the checked text (or the draft, if a guard
 * rejected the reply) and the verify call's usage added, so the shot's tokens cover both calls. Each checked shot goes into `report`.
 */
export async function verifyReply(work: string, frames: Uint8Array[], raw: RawReply, send: Converse, report: VerifyReport, shot: VerifyShotInput): Promise<RawReply> {
  if (!verifyEnabled()) { report.enabled = false; return raw }
  const { description: draft, sameAsPrev } = parseDescription(raw.text, '')
  if (sameAsPrev || !draft || (!textSpans(draft).length && !tokens(draft).length)) return raw
  const r = await cachedVerify(work, report.model, verifySystemPrompt(shot.language, wordCap(draft, shot.maxWords)), frames, draft, send)
  report.usage.inputTokens += r.usage.inputTokens
  report.usage.outputTokens += r.usage.outputTokens
  const v = parseVerifyReply(r.text)
  const checked: ReturnType<typeof checkVerified> = v ? checkVerified(draft, v, shot) : { text: draft, applied: false, reason: 'unreadable reply' }
  report.shots.push({
    index: shot.index, draft, text: checked.text, removed: v?.removed ?? [], applied: checked.applied, changed: checked.text !== draft, cached: !!r.cached,
    ...(checked.reason ? { reason: checked.reason, reply: v?.text ?? r.text } : {}),
    ...(checked.textRemoved ? { textRemoved: checked.textRemoved } : {}),
  })
  return { ...raw, text: checked.text, usage: { inputTokens: raw.usage.inputTokens + r.usage.inputTokens, outputTokens: raw.usage.outputTokens + r.usage.outputTokens } }
}
