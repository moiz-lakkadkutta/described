import KeyEvent from 'react-native-keyevent'
import { mapKey } from '@moizp/vega-media-kit/platform'
import type { KeySource } from '@described/shared-ui'
/** Fire OS key source: MainActivity forwards key-downs (plugins/withKeyEvent.js); the kit maps Android keycodes. */
export const keySource: KeySource = (onKey) => {
  KeyEvent.onKeyDownListener((e: { keyCode: number }) => { const k = mapKey(e.keyCode); if (k) onKey(k) })
  return () => KeyEvent.removeKeyDownListener()
}
