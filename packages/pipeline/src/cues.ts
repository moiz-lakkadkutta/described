import { createHash } from 'node:crypto'
import { serializeVtt } from '@moizp/vega-media-kit/core'
import type { FitCue } from './steps/05-fit'

/**
 * Description cue ids. Canonical order: start, then end (how the kit's parseVtt sorts, and how the API orders
 * DescriptionCue rows). fit already sorts cues.json by start; the end tie-break only matters for two cues starting on
 * the same millisecond.
 * - `d{n}` is the n-th cue (1-based) in that order: the VTT cue identifier in descriptions.vtt (08-text) and in the
 *   API's descriptions.vtt, the DescriptionCue row n of the title, and `:cueId` in GET /titles/:slug/cues/:cueId/audio.
 *   The app counts the n-th cue of the description track rather than reading the identifier.
 * - The Polly clip keeps the cues.json index `i` (06-voice writes work/{slug}/cue_{i}.mp3), and each row's pollyKey names
 *   its own clip, so order never mixes clips up.
 * - Published clip keys carry a hash of the clip's bytes — published/{slug}/cues/cue_{i}.{hash}.mp3 — because clips are
 *   cached for a year as immutable: a re-run on the same slug that changes cue i gets a new key (and a new row), never a
 *   stale cached cue_{i}.mp3.
 */
export const vttCueId = (i: number) => `d${i + 1}`
export const cueAudioFile = (i: number) => `cue_${i}.mp3`
/** First 12 hex of the clip's SHA-256. */
export const clipHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex').slice(0, 12)
export const cueAudioKey = (slug: string, i: number, hash: string) => `published/${slug}/cues/cue_${i}.${hash}.mp3`

/** cues.json in canonical order (start, then end), each with its cues.json index (its clip). */
export function ordered(cues: readonly FitCue[]): (FitCue & { i: number })[] {
  return cues.map((c, i) => ({ ...c, i })).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
}

/** descriptions.vtt: every cue (≥ 833 ms on screen), extended ones with `{extended=1;words=N}` meta. */
export function descriptionsVtt(cues: readonly FitCue[]): string {
  return serializeVtt(ordered(cues).map((c, n) => ({
    trackId: 'desc', id: vttCueId(n), start: c.startMs / 1000, end: Math.max(c.endMs, c.startMs + 833) / 1000, text: c.text,
    ...(c.extended ? { meta: { extended: '1', words: String(c.wordCount) } } : {}),
  })))
}

export interface DescriptionCueRow { titleId: string; startMs: number; endMs: number; text: string; extended: boolean; wordCount: number; pollyKey: string | null }
/** DescriptionCue rows in canonical order; pollyKey only where the clip was published (`published`: cues.json index → key). */
export function descriptionCueRows(titleId: string, cues: readonly FitCue[], published: ReadonlyMap<number, string>): DescriptionCueRow[] {
  return ordered(cues).map((c) => ({
    titleId, startMs: c.startMs, endMs: c.endMs, text: c.text, extended: c.extended, wordCount: c.wordCount,
    pollyKey: published.get(c.i) ?? null,
  }))
}
