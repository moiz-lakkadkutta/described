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
   * Media buttons that reach the session. Off by default: MainActivity already forwards the remote's media keys to JS
   * as key events, so taking them here too would toggle twice. Turn on only if the device check shows Alexa voice
   * commands arriving as `control=button` in `adb logcat -s DescribedMediaSession`.
   */
  acceptButtons?: boolean
}
const SEEK_STEP_S = 10 // shared-ui SEEK_STEP_S; kept literal so this module stays free of shared-ui's runtime

/** One native event → one Transport request, or null. */
export function fromNative(e: NativeTransportEvent, o: MediaSessionOptions = {}): Transport | null {
  switch (e.control) {
    case 'play': return { kind: 'play' }
    case 'pause': return { kind: 'pause' }
    case 'stop': return { kind: 'stop' }
    case 'fastForward': return { kind: 'seekBy', s: SEEK_STEP_S }
    case 'rewind': return { kind: 'seekBy', s: -SEEK_STEP_S }
    case 'seekTo': return typeof e.positionS === 'number' && e.positionS >= 0 ? { kind: 'seekTo', s: e.positionS } : null
    case 'button': {
      if (!o.acceptButtons || e.keyCode === undefined) return null
      const key = mapKey(e.keyCode)
      switch (key && toTransport(key)) {
        case 'togglePlayPause': return { kind: 'toggle' }
        case 'play': return { kind: 'play' }
        case 'pause': return { kind: 'pause' }
        case 'seekForward': return { kind: 'seekBy', s: SEEK_STEP_S }
        case 'seekBackward': return { kind: 'seekBy', s: -SEEK_STEP_S }
        default: return null
      }
    }
    default: return null
  }
}

/** The binding for configurePlatform, or undefined when the native module is not in this build (no-op, as before). */
export function createMediaSession(native: NativeMediaSession | null | undefined, o: MediaSessionOptions = {}): MediaSessionBinding | undefined {
  if (!native) return undefined
  return {
    setNowPlaying(info) {
      if (!info) return native.release()
      native.setNowPlaying(info.title, info.durationS ?? -1, Math.max(0, info.positionS), info.playing)
    },
    onTransport(cb) {
      const sub = native.addListener('onTransport', (e) => { const t = fromNative(e, o); if (t) cb(t) })
      return () => sub.remove()
    },
  }
}
