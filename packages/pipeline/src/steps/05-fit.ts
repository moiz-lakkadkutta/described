import { readFile, writeFile } from 'node:fs/promises'
import type { Ctx } from './index'
import type { Described } from './04-describe'
import type { Gap } from './03-speech'

export interface FitCue { startMs: number; endMs: number; text: string; extended: boolean; wordCount: number; shotIndex: number }
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
        if (words(text) > maxWords) continue
        const end = Math.min(g.endMs, start + Math.round((words(text) / WPS) * 1000) + 300)
        out.push({ startMs: start, endMs: end, text, extended: false, wordCount: words(text), shotIndex: s.index })
        g.cursor = end + 150
        placed = true
        break
      }
      if (!placed && introducesNew(s.description)) out.push({ ...extended(s), ...await capExtended(s.description, shorten) })
    }
    return out.sort((a, b) => a.startMs - b.startMs)
  }
  return work()
}
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length
const extended = (s: Described): FitCue => ({ startMs: s.startMs, endMs: s.startMs + 100, text: s.description, extended: true, wordCount: words(s.description), shotIndex: s.index })
/** Extended cues pause the film, so they keep the 25-word budget (PLAN §4.2); longer text is shortened like any other. */
export const EXTENDED_WORDS = 25
async function capExtended(text: string, shorten: (text: string, maxWords: number) => Promise<string> | string) {
  if (words(text) > EXTENDED_WORDS) { const t = await shorten(text, EXTENDED_WORDS); if (words(t) <= EXTENDED_WORDS) text = t; else text = text.split(/\s+/).slice(0, EXTENDED_WORDS).join(' ') }
  return { text, wordCount: words(text) }
}

/**
 * Does the shot introduce a new character, location or on-screen text (PLAN §4.3)? Only those become extended cues.
 * Crude on purpose: "Words appear:", a scene-change sentence ("Night.", "A rooftop."), or a newly introduced person ("a man", "a woman").
 */
export const introducesNew = (description: string) => /\b(words appear|night\.|day\.|a (man|woman|girl|boy)|rooftop|room|street)\b/i.test(description)

/** Words a shortening may add without changing a fact. */
const STOPWORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'into', 'onto', 'by', 'with', 'from', 'for', 'as', 'is', 'are', 'it', 'its', 'his', 'her', 'their', 'they', 'he', 'she', 'them', 'him', 'this', 'that', 'then'])
const tokens = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean)

/** Every content word of the shortened text appears verbatim in the original (case-insensitive, punctuation stripped). "wing" → "wings" fails. */
export function preservesFacts(original: string, shortened: string): boolean {
  const have = new Set(tokens(original))
  return tokens(shortened).every((w) => have.has(w) || STOPWORDS.has(w))
}

/** Size, shape, age and manner words dropped first. Colours stay: they are facts the prompt asks for. */
const ADJECTIVES = new Set(['large', 'small', 'big', 'little', 'tiny', 'huge', 'giant', 'tall', 'short', 'long', 'wide', 'narrow', 'thick', 'thin', 'heavy', 'old', 'young', 'ancient', 'empty', 'full', 'bright', 'dim', 'faint', 'soft', 'rough', 'smooth', 'sharp', 'wooden', 'snowy', 'rocky', 'icy', 'dusty', 'muddy', 'wet', 'dry', 'distant', 'nearby', 'vast', 'massive', 'slender', 'ornate', 'simple', 'various', 'several'])
/** Clause boundaries: after a comma/semicolon/sentence end, or before a joining word (kept with the clause it opens). */
const CLAUSE = /(?<=[,;.!?])\s+|\s+(?=(?:and|while|as|then|who|which|holding|wearing)\b)/i
const KEEP_BEFORE = new Set(['is', 'are', 'looks', 'seems', 'becomes'])

/**
 * Deterministic shortening (PLAN §4.3): drop adjectives and -ly adverbs that modify a following word, then drop clauses from the
 * end (sentence by sentence) until the text fits. Only removes words, so it never changes a fact. May still not fit; fit() decides.
 */
export function shortenDeterministic(text: string, maxWords: number): string {
  if (words(text) <= maxWords) return text
  const w = text.trim().split(/\s+/)
  const lean = w.filter((x, i) => {
    const bare = x.toLowerCase().replace(/[^a-z]/g, '')
    const modifies = i < w.length - 1 && /^[\p{L}]+$/u.test(x) && !KEEP_BEFORE.has((w[i - 1] ?? '').toLowerCase())
    return !(modifies && (ADJECTIVES.has(bare) || (/ly$/.test(bare) && bare.length > 4 && !['only', 'family', 'belly', 'jelly'].includes(bare))))
  }).join(' ').replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_, a: string, c: string) => a + c.toUpperCase()) // "Large white rock." → "White rock."
  if (words(lean) <= maxWords) return lean
  const clauses = lean.split(CLAUSE)
  while (clauses.length > 1 && words(clauses.join(' ')) > maxWords) clauses.pop()
  return clauses.join(' ').replace(/[,;]$/, '').replace(/([^.!?])$/, '$1.')
}

/** The model's shortening is used only when it fits and adds no content word; otherwise the deterministic one. */
export async function safeShorten(text: string, maxWords: number, model: (text: string, maxWords: number) => Promise<string> | string): Promise<string> {
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
