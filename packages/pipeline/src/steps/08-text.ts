import { readFile, writeFile } from 'node:fs/promises'
import { serializeVtt, lintCues } from '@moizp/vega-media-kit/core'
import type { Cue } from '@moizp/vega-media-kit/core'
import type { Ctx } from './index'
import type { Word } from './03-speech'
import type { FitCue } from './05-fit'
import { sdhWithNovaLite } from '../prompts'

/** captions.vtt (Transcribe, segmented), sdh.vtt (Nova Lite adds [sounds] and [Speaker] IDs), descriptions.vtt (the AD script with {extended} meta). */
export async function sdh(ctx: Ctx) {
  const words = JSON.parse(await readFile(`${ctx.work}/words.json`, 'utf8')) as Word[]
  const cues = JSON.parse(await readFile(`${ctx.work}/cues.json`, 'utf8')) as FitCue[]
  const captions = segment(words)
  await writeFile(`${ctx.work}/captions.vtt`, serializeVtt(captions))
  const sdhCues = await sdhWithNovaLite(captions, cues, ctx.language)
  const problems = lintCues(sdhCues)
  if (problems.length) console.warn('SDH lint', problems)
  await writeFile(`${ctx.work}/sdh.vtt`, serializeVtt(sdhCues))
  await writeFile(`${ctx.work}/descriptions.vtt`, serializeVtt(cues.map((c, i) => ({ trackId: 'desc', id: `d${i + 1}`, start: c.startMs / 1000, end: Math.max(c.endMs, c.startMs + 833) / 1000, text: c.text, ...(c.extended ? { meta: { extended: '1', words: String(c.wordCount) } } : {}) }))))
}

/** Sentence/clause segmentation to ≤ 42 chars × 2 lines, 1–7 s, ≤ 20 cps. */
export function segment(words: Word[], maxChars = 42, maxLines = 2, maxS = 7): Cue[] {
  const out: Cue[] = []
  let buf: Word[] = []
  const flush = () => {
    if (!buf.length) return
    const text = wrap(buf.map((w) => w.text).join(' ').replace(/\s([,.!?])/g, '$1'), maxChars, maxLines)
    out.push({ trackId: 'captions', id: `c${out.length + 1}`, start: buf[0]!.start, end: Math.max(buf.at(-1)!.end, buf[0]!.start + 1), text, ...(buf[0]!.speaker ? { speaker: buf[0]!.speaker } : {}) })
    buf = []
  }
  for (const w of words) {
    const nextLen = buf.map((x) => x.text).join(' ').length + w.text.length + 1
    const dur = w.end - (buf[0]?.start ?? w.start)
    if (buf.length && (nextLen > maxChars * maxLines || dur > maxS || (buf[0]!.speaker && w.speaker !== buf[0]!.speaker))) flush()
    buf.push(w)
    if (/[.!?]$/.test(w.text)) flush()
  }
  flush()
  return out
}
export function wrap(text: string, maxChars: number, maxLines: number): string {
  const wordsArr = text.split(' '); const lines: string[] = []; let cur = ''
  for (const w of wordsArr) { if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w } else cur = (cur + ' ' + w).trim() }
  if (cur) lines.push(cur)
  return lines.slice(0, maxLines).join('\n')
}
