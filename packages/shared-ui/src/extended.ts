import type { Cue } from '@moizp/vega-media-kit/core'

/**
 * Extended mode without React (DESC-007): which `{extended=1}` description cue a position tick starts, and which one
 * to prefetch. Player.tsx owns the pause → speak → resume around it.
 *
 * Cue id: `d{n}`, n = 1-based position of the cue among ALL the title's description cues ordered by start, then end —
 * the order the kit's parseVtt gives. The pipeline numbers its VTT identifiers and DescriptionCue rows the same way
 * (packages/pipeline/src/cues.ts), and GET /titles/:slug/cues/d{n}/audio redirects to that row's clip. The app counts
 * positions rather than trusting the identifier, so it holds even if packaging drops cue ids.
 */
export interface ExtendedCue { id: string; start: number; end: number; text: string }

/** Prefetch the next extended cue's audio this long before it starts. */
export const PREFETCH_AHEAD_S = 10
/**
 * A forward step larger than this between two position ticks is a seek (or a resume elsewhere), not playback: the kit
 * reports ≤ 4 Hz, so playback moves ~0.25 s per tick. Crossing a cue start in such a step does not trigger it.
 */
export const MAX_TICK_S = 1.5

/** The extended cues of a whole description track, with their `d{n}` ids (see above). */
export function extendedCues(track: readonly Cue[]): ExtendedCue[] {
  return [...track].sort((a, b) => a.start - b.start || a.end - b.end)
    .map((c, i) => ({ c, id: `d${i + 1}` }))
    .filter(({ c }) => c.meta?.extended === '1')
    .map(({ c, id }) => ({ id, start: c.start, end: c.end, text: c.text }))
}

/**
 * Feed it every position tick. `trigger` is the cue whose start this tick crossed going forward in playback — once per
 * crossing: the next tick is already past it. A seek (`seeked()`, a backwards step or a jump > MAX_TICK_S) makes the
 * next tick a new baseline, so landing on or past a cue never starts it; seeking back before it and playing over it
 * again does. `upcoming` is the next extended cue starting within PREFETCH_AHEAD_S.
 */
export class ExtendedScheduler {
  private last: number | null = null
  constructor(private cues: readonly ExtendedCue[]) {}

  seeked(): void { this.last = null }
  /** Playback starts from `pos` (the film's own start): a cue starting exactly there still counts as crossed. */
  begin(pos: number): void { this.last = pos - 0.001 }

  tick(pos: number): { trigger?: ExtendedCue; upcoming?: ExtendedCue } {
    const last = this.last
    this.last = pos
    const playing = last !== null && pos >= last && pos - last <= MAX_TICK_S
    const trigger = playing ? this.cues.find((c) => c.start > last && c.start <= pos) : undefined
    const upcoming = this.cues.find((c) => c.start > pos && c.start - pos <= PREFETCH_AHEAD_S)
    return { ...(trigger ? { trigger } : {}), ...(upcoming ? { upcoming } : {}) }
  }
}
