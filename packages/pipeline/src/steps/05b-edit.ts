import { readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Ctx } from './index'
import type { Described } from './04-describe'
import type { Word } from './03-speech'
import { EXTENDED_WORDS, type FitCue } from './05-fit'
import { NEXT_CUE_SPACING_MS } from './06-voice'
import { editRequest, editModelId, shortenEditWithNovaLite, type EditConverse, bedrockEditSend } from '../prompts'
import { meter } from '../cost'

/**
 * Scene-level edit pass (DESC-018, docs/decisions/0006-scene-edit-pass.md): after fit, before voice. Every shot was described and
 * placed on its own; the viewer hears the voiced cues in a row, with the dropped shots missing. One text-only Nova Lite call per
 * window of cues sees the whole sequence — every shot description (voiced or dropped), each voiced cue's window and word budget,
 * the dialogue — and returns revised text for voiced cues only: a dropped fact folded into the next cue when it fits, repetition
 * across consecutive cues removed, continuity words. Timing is fit's: the pass never adds, drops, moves or reorders a cue.
 *
 * Every edit passes a deterministic guard before it replaces the original (applyEdits): index known and unedited so far, one
 * line, within the cue's budget, a "Words appear:" clause kept verbatim (and none added), no content word outside the shot
 * descriptions between the previous voiced cue and this cue's shot plus the two cues' own text (faithful), and no fact of the
 * original lost unless the previous cue said it. An unreadable reply, or a failed call, keeps every original cue (the step is an
 * improvement, never a dependency). DESCRIBE_EDIT=0 skips the call so an evaluation can compare.
 * Writes cues.json back (same length and order) and edit.json (what changed, what was rejected, usage) for the evaluation.
 */
export async function editCues(ctx: Ctx, send: EditConverse = bedrockEditSend) {
  const cues = JSON.parse(await readFile(`${ctx.work}/cues.json`, 'utf8')) as FitCue[]
  if (process.env.DESCRIBE_EDIT === '0') { console.log('edit: skipped (DESCRIBE_EDIT=0)'); await writeFile(`${ctx.work}/edit.json`, JSON.stringify({ skipped: true, applied: [], rejected: [] })); return }
  const shots = JSON.parse(await readFile(`${ctx.work}/described.json`, 'utf8')) as Described[]
  const words = JSON.parse(await readFile(`${ctx.work}/words.json`, 'utf8').catch(() => '[]')) as Word[]
  const report = await editScene(cues, shots, words, ctx.language, send, ctx.signal)
  console.log(`edit: ${report.applied.length} of ${cues.length} cues revised, ${report.rejected.length} edits rejected`)
  await writeFile(`${ctx.work}/cues.json`, JSON.stringify(report.cues, null, 2))
  await writeFile(`${ctx.work}/edit.json`, JSON.stringify({ model: report.model, applied: report.applied, rejected: report.rejected, usage: report.usage }, null, 2))
}

/** Cues per Converse call: an output of up to ~30 edits stays well inside Nova Lite's reply budget; a title's cues go in order. */
export const EDIT_CHUNK_CUES = 30
/**
 * Words per second the edit budget assumes. fit budgets at WPS (2.67); Polly Joanna neural on sintel-90-150-r2 ran at 2.13 words/s net
 * of the 150 ms lead-in (43 words in 20.2 s), and sentence ends cost ~0.4 s each, so a cue lengthened to fit's budget would often
 * overrun its limit and be shortened or dropped by 06-voice. 2.2 keeps a lengthened cue inside voice's tolerance.
 */
export const EDIT_WPS = 2.2

export interface EditReport { cues: FitCue[]; applied: { i: number; from: string; to: string }[]; rejected: { i: number; text: string; reason: string }[]; model: string; usage: { inputTokens: number; outputTokens: number } }

/** Shortens `text` to maxWords keeping every fact of `keep` (the cue's original text): one Nova Lite call by default; tests inject their own. */
export type Shorten = (text: string, maxWords: number, keep: string) => Promise<string> | string

