import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { stemmer } from 'stemmer'
import type { Ctx } from './index'
import type { Described } from './04-describe'
import type { Word } from './03-speech'
import { textClauses, type FitCue } from './05-fit'
import { NEXT_CUE_SPACING_MS } from './06-voice'
import { textSpans } from '../textClause'
import { editRequest, editModelId, shortenEditWithNovaLite, stripFence, type EditConverse, type EditCueInput, bedrockEditSend } from '../prompts'
import { meter } from '../cost'

/** fit's cues as fit wrote them (05-fit); the edit step always starts from this file, so re-running it (a finish-job retry, --from edit) is idempotent. */
export const FIT_CUES_FILE = 'cues.fit.json'

/**
 * Scene-level edit pass (DESC-018, docs/decisions/0006-scene-edit-pass.md): after fit, before voice. Every shot was described and
 * placed on its own; the viewer hears the voiced cues in a row, with the dropped shots missing. One text-only Nova Lite call per
 * window of cues sees the cues as heard, each with the shots dropped just before it, and the dialogue — and returns revised text
 * for voiced cues only: a dropped fact folded into the next cue when it fits, repetition across consecutive cues removed, continuity
 * words. Timing is fit's: the pass never adds, drops, moves or reorders a cue, and never touches an on-screen text cue (DESC-017's
 * split "Words appear: …" cues are frozen).
 *
 * Every edit passes a deterministic guard before it replaces the original (applyEdits): index known and unedited so far, one line,
 * not an on-screen text cue, the on-screen text clauses of the original kept verbatim and in order (none added), no content word
 * outside the shot descriptions between the previous action cue and this cue's shot plus the two cues' own text (faithful), no fact
 * of the original lost unless the previous cue said it (keeps facts), and within the cue's budget — checked last, so an over-budget
 * edit that would fail anyway costs no shortening call. An unreadable reply, or a failed call, keeps every original cue (the step is
 * an improvement, never a dependency).
 * Reads cues.fit.json (cues.json when an older work dir has none), writes cues.json (same length and order) and edit.json (what
 * changed, what was rejected, usage) for the evaluation. DESCRIBE_EDIT=0 makes cues.json fit's cues again, without a call.
 */
export async function editCues(ctx: Ctx, send: EditConverse = bedrockEditSend) {
  const fitFile = `${ctx.work}/${FIT_CUES_FILE}`
  const source = await readFile(fitFile, 'utf8').then(() => fitFile, () => `${ctx.work}/cues.json`)
  if (source !== fitFile) console.warn(`edit: no ${FIT_CUES_FILE} in ${ctx.work} (fit ran before DESC-018); editing cues.json in place, which is not idempotent`)
  const cues = JSON.parse(await readFile(source, 'utf8')) as FitCue[]
  if (process.env.DESCRIBE_EDIT === '0') {
    console.log('edit: skipped (DESCRIBE_EDIT=0)')
    if (source === fitFile) await copyFile(fitFile, `${ctx.work}/cues.json`)
    await writeFile(`${ctx.work}/edit.json`, JSON.stringify({ skipped: true, applied: [], rejected: [] }))
    return
  }
  const shots = JSON.parse(await readFile(`${ctx.work}/described.json`, 'utf8')) as Described[]
  const words = JSON.parse(await readFile(`${ctx.work}/words.json`, 'utf8').catch(() => '[]')) as Word[]
  const report = await editScene(cues, shots, words, ctx.language, send, ctx.signal)
  console.log(`edit: ${report.applied.length} of ${cues.length} cues revised, ${report.rejected.length} edits rejected`)
  await writeFile(`${ctx.work}/cues.json`, JSON.stringify(report.cues, null, 2))
  await writeFile(`${ctx.work}/edit.json`, JSON.stringify({ model: report.model, applied: report.applied, rejected: report.rejected, usage: report.usage, shorteningCalls: report.shorteningCalls }, null, 2))
}

