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
 * Feed it every position tick. `triggers` are the cues whose start this tick crossed going forward in playback, in order
 * (usually one; two close cues can share a tick) — once per crossing: the next tick is already past them. A seek
 * (`seeked()`, a jump > MAX_TICK_S either way) makes the next tick a new baseline, so landing on or past a cue never
 * starts it; seeking back before it and playing over it again does. A small backward step (a late or jittery tick) keeps
 * the furthest position, so it cannot re-cross a cue. `upcoming` is the next extended cue starting within PREFETCH_AHEAD_S.
 */
export class ExtendedScheduler {
  private last: number | null = null
  constructor(private cues: readonly ExtendedCue[]) {}

  seeked(): void { this.last = null }
  /** Playback starts from `pos` (the film's own start): a cue starting exactly there still counts as crossed. */
  begin(pos: number): void { this.last = pos - 0.001 }

  tick(pos: number): { triggers: ExtendedCue[]; upcoming?: ExtendedCue } {
    const last = this.last
    const upcoming = this.cues.find((c) => c.start > pos && c.start - pos <= PREFETCH_AHEAD_S)
    const out = (triggers: ExtendedCue[]) => ({ triggers, ...(upcoming ? { upcoming } : {}) })
    if (last !== null && pos < last && last - pos <= MAX_TICK_S) return out([]) // jitter: keep the furthest position
    this.last = pos
    const playing = last !== null && pos >= last && pos - last <= MAX_TICK_S
    return out(playing ? this.cues.filter((c) => c.start > last && c.start <= pos) : [])
  }
}