/**
 * The pass over one title's cues, pure apart from `send` and `shorten`; fixtures in test/edit.test.ts.
 * An edit over its budget gets one shortening call (the model appends a dropped description whole rather than compressing it — probe
 * round 5: 17 words into 11), and the shortened text goes through the same guards; it is dropped when it still does not fit.
 */
export async function editScene(cues: FitCue[], shots: Described[], words: Word[], language: 'en' | 'de', send: EditConverse, signal?: AbortSignal, shorten: Shorten = (t, n, keep) => shortenEditWithNovaLite(t, n, keep, language)): Promise<EditReport> {
  const model = editModelId()
  const usage = { inputTokens: 0, outputTokens: 0 }
  const report: EditReport = { cues: cues.map((c) => ({ ...c })), applied: [], rejected: [], model, usage }
  if (!cues.length) return report
  const budgets = editBudgets(cues)
  for (let from = 0; from < cues.length; from += EDIT_CHUNK_CUES) {
    const to = Math.min(cues.length, from + EDIT_CHUNK_CUES)
    const window = cues.slice(from, to).map((c, k) => ({ ...c, i: from + k, budget: budgets[from + k]! }))
    const prevShot = from ? cues[from - 1]!.shotIndex : -1
    const lastShot = cues[to - 1]!.shotIndex
    const shotsIn = shots.filter((s) => s.index > prevShot && s.index <= lastShot && !s.sameAsPrev && s.description)
    const heard = from ? report.cues[from - 1]!.text : undefined
    const input = { language, shots: shotsIn, cues: window, dialogue: dialogueTurns(words, cues[from]!.startMs - 10_000, cues[to - 1]!.endMs + 10_000), heard }
    let reply: unknown
    // The forced tool first; when that call fails (Nova Lite: "Model produced invalid sequence as part of ToolUse" on some inputs, probe
    // round 3) the same window is asked once more for plain JSON text. A second failure keeps the window's original cues.
    for (const mode of ['tool', 'json'] as const) {
      try {
        const r = await send(editRequest(input, mode))
        meter()?.bedrock(model, r.usage)
        usage.inputTokens += r.usage?.inputTokens ?? 0; usage.outputTokens += r.usage?.outputTokens ?? 0
        const content = r.output?.message?.content ?? []
        reply = content.find((c) => c.toolUse)?.toolUse?.input ?? content.find((c) => c.text)?.text ?? ''
        break
      } catch (e) {
        if (signal?.aborted) throw e
        console.warn(`edit: ${mode} call failed for cues ${from}–${to - 1}${mode === 'tool' ? '; asking once more for JSON text' : '; keeping the original cues'}:`, (e as Error)?.message ?? e)
      }
    }
    if (reply === undefined) continue
    const edits = replyEdits(reply)
    if (!edits) { console.warn(`edit: reply for cues ${from}–${to - 1} is not {"edits":[…]}; keeping the original cues`, (typeof reply === 'string' ? reply : JSON.stringify(reply) ?? '').slice(0, 200)); continue }
    const out = applyEdits(cues, shots, edits, budgets, [from, to])
    const retry: Edit[] = []
    for (const r of out.rejected) {
      if (!r.reason.startsWith('over budget')) { report.rejected.push(r); continue }
      let shorter: string
      try { shorter = (await shorten(r.text, budgets[r.i]!, cues[r.i]!.text)).trim() } catch (e) { if (signal?.aborted) throw e; report.rejected.push(r); continue }
      if (shorter && shorter !== r.text) retry.push({ cue: r.i, text: shorter }); else report.rejected.push(r)
    }
    const again = retry.length ? applyEdits(cues, shots, retry, budgets, [from, to]) : { applied: [], rejected: [] }
    for (const a of [...out.applied, ...again.applied]) { report.cues[a.i]!.text = a.to; report.cues[a.i]!.wordCount = wordCount(a.to); report.applied.push(a) }
    report.rejected.push(...again.rejected.map((r) => ({ ...r, reason: `${r.reason} (after shortening)` })))
  }
  for (const r of report.rejected) console.warn(`edit: rejected edit of cue ${r.i} (${r.reason}):`, JSON.stringify(r.text))
  return report
}

