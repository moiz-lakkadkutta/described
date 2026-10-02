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
}
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
  let active = false
  return {
    ownsKey: (code) => active && (SESSION_MAPPED_KEYS.has(code) || (!!o.acceptButtons && RELATIVE_MEDIA_KEYS.has(code))),
    setNowPlaying(info) {
      active = !!info
      if (!info) return native.release()
      native.setNowPlaying(info.title, info.durationS ?? -1, Math.max(0, info.positionS), info.playing)
    },
    onTransport(cb) {
      const sub = native.addListener('onTransport', (e) => { const t = fromNative(e, o); if (t) cb(t) })
      return () => sub.remove()
    },
  }
}
