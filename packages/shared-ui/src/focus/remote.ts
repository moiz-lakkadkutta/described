import { SpatialNavigation } from 'react-tv-space-navigation'
import type { RemoteKey } from '@moizp/vega-media-kit/platform'

/** Platform key source: call `onKey` per key-down, return an unsubscribe. Fire OS: react-native-keyevent; Vega: TVEventHandler. */
export type KeySource = (onKey: (key: RemoteKey) => void) => () => void
type Direction = 'up' | 'down' | 'left' | 'right' | 'enter'

const directions: Partial<Record<RemoteKey, Direction>> = { up: 'up', down: 'down', left: 'left', right: 'right', select: 'enter' }
/** Moves pass through the D-pad gate (key-repeat throttle, set by Root from the kit's useDpad); Select never does. */
let gate: () => boolean = () => true
export const setDpadGate = (g: () => boolean) => { gate = g }

export function toDirection(key: RemoteKey, allowMove: () => boolean = gate): Direction | null {
  const d = directions[key]
  if (!d) return null
  return d === 'enter' || allowMove() ? d : null
}

/** Wire a platform key source into react-tv-space-navigation. Call once, before the first SpatialNavigationRoot mounts. */
export function configureRemote(source: KeySource) {
  SpatialNavigation.configureRemoteControl({
    remoteControlSubscriber: (move) => source((k) => { const d = toDirection(k); if (d) move(d) }),
    remoteControlUnsubscriber: (unsubscribe: () => void) => unsubscribe(),
  })
}