const EditReply = z.object({ edits: z.array(z.object({ cue: z.coerce.number(), text: z.string() }).passthrough()) })
export type Edit = z.infer<typeof EditReply>['edits'][number]
/** The reply's edits (the toolUse input object, or text holding {"edits":[…]}, fenced or not); undefined when it is neither. An empty list is valid. */
export function replyEdits(reply: unknown): Edit[] | undefined {
  let json: unknown = reply
  if (typeof reply === 'string') try { json = JSON.parse(stripFence(reply)) } catch { json = undefined }
  const parsed = EditReply.safeParse(json)
  return parsed.success ? parsed.data.edits : undefined
}
const stripFence = (t: string) => t.trim().replace(/^[\s\S]*?```(?:json)?\s*(?=[{[])/i, '').replace(/\s*```[\s\S]*$/, '')

export const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length

/**
 * Word budget per cue. A placed cue's room is its limit (the gap's end, or the next placed cue's start − NEXT_CUE_SPACING_MS, as
 * 06-voice measures it) minus its start, at EDIT_WPS; an extended cue keeps EXTENDED_WORDS. Never below the cue's own word count:
 * the original was placed by fit and stays valid, so a tight window means "no lengthening", not "shorten".
 */
export function editBudgets(cues: readonly FitCue[]): number[] {
  return cues.map((c, i) => {
    if (c.extended) return Math.max(c.wordCount, EXTENDED_WORDS)
    const next = cues.slice(i + 1).find((x) => !x.extended)
    const limit = Math.min(c.limitMs ?? Infinity, next ? next.startMs - NEXT_CUE_SPACING_MS : Infinity)
    const room = Number.isFinite(limit) ? Math.max(0, limit - c.startMs) : 0
    return Math.max(c.wordCount, Math.min(EXTENDED_WORDS, Math.floor((room / 1000) * EDIT_WPS)))
  })
}

