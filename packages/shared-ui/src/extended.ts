import type { Cue } from '@moiz0309/vega-media-kit/core'

/**
 * Extended mode without React (DESC-007): which `{extended=1}` description cue a position tick starts, and which one
 * to prefetch. Player.tsx owns the pause → speak → resume around it.
 *
 * Cue id: `d{n}` as the VTT says. GET /titles/:slug/descriptions.vtt writes it (n = position by start, then end, the
 * same n GET /titles/:slug/cues/d{n}/audio takes); the app takes the parsed id rather than counting cues, so a cue the
 * parser drops (text that cleans to nothing) cannot shift the others onto the wrong clip.
 */
export interface ExtendedCue { id: string; start: number; end: number; text: string }

/** Prefetch the next extended cue's audio this long before it starts. */
export const PREFETCH_AHEAD_S = 10
/**
 * A forward step larger than this between two position ticks is a seek (or a resume elsewhere), not playback: the kit
 * reports ≤ 4 Hz, so playback moves ~0.25 s per tick. Crossing a cue start in such a step does not trigger it.
 */
export const MAX_TICK_S = 1.5

/** The extended cues of a whole description track, by their own `d{n}` ids (see above). */
export function extendedCues(track: readonly Cue[]): ExtendedCue[] {
  return [...track].sort((a, b) => a.start - b.start || a.end - b.end)
    .filter((c) => c.meta?.extended === '1')
    .map((c) => ({ id: c.id, start: c.start, end: c.end, text: c.text }))
}

/**
 * Fire an extended cue this long before its start (decision 0019). The kit reports position at ≤ 4 Hz (a tick lands up to
 * 0.25 s after any given moment), and the pause then goes through React state → the RN bridge → ExoPlayer (~0.1–0.25 s,
 * estimated; measure it with logcat, see the decision). Firing only at `pos >= start` let the film play past the cue
 * (tears-of-steel-40-100 d10 at 43.226: the next description's voice at 43.589). Pausing up to this much early loses
 * nothing: the film resumes from where it paused.
 */
export const EXTENDED_LEAD_S = 0.35
/** A tick reports `armIn` when the next cue's fire point (start − EXTENDED_LEAD_S) comes within this. */
export const ARM_WINDOW_S = 0.5

/**
 * Feed it every position tick. `triggers` are the cues this tick reached going forward in playback, in order (usually
 * one; two close cues can share a tick): a cue is reached once the position is within EXTENDED_LEAD_S of its start, so it
 * fires up to that much early, never late. Once per crossing: every cue start up to `pos + EXTENDED_LEAD_S` counts as
 * handled. A seek (`seeked()`, a jump > MAX_TICK_S either way) makes the next tick a new baseline: landing on or past a
 * cue never starts it, a cue starting after the landing point still does (from the next tick), and seeking back before
 * it and playing over it again does. A small backward step (a late or jittery tick) keeps the furthest position, so it
 * cannot re-cross a cue. `armIn` (s): the next cue's fire point is that far ahead, within ARM_WINDOW_S, so the caller can
 * arm a timer and call `tick(pos + armIn)` between ticks (the kit's position does not move between its ticks).
 * `upcoming` is the next extended cue not yet fired that starts within PREFETCH_AHEAD_S.
 */
export class ExtendedScheduler {
  private last: number | null = null
  /** Every cue starting at or before this has fired or been passed. */
  private horizon = -Infinity
  constructor(private cues: readonly ExtendedCue[]) {}

  seeked(): void { this.last = null }
  /** Playback starts from `pos` (the film's own start): a cue starting exactly there still counts as reached. */
  begin(pos: number): void { this.last = pos; this.horizon = pos - 0.001 }

  tick(pos: number): { triggers: ExtendedCue[]; upcoming?: ExtendedCue; armIn?: number } {
    const last = this.last
    let triggers: ExtendedCue[] = []
    if (last !== null && pos < last && last - pos <= MAX_TICK_S) {
      // jitter: keep the furthest position
    } else if (last !== null && pos >= last && pos - last <= MAX_TICK_S) {
      const edge = pos + EXTENDED_LEAD_S + 1e-9 // a timer's tick lands exactly on the fire point
      triggers = this.cues.filter((c) => c.start > this.horizon && c.start <= edge)
      this.horizon = Math.max(this.horizon, edge)
      this.last = pos
    } else {
      this.last = pos; this.horizon = pos // baseline
    }
    const at = Math.max(pos, this.last ?? pos)
    const next = this.cues.find((c) => c.start > this.horizon)
    const upcoming = next && next.start - at <= PREFETCH_AHEAD_S ? next : undefined
    const armIn = next ? next.start - EXTENDED_LEAD_S - at : undefined
    return { triggers, ...(upcoming ? { upcoming } : {}), ...(armIn !== undefined && armIn > 0 && armIn <= ARM_WINDOW_S ? { armIn } : {}) }
  }
}