/** Cues per Converse call: an output of up to ~30 edits stays well inside Nova Lite's reply budget; a title's cues go in order. */
export const EDIT_CHUNK_CUES = 30
/**
 * Words per second the edit budget assumes. fit budgets at WPS (2.67); Polly Joanna neural on sintel-90-150-r2 ran at 2.13 words/s net
 * of the 150 ms lead-in (43 words in 20.2 s), and sentence ends cost ~0.4 s each, so a cue lengthened to fit's budget would often
 * overrun its limit and be shortened or dropped by 06-voice. 2.2 keeps a lengthened cue inside voice's tolerance.
 */
export const EDIT_WPS = 2.2

export interface TokenUsage { inputTokens: number; outputTokens: number }
export interface EditReport { cues: FitCue[]; applied: { i: number; from: string; to: string }[]; rejected: { i: number; text: string; reason: string }[]; model: string; usage: TokenUsage; shorteningCalls: number }

/** Shortens `text` to maxWords keeping every fact of `keep` (the cue's original text): one Nova Lite call by default (with its usage); tests inject their own. */
export type ShortenReply = string | { text: string; usage?: Partial<TokenUsage> }
export type Shorten = (text: string, maxWords: number, keep: string) => Promise<ShortenReply> | ShortenReply

/** An extended cue that is only on-screen text (DESC-017 split it from its action, or voice did): frozen for this pass. */
export const isTextCue = (c: FitCue) => c.extended && textClauses(c.text)?.rest === ''
/** The previous cue that carries action (not an on-screen text cue), the one continuity is measured against; -1 when none. */
const prevActionIndex = (cues: readonly FitCue[], i: number) => { for (let k = i - 1; k >= 0; k--) if (!isTextCue(cues[k]!)) return k; return -1 }

/**
 * The pass over one title's cues, pure apart from `send` and `shorten`; fixtures in test/edit.test.ts.
 * An edit over its budget gets one shortening call (the model appends a dropped description whole rather than compressing it — probe
 * round 5: 17 words into 11), and the shortened text goes through the same guards; it is dropped when it still does not fit.
 */
