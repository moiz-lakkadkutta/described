import { DeviceEventEmitter } from 'react-native'
import { mapKey } from '@moizp/vega-media-kit/platform'
import type { KeySource } from '@described/shared-ui'
import { createKeyHub } from './keys'
/**
 * Fire OS key source. MainActivity forwards key events (plugins/withKeyEvent.js) and react-native-keyevent emits them
 * as `onKeyDown` / `onKeyUp`. The emitter listeners are permanent and module-level, feeding one hub, so held-key state
 * survives a screen change; subscribers only read the hub. (Subscribing on the emitter, not keyevent's own
 * onKeyDownListener, which keeps a single listener: a later Play/Pause or Menu listener would replace D-pad navigation.)
 */
export const keys = createKeyHub()
DeviceEventEmitter.addListener('onKeyDown', (e: { keyCode: number }) => keys.down(e.keyCode))
DeviceEventEmitter.addListener('onKeyUp', (e: { keyCode: number }) => keys.up(e.keyCode))
/** Keys another path handles right now (the media session's PLAY / PAUSE / STOP while it is active, DESC-008). */
export const setKeySkip = (f: (keyCode: number) => boolean) => keys.setSkip(f)

export const keySource: KeySource = (onKey) => keys.subscribe((code, repeat) => { const k = mapKey(code); if (k) onKey(k, repeat) })
