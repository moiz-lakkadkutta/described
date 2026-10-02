import { SpatialNavigation } from 'react-tv-space-navigation'
import type { RemoteKey } from '@moizp/vega-media-kit/platform'
import { interceptKey } from './keys'

/**
 * Platform key source: call `onKey` per key-down (`repeat` while the key is held), return an unsubscribe.
 * Fire OS: react-native-keyevent; Vega: TVEventHandler.
 */
export type KeySource = (onKey: (key: RemoteKey, repeat?: boolean) => void) => () => void
type Direction = 'up' | 'down' | 'left' | 'right' | 'enter'

const directions: Partial<Record<RemoteKey, Direction>> = { up: 'up', down: 'down', left: 'left', right: 'right', select: 'enter' }
/** Moves pass through the D-pad gate (key-repeat throttle, set by Root from the kit's useDpad); a held Select fires once. */
let gate: () => boolean = () => true
export const setDpadGate = (g: () => boolean) => { gate = g }

export function toDirection(key: RemoteKey, allowMove: () => boolean = gate, repeat = false): Direction | null {
  const d = directions[key]
  if (!d) return null
  if (d === 'enter') return repeat ? null : d
  return allowMove() ? d : null
}

let keySource: KeySource | null = null
/**
 * Every raw key for a screen that needs more than the D-pad (Player: Play/Pause, Menu, seek). Each call is its own
 * subscription on the platform source, so it never replaces spatial navigation's (apps/expo/src/remote.ts).
 * Before configureRemote there is no source: a no-op.
 */
export function subscribeKeys(onKey: (key: RemoteKey, repeat: boolean) => void): () => void {
  return keySource ? keySource((k, repeat) => onKey(k, !!repeat)) : () => {}
}

/** Wire a platform key source into react-tv-space-navigation. Call once, before the first SpatialNavigationRoot mounts. */
export function configureRemote(source: KeySource) {
  keySource = source
  SpatialNavigation.configureRemoteControl({
    remoteControlSubscriber: (move) => source((k, repeat) => { if (interceptKey(k, !!repeat)) return; const d = toDirection(k, gate, repeat); if (d) move(d) }),
    remoteControlUnsubscriber: (unsubscribe: () => void) => unsubscribe(),
  })
}
