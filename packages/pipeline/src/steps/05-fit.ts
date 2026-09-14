import { readFile, writeFile } from 'node:fs/promises'
import type { Ctx } from './index'
import type { Described } from './04-describe'
import type { Gap } from './03-speech'

export interface FitCue { startMs: number; endMs: number; text: string; extended: boolean; wordCount: number; shotIndex: number }
export const WPS = 160 / 60 // 2.67 words per second

/**
 * Deterministic placement (tested with fixtures). Nova Lite is used only to *shorten* text that doesn't fit —
 * that call lives in ../prompts.shortenWithNovaLite and is injected so tests run without AWS.
 */
export function fit(shots: Described[], gaps: Gap[], shorten: (text: string, maxWords: number) => Promise<string> | string): Promise<FitCue[]> | FitCue[] {
  const free = gaps.map((g) => ({ ...g, cursor: g.startMs }))
  const out: FitCue[] = []
  const work = async () => {
    for (const s of shots) {
      if (s.sameAsPrev || !s.description) continue
      // first gap at/after the shot start with room; describe *as* action occurs, never before
      const gap = free.find((g) => g.endMs > s.startMs && g.cursor < g.endMs && g.cursor >= s.startMs - 500)
      const isNew = /\b(words appear|night\.|day\.|a (man|woman|girl|boy)|rooftop|room|street)\b/i.test(s.description) // crude "new info" heuristic; refined in DESC-003
      if (!gap) { if (isNew) out.push(extended(s)); continue }
      const availMs = gap.endMs - Math.max(gap.cursor, s.startMs)
      const maxWords = Math.floor((availMs / 1000) * WPS)
      let text = s.description
      if (words(text) > maxWords) text = await shorten(text, maxWords)
      if (words(text) > maxWords || maxWords < 3) { if (isNew) out.push(extended(s)); continue }
      const start = Math.max(gap.cursor, s.startMs)
      const end = Math.min(gap.endMs, start + Math.round((words(text) / WPS) * 1000) + 300)
      out.push({ startMs: start, endMs: end, text, extended: false, wordCount: words(text), shotIndex: s.index })
      gap.cursor = end + 150
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
