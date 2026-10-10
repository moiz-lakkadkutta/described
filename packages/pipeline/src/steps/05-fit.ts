import { readFile, writeFile } from 'node:fs/promises'
import type { Ctx } from './index'
import type { Described } from './04-describe'
import type { Gap } from './03-speech'
import { TEXT_LABEL, textSpans } from '../textClause'

/**
 * endMs: fit's estimate (words / WPS + 300 ms) until 06-voice measures the Polly clip and rewrites it as startMs + clip duration (DESC-013).
 * limitMs: placed cues only — the end of the gap the cue was placed in, which the clip must not overrun (06-voice); absent on extended cues.
 */
export interface FitCue { startMs: number; endMs: number; text: string; extended: boolean; wordCount: number; shotIndex: number; limitMs?: number }
export const WPS = 160 / 60 // 2.67 words per second
/** A description may start up to 1 s after its shot ends, never later (Gate C, approved 2026-10-01). */
export const LATE_MS = 1000
/** Fewer words than this in a gap is no description; try the next gap in the window. */
const MIN_WORDS = 3

/**
 * Deterministic placement (tested with fixtures). Nova Lite is used only to *shorten* text that doesn't fit —
 * that call lives in ../prompts.shortenWithNovaLite and is injected so tests run without AWS.
 * Each shot scans the gaps in order for the first with ≥ MIN_WORDS of room starting in [shot start, shot end + LATE_MS];
 * describe *as* action occurs, never before. No room → an extended cue (≤ EXTENDED_WORDS) if introducesNew, else dropped.
 * On-screen text that does not fit beside the rest (human, 2026-10-10): the rest — the action — is placed as usual, shortened, and
 * the text clause becomes its own extended cue at the shot start (splitText). Neither is dropped.
 * fitDescriptions passes safeShorten, so a model shortening that changes a fact falls back to shortenDeterministic.
 */
export function fit(shots: Described[], gaps: Gap[], shorten: (text: string, maxWords: number) => Promise<string> | string): Promise<FitCue[]> | FitCue[] {
  const free = gaps.map((g) => ({ ...g, cursor: g.startMs }))
  const out: FitCue[] = []
  const work = async () => {
    for (const s of shots) {
      if (s.sameAsPrev || !s.description) continue
      let placed = false
      for (const g of free) {
        const start = Math.max(g.cursor, s.startMs)
        if (start >= g.endMs) continue // gap used up, or entirely before the shot
        if (start > s.endMs + LATE_MS) break // gaps are sorted; nothing later is on time (exactly LATE_MS late is allowed)
        const maxWords = Math.floor(((g.endMs - start) / 1000) * WPS)
        if (maxWords < MIN_WORDS) continue
        let text = s.description
        if (words(text) > maxWords) text = await shorten(text, maxWords)
        if (words(text) > maxWords) {
          const c = textClauses(s.description)
          if (!c?.rest) continue
          text = c.rest
          if (words(text) > maxWords) text = await shorten(text, maxWords)
          if (words(text) > maxWords) continue
          out.push({ ...extended(s), ...await capExtended(c.clause, shorten) })
        }
        const end = Math.min(g.endMs, start + Math.round((words(text) / WPS) * 1000) + 300)
        out.push({ startMs: start, endMs: end, text, extended: false, wordCount: words(text), shotIndex: s.index, limitMs: g.endMs })
        g.cursor = end + 150
        placed = true
        break
      }
      if (!placed && introducesNew(s.description)) out.push({ ...extended(s), ...await capExtended(s.description, shorten) })
    }
    return out.sort((a, b) => a.startMs - b.startMs) // stable: a split shot's text cue stays before its action cue
  }
  return work()
}
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length
const extended = (s: Described): FitCue => ({ startMs: s.startMs, endMs: s.startMs + 100, text: s.description, extended: true, wordCount: words(s.description), shotIndex: s.index })
/** Extended cues pause the film, so they keep the 25-word budget (PLAN §4.2); longer text is shortened like any other. */
export const EXTENDED_WORDS = 25
/** A clause-boundary cut that leaves fewer words than this is too little; the cut stays at EXTENDED_WORDS. */
export const MIN_CLAUSE_CUT_WORDS = 8
/**
 * Caps an extended cue at EXTENDED_WORDS. The shortener's text is used when it fits; otherwise the text is cut after the last word
 * ending a clause ([,;:.]) within the first EXTENDED_WORDS, when that keeps ≥ MIN_CLAUSE_CUT_WORDS words (a trailing , ; : becomes .),
 * else at EXTENDED_WORDS words. The cut never touches an on-screen text clause (DESC-017): the rest is cut to the words left beside it.
 * Also used by 06-voice when an overrun cue becomes extended.
 */