export async function editScene(cues: FitCue[], shots: Described[], words: Word[], language: 'en' | 'de', send: EditConverse, signal?: AbortSignal, shorten: Shorten = (t, n, keep) => shortenEditWithNovaLite(t, n, keep, language)): Promise<EditReport> {
  const model = editModelId()
  const report: EditReport = { cues: cues.map((c) => ({ ...c })), applied: [], rejected: [], model, usage: { inputTokens: 0, outputTokens: 0 }, shorteningCalls: 0 }
  if (!cues.length) return report
  const budgets = editBudgets(cues)
  const voiced = new Set(cues.map((c) => c.shotIndex))
  const add = (u: Partial<TokenUsage> | undefined) => { report.usage.inputTokens += u?.inputTokens ?? 0; report.usage.outputTokens += u?.outputTokens ?? 0 }
  for (let from = 0; from < cues.length; from += EDIT_CHUNK_CUES) {
    const to = Math.min(cues.length, from + EDIT_CHUNK_CUES)
    const window: EditCueInput[] = cues.slice(from, to).map((c, k) => {
      const i = from + k, text = isTextCue(c)
      const p = prevActionIndex(cues, i), prevShot = p < 0 ? -1 : cues[p]!.shotIndex
      // Dropped shots go to the action cue that follows them, never to an on-screen text cue (frozen) and never twice.
      const missed = text ? [] : shots.filter((x) => !voiced.has(x.index) && !x.sameAsPrev && x.description && x.index > prevShot && x.index < c.shotIndex).map((x) => x.description)
      return { i, startMs: c.startMs, text: c.text, wordCount: c.wordCount, budget: budgets[i]!, extended: c.extended, onScreenText: text, missed }
    })
    const heard = from ? report.cues[from - 1]!.text : undefined
    const input = { language, cues: window, dialogue: dialogueTurns(words, cues[from]!.startMs - 10_000, cues[to - 1]!.endMs + 10_000), heard }
    let reply: unknown
    // The forced tool first; when that call fails (Nova Lite: "Model produced invalid sequence as part of ToolUse" on some inputs, probe
    // round 3) the same window is asked once more for plain JSON text. A second failure keeps the window's original cues.
    for (const mode of ['tool', 'json'] as const) {
      try {
        const r = await send(editRequest(input, mode))
        meter()?.bedrock(model, r.usage)
        add(r.usage)
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
      try {
        report.shorteningCalls++
        const s = await shorten(r.text, budgets[r.i]!, cues[r.i]!.text)
        if (typeof s === 'string') shorter = s.trim(); else { shorter = s.text.trim(); add(s.usage) }
      } catch (e) { if (signal?.aborted) throw e; report.rejected.push(r); continue }
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
/**
 * The reply's edits: the toolUse input object, or text holding {"edits":[…]} — fenced or not, with prose around it (the first `{` to
 * the last `}` is read). undefined when it is neither. An empty list is valid.
 */
export function replyEdits(reply: unknown): Edit[] | undefined {
  let json: unknown = reply
  if (typeof reply === 'string') {
    const t = stripFence(reply), a = t.indexOf('{'), b = t.lastIndexOf('}')
    try { json = a >= 0 && b > a ? JSON.parse(t.slice(a, b + 1)) : undefined } catch { json = undefined }
  }
  const parsed = EditReply.safeParse(json)
  return parsed.success ? parsed.data.edits : undefined
}

export const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length

/**
 * Word budget per cue. A placed cue's room is its limit (the gap's end, or the next cue of any kind − NEXT_CUE_SPACING_MS: a clip
 * must not run into a text pause either) minus its start, at EDIT_WPS, never below the cue's own word count: the original was placed
 * by fit and stays valid, so a tight window means "no lengthening", not "shorten". An extended cue keeps its own length — it pauses
 * the film, and 25 words is fit's cap for that, not room.
 */
export function editBudgets(cues: readonly FitCue[]): number[] {
  return cues.map((c, i) => {
    if (c.extended) return c.wordCount
    const next = cues[i + 1]
    const limit = Math.min(c.limitMs ?? Infinity, next ? next.startMs - NEXT_CUE_SPACING_MS : Infinity)
    const room = Number.isFinite(limit) ? Math.max(0, limit - c.startMs) : 0
    return Math.max(c.wordCount, Math.floor((room / 1000) * EDIT_WPS))
  })
}

/** The on-screen text clauses of a line, label and text as written (../textClause), in order. */
export const textClauseStrings = (t: string) => textSpans(t).map((s) => t.slice(s.start, s.end).trim())

/**
 * The guard. Each edit replaces its cue only when: the index names a cue (once) inside `window` [from, to); the text is one non-empty
 * line; the cue is not an on-screen text cue; the on-screen text clauses of the original are in the edit verbatim and in order, and
 * the edit adds none; the text is faithful and keeps the original's facts (below); and it is within the cue's budget — last, so a
 * rejection for budget is the only kind worth a shortening call. Timing, order, count, extended and shotIndex are never touched.
 * Returns the cues (copies) and what was applied / rejected.
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
    if (isTextCue(c)) { reject('on-screen text cue'); continue }
    const was = textClauseStrings(c.text), now = textClauseStrings(text)
    if (was.length !== now.length || was.some((x, k) => x !== now[k])) { reject(was.length ? 'on-screen text clause changed' : 'on-screen text clause added'); continue }
    // What this cue may say: the shots between the previous action cue and its own (the ones it may absorb), its own text and that
    // previous cue's (continuity words). Not later shots (never before the action) and not earlier ones (a dropped fact goes into the
    // NEXT cue only; probe round 7: Nova folded shot 11's "veiled face" — the description Gate C flagged — into the cue of shot 14).
    const p = prevActionIndex(cues, i), prevShot = p < 0 ? -1 : cues[p]!.shotIndex, previous = p < 0 ? '' : cues[p]!.text
    const allowed = [...shots.filter((s) => s.index > prevShot && s.index <= c.shotIndex).map((s) => s.description), c.text, previous]
    const bad = unfaithfulWords(text, allowed)
    if (bad.length) { reject(`not in any shot description: ${bad.join(', ')}`); continue }
    const lost = droppedFacts(c.text, text, previous)
    if (lost.length) { reject(`drops a fact: ${lost.join(', ')}`); continue }
    if (wordCount(text) > budgets[i]!) { reject(`over budget (${wordCount(text)} > ${budgets[i]} words)`); continue }
    out[i] = { ...c, text, wordCount: wordCount(text) }
    applied.push({ i, from: c.text, to: text })
  }
  return { cues: out, applied, rejected }
}

/**
 * Content words of `text` whose stem is in none of `allowed` (the shot descriptions the cue may absorb and the cue texts, see applyEdits).
 * Lower-cased, punctuation stripped, stop-words removed; inflections match through stem(): "stir" ~ "stirs" ~ "stirring".
 * Empty means faithful: the edit names nothing a description did not.
 */
export function unfaithfulWords(text: string, allowed: readonly string[]): string[] {
  const ok = new Set(allowed.flatMap((a) => contentWords(a).map(stem)))
  return [...new Set(contentWords(text))].filter((w) => !ok.has(stem(w)))
}

/**
 * Content words of the original cue that the edit no longer has (by stem), except those the previous action cue already said (that is
 * the repetition the pass removes) and the size/age/texture adjectives and manner adverbs fit's shortener drops first (so "Old man pours
 * broth" may become "The man stirs a pot, then pours broth"). Empty means the edit kept every fact. The pass adds context; it never loses any.
 * Probe round 4: Nova Lite dropped "Logo fades." from "Snowy mountains. A figure walks, falls. Logo fades." in 2 of 3 replies.
 */
export function droppedFacts(original: string, edited: string, previous: string): string[] {
  const kept = new Set([...contentWords(edited), ...contentWords(previous)].map(stem))
  return [...new Set(contentWords(original))].filter((w) => !DROPPABLE.has(w) && !kept.has(stem(w)))
}
/** The words 05-fit's shortenDeterministic drops first (its ADJECTIVES and ADVERBS lists); colours are facts and stay. */
const DROPPABLE = new Set(['large', 'small', 'big', 'little', 'tiny', 'huge', 'tall', 'short', 'long', 'wide', 'narrow', 'thick', 'thin', 'heavy', 'old', 'young', 'ancient', 'bright', 'dim', 'faint', 'soft', 'rough', 'smooth', 'sharp', 'wooden', 'snowy', 'rocky', 'icy', 'dusty', 'muddy', 'wet', 'dry', 'distant', 'nearby', 'vast', 'massive', 'slender', 'ornate', 'simple', 'various', 'several',
  'slowly', 'quickly', 'suddenly', 'gently', 'quietly', 'softly', 'carefully', 'briefly', 'slightly', 'rapidly', 'swiftly', 'steadily', 'firmly', 'tightly', 'calmly', 'silently', 'gracefully', 'cautiously', 'intently'])

/**
 * Function words an edit may use freely: articles, linking conjunctions, case prepositions, auxiliaries, demonstratives. Everything
 * that changes a fact must trace to the allowed text instead: negations (not, no, nicht, kein), quantifiers (all, both, more, one,
 * another), again / same / still, gendered pronouns (he, she, his, her, er, sie, ihr, sein) and spatial words (over, under, behind,
 * left, über, hinter …) are deliberately not here.
 */
const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'then', 'as', 'while', 'when', 'of', 'in', 'on', 'at', 'to', 'from', 'by', 'for', 'with',
  'is', 'are', 'be', 'been', 'being', 'has', 'have', 'does', 'do', 'it', 'its', 'they', 'them', 'their', 'this', 'that', 'these', 'those', 'there', 'who', 'which', 'what', 'also', 'too', 'so',
  // German
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'und', 'oder', 'aber', 'dann', 'als', 'während', 'mit', 'von', 'vom', 'im', 'an', 'am', 'auf', 'zu', 'zum', 'zur', 'aus', 'bei', 'ist', 'sind', 'hat', 'haben', 'es', 'dieser', 'diese', 'dieses', 'auch',
])
export const contentWords = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).map((w) => w.replace(/^['-]+|['-]+$/g, '').replace(/'s$/, '')).filter((w) => w && !STOP.has(w))

/**
 * One canonical stem per word: Porter (the `stemmer` package, MIT, no dependencies — a hand-rolled candidate-set stemmer matched
 * stars ~ stares and car ~ caring). Two words match when their stems are equal: walks ~ walking ~ walk, fired ~ fire, but fir ≠ fired,
 * scar ≠ scared. Porter is English; a German inflection matches only when written the same (so the guard is stricter in German).
 */
export const stem = (word: string) => stemmer(word.toLowerCase())

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