const WORDS_APPEAR = /Words appear:\s*(?:["“][^"”]*["”]|[^.]*)\.?/i

/**
 * The guard. Each edit replaces its cue only when: the index names a cue (once) inside `window` [from, to), the text is one non-empty
 * line within the cue's budget, a "Words appear:" clause of the original is in the edit verbatim and the edit adds none, and the
 * text is faithful (below). Timing, order, count, extended and shotIndex are never touched. Returns the cues (copies) and what
 * was applied / rejected.
 */
export function applyEdits(cues: readonly FitCue[], shots: readonly Described[], edits: readonly Edit[], budgets = editBudgets(cues), window: [number, number] = [0, cues.length]): { cues: FitCue[]; applied: EditReport['applied']; rejected: EditReport['rejected'] } {
  const out = cues.map((c) => ({ ...c }))
  const applied: EditReport['applied'] = [], rejected: EditReport['rejected'] = []
  const seen = new Set<number>()
  for (const e of edits) {
    const i = e.cue, text = e.text.replace(/\s+/g, ' ').trim()
    const reject = (reason: string) => rejected.push({ i, text: e.text, reason })
    if (!Number.isInteger(i) || i < 0 || i >= cues.length) { reject('unknown cue'); continue }
    if (i < window[0] || i >= window[1]) { reject('cue outside this window'); continue }
    if (seen.has(i)) { reject('cue edited twice'); continue }
    seen.add(i)
    const c = cues[i]!
    if (!text || /[\r\n]/.test(e.text.trim())) { reject('empty or multi-line'); continue }
    if (text === c.text) continue
    if (wordCount(text) > budgets[i]!) { reject(`over budget (${wordCount(text)} > ${budgets[i]} words)`); continue }
    const clause = WORDS_APPEAR.exec(c.text)?.[0]
    if (clause && !text.includes(clause)) { reject('Words appear clause changed'); continue }
    if (!clause && WORDS_APPEAR.test(text)) { reject('Words appear clause added'); continue }
    // What this cue may say: the shots between the previous voiced cue and its own (the ones it may absorb), its own text and the previous
    // cue's (continuity words). Not later shots (never before the action) and not earlier ones (a dropped fact goes into the NEXT cue only;
    // probe round 7: Nova folded shot 11's "veiled face" — the description Gate C flagged — into the cue of shot 14).
    const prevShot = cues[i - 1]?.shotIndex ?? -1
    const allowed = [...shots.filter((s) => s.index > prevShot && s.index <= c.shotIndex).map((s) => s.description), c.text, cues[i - 1]?.text ?? '']
    const bad = unfaithfulWords(text, allowed)
    if (bad.length) { reject(`not in any shot description: ${bad.join(', ')}`); continue }
    const lost = droppedFacts(c.text, text, cues[i - 1]?.text ?? '')
    if (lost.length) { reject(`drops a fact: ${lost.join(', ')}`); continue }
    out[i] = { ...c, text, wordCount: wordCount(text) }
    applied.push({ i, from: c.text, to: text })
  }
  return { cues: out, applied, rejected }
}

/**
 * Content words of `text` whose stem is in none of `allowed` (the shot descriptions the cue may absorb and the cue texts, see applyEdits).
 * Lower-cased, punctuation stripped, stop-words removed; inflections match through stems(): "stir" ~ "stirs" ~ "stirring".
 * Empty means faithful: the edit names nothing a description did not.
 */
export function unfaithfulWords(text: string, allowed: readonly string[]): string[] {
  const ok = new Set(allowed.flatMap((a) => contentWords(a).flatMap(stems)))
  return [...new Set(contentWords(text))].filter((w) => !stems(w).some((s) => ok.has(s)))
}

/**
 * Content words of the original cue that the edit no longer has (by stem), except those the previous voiced cue already said (that is
 * the repetition the pass removes) and the size/age/texture adjectives and manner adverbs fit's shortener drops first (so "Old man pours
 * broth" may become "The man stirs a pot, then pours broth"). Empty means the edit kept every fact. The pass adds context; it never loses any.
 * Probe round 4: Nova Lite dropped "Logo fades." from "Snowy mountains. A figure walks, falls. Logo fades." in 2 of 3 replies.
 */
export function droppedFacts(original: string, edited: string, previous: string): string[] {
  const kept = new Set([...contentWords(edited), ...contentWords(previous)].flatMap(stems))
  return [...new Set(contentWords(original))].filter((w) => !DROPPABLE.has(w) && !stems(w).some((s) => kept.has(s)))
}
/** The words 05-fit's shortenDeterministic drops first (its ADJECTIVES and ADVERBS lists); colours are facts and stay. */
const DROPPABLE = new Set(['large', 'small', 'big', 'little', 'tiny', 'huge', 'tall', 'short', 'long', 'wide', 'narrow', 'thick', 'thin', 'heavy', 'old', 'young', 'ancient', 'bright', 'dim', 'faint', 'soft', 'rough', 'smooth', 'sharp', 'wooden', 'snowy', 'rocky', 'icy', 'dusty', 'muddy', 'wet', 'dry', 'distant', 'nearby', 'vast', 'massive', 'slender', 'ornate', 'simple', 'various', 'several',
  'slowly', 'quickly', 'suddenly', 'gently', 'quietly', 'softly', 'carefully', 'briefly', 'slightly', 'rapidly', 'swiftly', 'steadily', 'firmly', 'tightly', 'calmly', 'silently', 'gracefully', 'cautiously', 'intently'])

/** Function words an edit may use freely: they place or link facts, they do not add any. "same" and "still" are the continuity words. */
const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'then', 'now', 'as', 'while', 'when', 'after', 'before', 'with', 'without', 'of', 'in', 'on', 'at', 'to', 'into', 'onto', 'from', 'by', 'for', 'over', 'under', 'near', 'beside', 'behind', 'through', 'across', 'around', 'up', 'down', 'out', 'off', 'away', 'back', 'toward', 'towards',
  'is', 'are', 'be', 'been', 'being', 'has', 'have', 'does', 'do', 'it', 'its', 'he', 'she', 'they', 'them', 'his', 'her', 'hers', 'their', 'him', 'this', 'that', 'these', 'those', 'there', 'here', 'who', 'which', 'what',
  'same', 'still', 'again', 'also', 'too', 'both', 'each', 'one', 'other', 'another', 'all', 'some', 'no', 'not', 'only', 'just', 'more', 'most', 'own', 'so', 'yet',
  // German
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'und', 'oder', 'aber', 'dann', 'jetzt', 'als', 'während', 'mit', 'ohne', 'von', 'vom', 'im', 'in', 'an', 'am', 'auf', 'zu', 'zum', 'zur', 'aus', 'bei', 'über', 'unter', 'neben', 'hinter', 'durch', 'um', 'ist', 'sind', 'hat', 'haben', 'er', 'sie', 'es', 'ihr', 'ihre', 'ihren', 'sein', 'seine', 'seinen', 'dieser', 'diese', 'dieses', 'derselbe', 'dieselbe', 'dasselbe', 'noch', 'wieder', 'auch', 'nur', 'nicht', 'kein', 'keine', 'selben', 'gleichen',
])
export const contentWords = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).map((w) => w.replace(/^['-]+|['-]+$/g, '').replace(/'s$/, '')).filter((w) => w && !STOP.has(w))

/**
 * Candidate stems of one word (always including the word): plural/3rd-person -s/-es, -ies → -y, -ing and -ed with a doubled
 * consonant undone (stirring → stir) and a dropped e restored (rising → rise), -er/-est, -ly. A stem shorter than 3 letters is
 * not produced (so "red" never matches "r"). Two words match when their candidate sets intersect; crude on purpose and symmetric.
 */
export function stems(word: string): string[] {
  const w = word.toLowerCase()
  const out = new Set([w])
  const add = (s: string) => { if (s.length >= 3) out.add(s) }
  if (w.endsWith('ies')) add(w.slice(0, -3) + 'y')
  if (w.endsWith('es')) add(w.slice(0, -2))
  if (w.endsWith('s') && !w.endsWith('ss')) add(w.slice(0, -1))
  for (const suf of ['ing', 'ed', 'er', 'est', 'ly']) if (w.endsWith(suf) && w.length > suf.length + 2) {
    const base = w.slice(0, -suf.length)
    add(base); add(base + 'e')
    if (/([^aeiou])\1$/.test(base) && !/(ll|ss|zz|ff)$/.test(base)) add(base.slice(0, -1))
    if (suf === 'ed' || suf === 'er' || suf === 'est') { const b = w.slice(0, -suf.length + 1); add(b) } // "cared" → "care", "larger" → "large"
    if (suf === 'ly' && base.endsWith('i')) add(base.slice(0, -1) + 'y')
  }
  return [...out]
}

export interface DialogueTurn { start: number; end: number; speaker?: string; text: string }
/** Speaker turns (words joined, speaker changes split) overlapping [fromMs, toMs], for the model's "what the viewer hears" context. */
export function dialogueTurns(words: readonly Word[], fromMs: number, toMs: number): DialogueTurn[] {
  const turns: DialogueTurn[] = []
  let cur: DialogueTurn | undefined
  for (const w of words) {
    if (w.end * 1000 < fromMs || w.start * 1000 > toMs) continue
    if (!cur || w.speaker !== cur.speaker || w.start - cur.end > 2) { cur = { start: w.start, end: w.end, ...(w.speaker ? { speaker: w.speaker } : {}), text: w.text }; turns.push(cur) }
    else { cur.text += ' ' + w.text; cur.end = w.end }
  }
  return turns.map((t) => ({ ...t, start: Math.round(t.start * 100) / 100, end: Math.round(t.end * 100) / 100 }))
}
