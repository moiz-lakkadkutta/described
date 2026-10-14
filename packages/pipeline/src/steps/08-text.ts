import { readFile, writeFile } from 'node:fs/promises'
import { execa } from 'execa'
import { serializeVtt, lintCues } from '@moizp/vega-media-kit/core'
import type { Cue } from '@moizp/vega-media-kit/core'
import type { Ctx } from './index'
import type { Word } from './03-speech'
import type { FitCue } from './05-fit'
import { sdhWithNovaLite, type SdhConverse, type SdhEvidence } from '../prompts'
import { descriptionsVtt, probeDurationMs } from '../cues'

/**
 * captions.vtt (Transcribe, segmented), sdh.vtt (Nova Lite adds [sounds] and [Speaker] IDs), descriptions.vtt (the AD script with {extended} meta),
 * sdh.json { degraded } — true when any SDH window fell back to the plain captions, or when there were captions but no window added a
 * sound or a speaker tag (the SDH track would be the plain captions), so 09-package does not advertise it as Rich captions.
 * Nova Lite sees the captions in windows of ≤ 40 (DESC-014), one call each, cached in cache/sdh/ so a `--from text` re-run repeats the
 * result. A sound cue it proposes is kept only over audible audio (`audible`, by default ebur128 on mezz.mp4's audio) and next to a
 * description naming its source (mergeSdh), so a title whose descriptions show nothing that makes a sound gets no Rich captions.
 */
export async function sdh(ctx: Ctx, send?: SdhConverse, audible?: SdhEvidence['audible']) {
  const words = JSON.parse(await readFile(`${ctx.work}/words.json`, 'utf8')) as Word[]
  const cues = JSON.parse(await readFile(`${ctx.work}/cues.json`, 'utf8')) as FitCue[]
  const captions = segment(words)
  await writeFile(`${ctx.work}/captions.vtt`, serializeVtt(captions))
  // No dialogue → nothing for Nova Lite to annotate; write header-only files rather than spend a call on an empty array.
  const { cues: sdhCues, degraded, added } = captions.length
    ? await sdhWithNovaLite(captions, cues, ctx.language, send, { audible: audible ?? audibleFrom(await momentaryLoudness(`${ctx.work}/mezz.mp4`, ctx.signal)), cacheDir: `${ctx.work}/cache/sdh` })
    : { cues: [], degraded: false, added: 0 }
  const problems = lintCues(sdhCues)
  if (problems.length) console.warn('SDH lint', problems)
  await writeFile(`${ctx.work}/sdh.vtt`, serializeVtt(sdhCues))
  await writeFile(`${ctx.work}/sdh.json`, JSON.stringify({ degraded: degraded || (captions.length > 0 && added === 0) }))
  await writeFile(`${ctx.work}/descriptions.vtt`, descriptionsVtt(cues, await probeDurationMs(ctx.work))) // ids d{n}, ends within the title: see ../cues
}

/** Momentary loudness (LUFS, 400 ms window) at or above this is audible: the speech gaps of Sintel 1:30–2:30 (fire, wind) measure −45 to −52, its near-silences −56 to −59. */
export const AUDIBLE_LUFS = -55
/** One ebur128 frame: t (s, the end of its 400 ms window) and momentary loudness M (LUFS). */
export interface LoudnessFrame { t: number; m: number }
/** The `t:` / `M:` pairs of ffmpeg's ebur128 per-frame log (printed at -v verbose, every 100 ms) — https://ffmpeg.org/ffmpeg-filters.html#ebur128-1 */
export function parseMomentary(stderr: string): LoudnessFrame[] {
  const out: LoudnessFrame[] = []
  for (const m of stderr.matchAll(/\bt:\s*([\d.]+)\s.*?\bM:\s*(-?[\d.]+|-inf|nan)/g)) out.push({ t: Number(m[1]), m: Number.isFinite(Number(m[2])) ? Number(m[2]) : -Infinity })
  return out
}
/** ffmpeg ebur128 over the first audio stream of `file` (the original soundtrack in mezz.mp4); one decode pass, no output file. */
export async function momentaryLoudness(file: string, signal?: AbortSignal): Promise<LoudnessFrame[]> {
  const { stderr } = await execa('ffmpeg', ['-hide_banner', '-nostats', '-v', 'verbose', '-i', file, '-map', '0:a:0', '-af', 'ebur128=framelog=verbose', '-f', 'null', '-'], { cancelSignal: signal })
  return loudnessFrames(stderr, file)
}
/**
 * parseMomentary, but no frames is an error: 01-probe always maps an audio stream into mezz.mp4, so an empty log means the measurement
 * failed (an ffmpeg log format change, a wrong log level), and treating it as silence would drop every sound without a word.
 */
export function loudnessFrames(stderr: string, file: string): LoudnessFrame[] {
  const frames = parseMomentary(stderr)
  if (!frames.length) throw new Error(`ebur128: no momentary frames parsed from ${file.split('/').at(-1)}`)
  return frames
}
/** True when some frame whose 400 ms window overlaps [start, end] reaches `floor`. An empty list (only in tests: see loudnessFrames) → nothing is audible. */
export const audibleFrom = (frames: readonly LoudnessFrame[], floor = AUDIBLE_LUFS) => (start: number, end: number) =>
  frames.some((f) => f.t > start && f.t - 0.4 < end && f.m >= floor)

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
