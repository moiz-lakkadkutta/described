import { DeviceEventEmitter } from 'react-native'
import { mapKey } from '@moizp/vega-media-kit/platform'
import type { KeySource } from '@described/shared-ui'
import { createRepeatTracker } from './keys'
/**
 * Fire OS key source. MainActivity forwards key events (plugins/withKeyEvent.js) and react-native-keyevent emits them
 * as `onKeyDown` / `onKeyUp`. Subscribe on the emitter directly: the library's own onKeyDownListener keeps a single
 * listener, so a later Play/Pause or Menu listener (DESC-006) would silently replace D-pad navigation.
 */
export const keySource: KeySource = (onKey) => {
  const keys = createRepeatTracker()
  const down = DeviceEventEmitter.addListener('onKeyDown', (e: { keyCode: number }) => {
    const repeat = keys.down(e.keyCode)
    const k = mapKey(e.keyCode)
    if (k) onKey(k, repeat)
  })
  const up = DeviceEventEmitter.addListener('onKeyUp', (e: { keyCode: number }) => keys.up(e.keyCode))
  return () => { down.remove(); up.remove() }
}