export async function capExtended(text: string, shorten: (text: string, maxWords: number) => Promise<string> | string) {
  if (words(text) > EXTENDED_WORDS) {
    const t = await shorten(text, EXTENDED_WORDS)
    if (words(t) <= EXTENDED_WORDS) text = t
    else {
      const c = textClauses(text)
      text = c?.rest && c.words < EXTENDED_WORDS ? join(c, cutAt(c.rest, EXTENDED_WORDS - c.words)) : cutAt(text, EXTENDED_WORDS)
    }
  }
  return { text, wordCount: words(text) }
}
/** capExtended's cut: after the last clause end within the first n words when that keeps ≥ MIN_CLAUSE_CUT_WORDS, else at n words. */
function cutAt(text: string, n: number) {
  const head = text.trim().split(/\s+/).slice(0, n)
  let last = head.length - 1
  while (last >= 0 && !/[,;:.]$/.test(head[last]!)) last--
  return last + 1 >= MIN_CLAUSE_CUT_WORDS ? head.slice(0, last + 1).join(' ').replace(/[,;:]$/, '.') : head.join(' ')
}

/**
 * On-screen text (DESC-017; ../textClause): a label ("Words appear:", or German "Text erscheint:" …) and the text, quoted or up to its
 * sentence end. The most important fact of its shot — shortening (deterministic, model, capExtended) never shortens or removes it:
 * it shortens the rest to the words left beside it. A clause that opened the text still opens it; a clause after other text is put
 * back at the end, so a mid-text clause moves to the end when the text is shortened.
 */
interface TextClauses { lead: string; tail: string; clause: string; rest: string; words: number }
/** text split into its text clauses (lead: one that opens the text; tail: the others; clause: all of them) and the rest; undefined when it has none. */
export function textClauses(text: string): TextClauses | undefined {
  const spans = textSpans(text)
  if (!spans.length) return undefined
  const m = spans.map((x) => text.slice(x.start, x.end).trim())
  const lead = text.slice(0, spans[0]!.start).trim() ? '' : m[0]!
  let rest = '', at = 0
  for (const x of spans) { rest += `${text.slice(at, x.start)} `; at = x.end }
  rest = (rest + text.slice(at)).replace(/\s+/g, ' ').trim()
  return { lead, tail: (lead ? m.slice(1) : m).join(' '), clause: m.join(' '), rest, words: words(m.join(' ')) }
}
/** The shortened rest put back beside the text clauses; a sentence end is added before a clause that follows it. */
function join(c: TextClauses, short: string) {
  let r = short.trim()
  if (r && c.tail && !/[.!?]$/.test(r)) r = `${r.replace(/[,;:]$/, '')}.`
  return [c.lead, r, c.tail].filter(Boolean).join(' ')
}

/**
 * Does the shot introduce a new character, location or on-screen text (PLAN §4.3)? Only those become extended cues.
 * Crude on purpose: "Words appear:", a scene-change sentence ("Night.", "A rooftop."), or a newly introduced person ("a man", "a woman").
 */
export const introducesNew = (description: string) => new RegExp(TEXT_LABEL.source, 'iu').test(description) || /\b(night\.|day\.|a (man|woman|girl|boy)|rooftop|room|street)\b/i.test(description)

/** The only words a shortening may add. Prepositions and pronouns change facts ("runs from" → "runs to", an added "her"). */
const STOPWORDS = new Set(['a', 'an', 'the', 'and'])
/** Dropping any of these flips the meaning, so a shortening must keep every one the original has. */
const NEGATIONS = new Set(['not', 'no', 'never', 'without', 'nobody', 'nothing', 'none', 'neither', 'nor', "n't", "don't", "doesn't", "isn't", "aren't", "can't", "won't"])
const tokens = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean)

/**
 * A shortening keeps the facts when its content words appear in the original in the same order (exact tokens, case-insensitive,
 * punctuation stripped — "wing" → "wings" fails, "dog chases cat" → "cat chases dog" fails), only a/an/the/and are added, and every
 * negation of the original survives.
 */
export function preservesFacts(original: string, shortened: string): boolean {
  const orig = tokens(original), short = tokens(shortened)
  if (orig.some((w) => NEGATIONS.has(w) && !short.includes(w))) return false
  let i = 0
  for (const w of short) {
    const at = orig.indexOf(w, i)
    if (at >= 0) i = at + 1
    else if (!STOPWORDS.has(w)) return false
  }
  return true
}

