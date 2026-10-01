import { useEffect, useRef } from 'react'
import type { TransportControl } from '@moizp/vega-media-kit/platform'

/**
 * Platform playback bindings (DESC-008): media session (Alexa "pause", "resume", "rewind", "go to 5 minutes") and
 * watch-activity reporting. shared-ui stays free of native imports: the platform entry injects implementations with
 * `configurePlatform`, like `configureRemote`. Without one, both are no-ops. See docs/platform/fire-os-bindings.md.
 */
export type Transport =
  | { kind: 'play' } | { kind: 'pause' } | { kind: 'toggle' } | { kind: 'stop' }
  | { kind: 'seekBy'; s: number } | { kind: 'seekTo'; s: number }
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

/** Seek step for "Alexa, fast forward" / "rewind" and the remote's ⏩ / ⏪ — the same step everywhere. */
export const SEEK_STEP_S = 10
/** How often watch activity is reported while playing. */
export const REPORT_EVERY_MS = 30_000

/** The kit's transport names (remote media keys via `toTransport`, Vega's media controls) in our terms. */
export function fromKitControl(c: TransportControl): Transport | null {
  switch (c) {
    case 'play': return { kind: 'play' }
    case 'pause': return { kind: 'pause' }
    case 'togglePlayPause': return { kind: 'toggle' }
    case 'stop': return { kind: 'stop' }
    case 'seekForward': return { kind: 'seekBy', s: SEEK_STEP_S }
    case 'seekBackward': return { kind: 'seekBy', s: -SEEK_STEP_S }
    default: return null // next / previous: one title at a time, nothing to skip to
  }
}

export type PlayerAction = { kind: 'play' } | { kind: 'pause' } | { kind: 'seek'; toS: number }
/**
 * One transport request → one player action, or null when there is nothing to do (play while playing).
 * "Stop" pauses: leaving the Player is the viewer's Back, which also saves progress.
 * Seeks clamp to [0, duration − 1] so a long "fast forward" never ends the title by accident.
 */
export function transportAction(t: Transport, p: { playing: boolean; positionS: number; durationS: number | null }): PlayerAction | null {
  const clamp = (s: number) => Math.max(0, p.durationS ? Math.min(s, Math.max(0, p.durationS - 1)) : s)
  switch (t.kind) {
    case 'play': return p.playing ? null : { kind: 'play' }
    case 'pause': case 'stop': return p.playing ? { kind: 'pause' } : null
    case 'toggle': return { kind: p.playing ? 'pause' : 'play' }
    case 'seekBy': return { kind: 'seek', toS: clamp(p.positionS + t.s) }
    case 'seekTo': return { kind: 'seek', toS: clamp(t.s) }
  }
}

export interface PlayerControls { play(): void; pause(): void; seek(seconds: number): void; getPosition(): number }
export function applyAction(player: PlayerControls, a: PlayerAction) {
  if (a.kind === 'play') player.play()
  else if (a.kind === 'pause') player.pause()
  else player.seek(a.toS)
}

/**
 * Player's hook-up: one call. Publishes now-playing to the media session, turns its transport requests into the same
 * player calls the remote makes, and reports watch activity (start/pause/progress/exit).
 */
export function usePlatformPlayback(ref: { readonly current: PlayerControls | null }, o: { slug: string; name: string; durationS: number | null; state: string }) {
  const { slug, name, durationS, state } = o
  const playing = state === 'playing'
  const live = useRef({ playing, positionS: 0 })
  // Buffering is playing that has stalled: "Alexa, pause" while it buffers must pause, and toggle must pause too.
  live.current.playing = playing || state === 'buffering'
  const position = () => { const r = ref.current; if (r) live.current.positionS = r.getPosition(); return live.current.positionS }

  useEffect(() => {
    const { mediaSession } = bindings
    const off = mediaSession?.onTransport((t) => {
      const r = ref.current
      if (!r) return
      const a = transportAction(t, { playing: live.current.playing, positionS: position(), durationS })
      if (!a) return
      applyAction(r, a)
      if (a.kind === 'seek') { live.current.positionS = a.toS; mediaSession.setNowPlaying({ title: name, durationS, positionS: a.toS, playing: live.current.playing }) }
    })
    return () => {
      off?.()
      mediaSession?.setNowPlaying(null)
      bindings.reporter?.report({ slug, positionS: live.current.positionS, durationS, state: 'exit' })
    }
  }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state !== 'playing' && state !== 'paused') return
    const positionS = position()
    bindings.mediaSession?.setNowPlaying({ title: name, durationS, positionS, playing })
    bindings.reporter?.report({ slug, positionS, durationS, state: playing ? 'playing' : 'paused' })
    if (!playing) return
    const timer = setInterval(() => bindings.reporter?.report({ slug, positionS: position(), durationS, state: 'playing' }), REPORT_EVERY_MS)
    return () => clearInterval(timer)
  }, [state, slug]) // eslint-disable-line react-hooks/exhaustive-deps
}
