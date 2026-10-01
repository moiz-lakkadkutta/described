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
 * describe *as* action occurs, never before. No room → an extended cue if the shot is new information, else dropped.
 */
export function fit(shots: Described[], gaps: Gap[], shorten: (text: string, maxWords: number) => Promise<string> | string): Promise<FitCue[]> | FitCue[] {
  const free = gaps.map((g) => ({ ...g, cursor: g.startMs }))
  const out: FitCue[] = []
  const work = async () => {
    for (const s of shots) {
      if (s.sameAsPrev || !s.description) continue
      const isNew = /\b(words appear|night\.|day\.|a (man|woman|girl|boy)|rooftop|room|street)\b/i.test(s.description) // crude "new info" heuristic; refined in DESC-003
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
      if (!placed && isNew) out.push(extended(s))
    }
    return out.sort((a, b) => a.startMs - b.startMs)
  }
  return work()
}
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length
const extended = (s: Described): FitCue => ({ startMs: s.startMs, endMs: s.startMs + 100, text: s.description, extended: true, wordCount: words(s.description), shotIndex: s.index })

export async function fitDescriptions(ctx: Ctx) {
  const shots = JSON.parse(await readFile(`${ctx.work}/described.json`, 'utf8')) as Described[]
  const gaps = JSON.parse(await readFile(`${ctx.work}/gaps.json`, 'utf8')) as Gap[]
  const { shortenWithNovaLite } = await import('../prompts')
  const cues = await fit(shots, gaps, (t, n) => shortenWithNovaLite(t, n, ctx.language))
  await writeFile(`${ctx.work}/cues.json`, JSON.stringify(cues, null, 2))
}
