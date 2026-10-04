import { readFile, writeFile } from 'node:fs/promises'
import { serializeVtt, lintCues } from '@moizp/vega-media-kit/core'
import type { Cue } from '@moizp/vega-media-kit/core'
import type { Ctx } from './index'
import type { Word } from './03-speech'
import type { FitCue } from './05-fit'
import { sdhWithNovaLite, type SdhConverse } from '../prompts'
import { descriptionsVtt } from '../cues'

/**
 * captions.vtt (Transcribe, segmented), sdh.vtt (Nova Lite adds [sounds] and [Speaker] IDs), descriptions.vtt (the AD script with {extended} meta),
 * sdh.json { degraded } — true when any SDH window fell back to the plain captions, or when there were captions but no window added a
 * sound or a speaker tag (the SDH track would be the plain captions), so 09-package does not advertise it as Rich captions.
 * Nova Lite sees the captions in windows of ≤ 40 (DESC-014), one call each.
 */
export async function sdh(ctx: Ctx, send?: SdhConverse) {
  const words = JSON.parse(await readFile(`${ctx.work}/words.json`, 'utf8')) as Word[]
  const cues = JSON.parse(await readFile(`${ctx.work}/cues.json`, 'utf8')) as FitCue[]
  const captions = segment(words)
  await writeFile(`${ctx.work}/captions.vtt`, serializeVtt(captions))
  // No dialogue → nothing for Nova Lite to annotate; write header-only files rather than spend a call on an empty array.
  const { cues: sdhCues, degraded, added } = captions.length ? await sdhWithNovaLite(captions, cues, ctx.language, send) : { cues: [], degraded: false, added: 0 }
  const problems = lintCues(sdhCues)
  if (problems.length) console.warn('SDH lint', problems)
  await writeFile(`${ctx.work}/sdh.vtt`, serializeVtt(sdhCues))
  await writeFile(`${ctx.work}/sdh.json`, JSON.stringify({ degraded: degraded || (captions.length > 0 && added === 0) }))
  await writeFile(`${ctx.work}/descriptions.vtt`, descriptionsVtt(cues)) // ids d{n}: see ../cues
}

/**
 * Sentence/clause segmentation to ≤ 42 chars × 2 lines, 1–7 s, ≤ 20 cps. An overlong sentence breaks after its last `,;:` word.
 * "Overlong" means the buffer plus the next word would need more than maxLines lines under the same greedy breaker wrap() uses —
 * a character budget (maxChars × maxLines) is not enough: long words at a break leave lines short, and the third line was dropped.
 */
export function segment(words: Word[], maxChars = 42, maxLines = 2, maxS = 7): Cue[] {
  const out: Cue[] = []
  let buf: Word[] = []
  const text = (ws: Word[]) => ws.map((w) => w.text).join(' ').replace(/\s([,.!?])/g, '$1')
  const flush = () => {
    if (!buf.length) return
    out.push({ trackId: 'captions', id: `c${out.length + 1}`, start: buf[0]!.start, end: Math.max(buf.at(-1)!.end, buf[0]!.start + 1), text: wrap(text(buf), maxChars, maxLines), ...(buf[0]!.speaker ? { speaker: buf[0]!.speaker } : {}) })
    buf = []
  }
  const overflows = (w: Word) => greedyLines(text([...buf, w]), maxChars).length > maxLines
  for (const w of words) {
    // overflow: flush up to the last clause boundary and re-test the carried rest; no boundary → flush everything
    while (buf.length && overflows(w)) { const j = lastClause(buf); if (j < 0) { flush(); break } const rest = buf.slice(j + 1); buf = buf.slice(0, j + 1); flush(); buf = rest }
    if (buf.length && (w.end - buf[0]!.start > maxS || (buf[0]!.speaker && w.speaker !== buf[0]!.speaker))) flush()
    buf.push(w)
    if (/[.!?]$/.test(w.text)) flush()
  }
  flush()
  return out
}
/** Index of the last word ending a clause (`,;:`), ignoring the first quarter of the buffer (a lone "No," opener would be a 1 s cue); -1 when none. */
const lastClause = (buf: Word[]) => { for (let j = buf.length - 2; j >= Math.max(1, Math.ceil(buf.length / 4) - 1); j--) if (/[,;:]$/.test(buf[j]!.text)) return j; return -1 }
/** Greedy line breaker: each line takes words while it stays ≤ maxChars (a single longer word gets a line of its own). */
const greedyLines = (t: string, maxChars: number) => { const lines: string[] = []; let cur = ''; for (const w of t.split(' ')) { if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w } else cur = (cur + ' ' + w).trim() } if (cur) lines.push(cur); return lines }
/**
 * Greedy wrap, but a first line ending at a clause boundary (≥ half a line long) wins when the rest still fits the remaining lines.
 * Never drops text: input that needs more than maxLines greedy lines is a segment() bug, so it throws.
 */
export function wrap(text: string, maxChars: number, maxLines: number): string {
  const lines = greedyLines(text, maxChars)
  if (lines.length > maxLines) throw new Error(`wrap: text needs ${lines.length} lines, more than ${maxLines}: ${JSON.stringify(text)}`)
  if (lines.length > 1) {
    const ws = text.split(' ')
    for (let k = ws.length - 1; k > 0; k--) {
      const head = ws.slice(0, k).join(' ')
      if (head.length > maxChars || !/[,;:]$/.test(head)) continue
      const rest = greedyLines(ws.slice(k).join(' '), maxChars)
      if (head.length >= maxChars / 2 && rest.length <= maxLines - 1) return [head, ...rest].join('\n')
      break
    }
  }
  return lines.join('\n')
}
