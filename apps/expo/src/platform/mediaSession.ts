import { mapKey, toTransport } from '@moizp/vega-media-kit/platform'
import type { MediaSessionBinding, Transport } from '@described/shared-ui'

/**
 * Fire OS media session binding (DESC-008) over the local native module `DescribedMediaSession`
 * (modules/described-media-session). Alexa transport commands arrive as `onTransport` events and become the
 * shared-ui `Transport` requests that Player turns into the remote's own player calls.
 */
export interface NativeTransportEvent { control: string; positionS?: number; keyCode?: number }
export interface NativeMediaSession {
  setNowPlaying(title: string, durationS: number, positionS: number, playing: boolean): void
  release(): void
  addListener(event: 'onTransport', listener: (e: NativeTransportEvent) => void): { remove(): void }
  /** Native truth: a session exists and is active (created, foreground) — or not (no context, background, released). */
  addListener(event: 'onSessionState', listener: (e: { active: boolean }) => void): { remove(): void }
}

/**
 * Device-check fallback switch (docs/device-checks/DESC-008.md §4): true lets the active media session own
 * MEDIA_PLAY / MEDIA_PAUSE / MEDIA_STOP and the key path skip them. Set false if those keys do nothing on the stick
 * (Android not handing them to the session); every media key then stays on the key path.
 */
export const MEDIA_SESSION_OWNS_KEYS = true
export interface MediaSessionOptions {
  /**
   * Take the relative media buttons (PLAY_PAUSE, FAST_FORWARD, REWIND) in the session instead of on the key path.
   * Off by default: Player's key handling owns them. Turn on only if the device check shows Alexa voice commands
   * arriving as `control=button` in `adb logcat -s DescribedMediaSession`; the key path then skips them (`ownsKey`),
   * so each key still has exactly one handler.
   */
  acceptButtons?: boolean
}

/**
 * Which path handles each media key, so none fires twice or not at all. Mirrors DescribedMediaSessionModule.kt:
 * - PLAY (126), PAUSE (127), STOP (86): the native session maps them to onPlay / onPause / onStop (Alexa may send
 *   them). While the session is active, the key path skips them.
 * - PLAY_PAUSE (85), FAST_FORWARD (90), REWIND (89): the native session swallows them (control "button"); Player's key
 *   handling (DESC-006: playPause → toggle, fastForward / rewind → seek) owns them — unless `acceptButtons`.
 * Without an active session (no Player, app in background, module not built) every key stays on the key path.
 */
export const SESSION_MAPPED_KEYS: ReadonlySet<number> = new Set([126, 127, 86])
export const RELATIVE_MEDIA_KEYS: ReadonlySet<number> = new Set([85, 90, 89])

/** One native event → one Transport request, or null. */
export function fromNative(e: NativeTransportEvent, o: MediaSessionOptions = {}): Transport | null {
  switch (e.control) {
    case 'play': return { kind: 'play' }
    case 'pause': return { kind: 'pause' }
    case 'stop': return { kind: 'stop' }
    case 'fastForward': return { kind: 'seekBy', dir: 1 }
    case 'rewind': return { kind: 'seekBy', dir: -1 }
    case 'seekTo': return typeof e.positionS === 'number' && e.positionS >= 0 ? { kind: 'seekTo', s: e.positionS } : null
    case 'button': {
      if (!o.acceptButtons || e.keyCode === undefined) return null
      const key = mapKey(e.keyCode)
      switch (key && toTransport(key)) {
        case 'togglePlayPause': return { kind: 'toggle' }
        case 'play': return { kind: 'play' }
        case 'pause': return { kind: 'pause' }
        case 'seekForward': return { kind: 'seekBy', dir: 1 }
        case 'seekBackward': return { kind: 'seekBy', dir: -1 }
        default: return null
      }
    }
    default: return null
  }
}

export type FireMediaSession = MediaSessionBinding & {
  /** True when this key belongs to the session right now, so the key path must skip it (see SESSION_MAPPED_KEYS). */
  ownsKey(keyCode: number): boolean
}
/** The binding for configurePlatform, or undefined when the native module is not in this build (no-op, as before). */
export function createMediaSession(native: NativeMediaSession | null | undefined, o: MediaSessionOptions = {}): FireMediaSession | undefined {
  if (!native) return undefined
  // Both must hold: JS has a Player published (not yet released) and native reports a live, active session. A
  // publish alone is not enough — ensure() may have found no context, or the app may be in the background.
  let published = false
  let nativeActive = false
  native.addListener('onSessionState', (e) => { nativeActive = !!e.active }) // module lifetime, like the native session
  return {
    ownsKey: (code) => published && nativeActive && (SESSION_MAPPED_KEYS.has(code) || (!!o.acceptButtons && RELATIVE_MEDIA_KEYS.has(code))),
    setNowPlaying(info) {
      published = !!info
      if (!info) return native.release()
      native.setNowPlaying(info.title, info.durationS ?? -1, Math.max(0, info.positionS), info.playing)
    },
    onTransport(cb) {
      const sub = native.addListener('onTransport', (e) => { const t = fromNative(e, o); if (t) cb(t) })
      return () => sub.remove()
    },
  }
}

/** The key-source filter for setKeySkip: the session's keys while it owns them, nothing when switched off or absent. */
export function keySkipFor(session: FireMediaSession | undefined, enabled = MEDIA_SESSION_OWNS_KEYS): (keyCode: number) => boolean {
  return enabled && session ? (code) => session.ownsKey(code) : () => false
}