/** Size, shape, age and texture words dropped first. Colours stay (facts the prompt asks for); so do words that are often nouns or facts (giant, full, empty). */
const ADJECTIVES = new Set(['large', 'small', 'big', 'little', 'tiny', 'huge', 'tall', 'short', 'long', 'wide', 'narrow', 'thick', 'thin', 'heavy', 'old', 'young', 'ancient', 'bright', 'dim', 'faint', 'soft', 'rough', 'smooth', 'sharp', 'wooden', 'snowy', 'rocky', 'icy', 'dusty', 'muddy', 'wet', 'dry', 'distant', 'nearby', 'vast', 'massive', 'slender', 'ornate', 'simple', 'various', 'several'])
/** Clause boundaries: after a comma/semicolon/sentence end, or before a joining word (kept with the clause it opens). */
const CLAUSE = /(?<=[,;.!?])\s+|\s+(?=(?:and|while|as|then|who|which|holding|wearing)\b)/i
const KEEP_BEFORE = new Set(['is', 'are', 'looks', 'seems', 'becomes'])
/** Manner adverbs only, listed (a -ly rule ate "Emily" and "butterfly"); never nearly/almost/barely/only, which carry facts. */
const ADVERBS = new Set(['slowly', 'quickly', 'suddenly', 'gently', 'quietly', 'softly', 'carefully', 'briefly', 'slightly', 'rapidly', 'swiftly', 'steadily', 'firmly', 'tightly', 'calmly', 'silently', 'gracefully', 'cautiously'])
const ARTICLES = new Set(['a', 'an', 'the'])
const JOINERS = new Set(['and', 'while', 'as', 'then', 'who', 'which'])
/** After the candidate: a present-tense verb in house style ("walks", "runs") or a joining word — so the candidate is a noun (the subject). A candidate that itself ends the clause ("the old.") has punctuation and is never dropped. */
const verbOrEnd = (next: string) => JOINERS.has(next.toLowerCase().replace(/[^a-z]/g, '')) || /^\p{Ll}+[^s]s[,;.!?]?$/u.test(next)

/**
 * Deterministic shortening (PLAN §4.3): drop listed adjectives and adverbs that modify a following word, then drop clauses from
 * the end (sentence by sentence) until the text fits. Never drops a capitalised word mid-sentence (a name), nor an adjective used
 * as a noun ("the old walks": after an article, before a verb or the clause end). Only removes words. May still not fit; fit() decides.
 * Never touches an on-screen text clause (textClauses): the rest is shortened beside it. When the clause and some of the rest do not
 * fit together the text comes back unchanged, and fit / 06-voice split it: the action placed, the text its own extended cue.
 */
export function shortenDeterministic(text: string, maxWords: number): string {
  if (words(text) <= maxWords) return text
  const c = textClauses(text)
  if (!c) return shortenPlain(text, maxWords)
  if (!c.rest || c.words >= maxWords) return text
  const all = join(c, shortenPlain(c.rest, maxWords - c.words))
  return words(all) <= maxWords ? all : text
}
function shortenPlain(text: string, maxWords: number): string {
  if (words(text) <= maxWords) return text
  const w = text.trim().split(/\s+/)
  const lean = w.filter((x, i) => {
    const prev = (w[i - 1] ?? '').toLowerCase(), next = w[i + 1]
    const opensSentence = i === 0 || /[.!?]$/.test(prev)
    if (next === undefined || !/^\p{L}+$/u.test(x) || KEEP_BEFORE.has(prev) || (/^\p{Lu}/u.test(x) && !opensSentence)) return true
    const bare = x.toLowerCase()
    if (ADVERBS.has(bare)) return false
    return !(ADJECTIVES.has(bare) && !((ARTICLES.has(prev) || opensSentence) && verbOrEnd(next)))
  }).join(' ').replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_, a: string, c: string) => a + c.toUpperCase()) // "Large white rock." → "White rock."
  if (words(lean) <= maxWords) return lean
  const clauses = lean.split(CLAUSE)
  while (clauses.length > 1 && words(clauses.join(' ')) > maxWords) clauses.pop()
  return clauses.join(' ').replace(/[,;]$/, '').replace(/([^.!?])$/, '$1.')
}

/**
 * The model's shortening is used only when it fits and adds no content word; otherwise the deterministic one. The model never sees an
 * on-screen text clause: it shortens the rest to the words left beside the clause, which is then put back (DESC-017).
 */
export async function safeShorten(text: string, maxWords: number, model: (text: string, maxWords: number) => Promise<string> | string): Promise<string> {
  const c = words(text) > maxWords ? textClauses(text) : undefined
  if (!c) return safeShortenPlain(text, maxWords, model)
  if (!c.rest || c.words >= maxWords) return text // no room beside the text: no model call; fit splits it
  const all = join(c, await safeShortenPlain(c.rest, maxWords - c.words, model))
  return words(all) <= maxWords ? all : text
}
async function safeShortenPlain(text: string, maxWords: number, model: (text: string, maxWords: number) => Promise<string> | string): Promise<string> {
  const m = (await model(text, maxWords)).trim()
  if (m && words(m) <= maxWords && preservesFacts(text, m)) return m
  if (m && !preservesFacts(text, m)) console.warn('fit: shortener changed a fact, using deterministic shortening:', JSON.stringify(text), '→', JSON.stringify(m))
  return shortenDeterministic(text, maxWords)
}

export async function fitDescriptions(ctx: Ctx) {
  const shots = JSON.parse(await readFile(`${ctx.work}/described.json`, 'utf8')) as Described[]
  const gaps = JSON.parse(await readFile(`${ctx.work}/gaps.json`, 'utf8')) as Gap[]
  const { shortenWithNovaLite } = await import('../prompts')
  const cues = await fit(shots, gaps, (t, n) => safeShorten(t, n, (t, n) => shortenWithNovaLite(t, n, ctx.language)))
  await writeFile(`${ctx.work}/cues.json`, JSON.stringify(cues, null, 2))
}
