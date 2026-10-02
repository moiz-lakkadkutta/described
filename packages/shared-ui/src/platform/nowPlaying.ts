import { useCallback, useEffect, useRef } from 'react'
import type { TransportControl } from '@moizp/vega-media-kit/platform'
import { SEEK_STEP_S } from '../playback'
import type { PlayerSession } from '../screens/Player'

/**
 * Platform playback bindings (DESC-008): media session (Alexa "pause", "resume", "fast forward", "go to 5 minutes")
 * and watch-activity reporting. shared-ui stays free of native imports: the platform entry injects implementations
 * with `configurePlatform`, like `configureRemote`. Without one, both are no-ops. See docs/platform/fire-os-bindings.md.
 *
 * The only input is Player's now-playing (`onNowPlaying` → `PlayerSession`), consumed in Root through
 * `usePlatformNowPlaying`. Every transport request acts through `session.controls`, i.e. Player's own play / pause /
 * `seekTo` (clamped, resume-aware) — the same calls the remote makes.
 */
export type Transport =
  | { kind: 'play' } | { kind: 'pause' } | { kind: 'toggle' } | { kind: 'stop' }
  /** One skip step (SEEK_STEP_S) forward or back — "Alexa, fast forward / rewind". */
  | { kind: 'seekBy'; dir: 1 | -1 }
  | { kind: 'seekTo'; s: number }
export interface NowPlayingInfo { title: string; durationS: number | null; positionS: number; playing: boolean }
export interface MediaSessionBinding {
  /** Publish what is playing; `null` when the Player leaves (the session stops answering voice commands). */
  setNowPlaying(info: NowPlayingInfo | null): void
  onTransport(cb: (t: Transport) => void): () => void
}
export interface PlaybackEvent { slug: string; positionS: number; durationS: number | null; state: 'playing' | 'paused' | 'exit' }
/** Watch activity for the platform's "continue watching" (Fire TV Integration SDK); progress for our own API is Root's job. */
export interface PlaybackReporter { report(e: PlaybackEvent): void }
export interface PlatformBindings { mediaSession?: MediaSessionBinding; reporter?: PlaybackReporter }

let bindings: PlatformBindings = {}
/** Call once from the platform entry, before Root mounts. */
export function configurePlatform(b: PlatformBindings) { bindings = b }

/** How often watch activity is reported while playing. */
export const REPORT_EVERY_MS = 30_000

/** The kit's transport names (Vega media controls, `toTransport` of a remote key) in our terms. */
export function fromKitControl(c: TransportControl): Transport | null {
  switch (c) {
    case 'play': return { kind: 'play' }
    case 'pause': return { kind: 'pause' }
    case 'togglePlayPause': return { kind: 'toggle' }
    case 'stop': return { kind: 'stop' }
    case 'seekForward': return { kind: 'seekBy', dir: 1 }
    case 'seekBackward': return { kind: 'seekBy', dir: -1 }
    default: return null // next / previous: one title at a time, nothing to skip to
  }
}

/** Buffering is playing that has stalled: "pause" while it buffers must pause (DESC-006's toggle agrees). */
export const isPlaying = (state: string) => state === 'playing' || state === 'buffering'

export type PlayerAction = { kind: 'play' } | { kind: 'pause' } | { kind: 'seek'; toS: number }
/**
 * One transport request → one player action, or null when there is nothing to do (play while playing).
 * "Stop" pauses: leaving the Player is the viewer's Back, which also saves progress. Seek targets are not clamped
 * here — `controls.seek` is Player's `seekTo`, the one place that clamps.
 */
export function transportAction(t: Transport, p: { playing: boolean; positionS: number }): PlayerAction | null {
  switch (t.kind) {
    case 'play': return p.playing ? null : { kind: 'play' }
    // Always: the Player's pause is idempotent, and during an extended pause (the kit reports paused while the clip
    // speaks) it is what keeps the film paused after the clip.
    case 'pause': case 'stop': return { kind: 'pause' }
    case 'toggle': return { kind: p.playing ? 'pause' : 'play' }
    case 'seekBy': return { kind: 'seek', toS: p.positionS + t.dir * SEEK_STEP_S }
    case 'seekTo': return { kind: 'seek', toS: t.s }
  }
}

const PUBLISHED = new Set(['playing', 'paused', 'buffering', 'ended'])
/**
 * The bindings' side of `onNowPlaying`, without React. Per Player session: subscribes to transport once, publishes
 * now-playing on every state change and every committed seek (`seeks`), reports start / pause / progress / exit.
 */
export function createNowPlayingSink(get: () => PlatformBindings = () => bindings) {
  let cur: PlayerSession | null = null
  let off: (() => void) | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let lastState: string | undefined
  let lastSeeks: number | undefined
  let positionS = 0
  const position = () => { if (cur) positionS = cur.controls.getPosition(); return positionS }
  const report = (state: PlaybackEvent['state']) => { if (cur) get().reporter?.report({ slug: cur.slug, positionS: position(), durationS: cur.durationS, state }) }
  const stopTimer = () => { if (timer) clearInterval(timer); timer = undefined }
  const end = () => {
    if (!cur) return
    off?.(); off = undefined; stopTimer()
    get().mediaSession?.setNowPlaying(null)
    get().reporter?.report({ slug: cur.slug, positionS, durationS: cur.durationS, state: 'exit' }) // last known: the player is gone
    cur = null; lastState = undefined; lastSeeks = undefined
  }
  const onTransport = (t: Transport) => {
    const s = cur
    if (!s) return
    const a = transportAction(t, { playing: isPlaying(s.state), positionS: s.controls.getPosition() })
    if (!a) return
    if (a.kind === 'play') s.controls.play()
    else if (a.kind === 'pause') s.controls.pause()
    else s.controls.seek(a.toS) // Player's seekTo: clamps, bumps `seeks` → republished below
  }
  return function update(s: PlayerSession | null) {
    if (!s) return end()
    if (cur && cur.slug !== s.slug) end() // another film without a null in between
    const fresh = !cur
    cur = s
    if (fresh) off = get().mediaSession?.onTransport(onTransport)
    const stateChanged = s.state !== lastState
    const seeked = lastSeeks !== undefined && s.seeks !== lastSeeks
    lastState = s.state; lastSeeks = s.seeks
    if ((stateChanged || seeked) && PUBLISHED.has(s.state)) {
      get().mediaSession?.setNowPlaying({ title: s.name, durationS: s.durationS, positionS: position(), playing: isPlaying(s.state) })
    }
    if (!stateChanged) return
    stopTimer()
    if (s.state === 'playing' || s.state === 'paused') report(s.state)
    if (s.state === 'playing') timer = setInterval(() => report('playing'), REPORT_EVERY_MS)
  }
}

/**
 * Root's hook-up: returns a stable `onNowPlaying` for Player that drives the bindings and then forwards to `forward`
 * (RootProps.onNowPlaying). Ends the session if Root unmounts with a Player open.
 */
export function usePlatformNowPlaying(forward?: (s: PlayerSession | null) => void): (s: PlayerSession | null) => void {
  const sink = useRef<ReturnType<typeof createNowPlayingSink> | null>(null)
  if (!sink.current) sink.current = createNowPlayingSink()
  const fwd = useRef(forward)
  fwd.current = forward
  useEffect(() => () => sink.current?.(null), [])
  return useCallback((s: PlayerSession | null) => { sink.current?.(s); fwd.current?.(s) }, [])
}
