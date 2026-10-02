import { AccessibilityInfo } from 'react-native'
/**
 * Spatial navigation moves a JS focus, not the platform's, so VoiceView would stay silent on D-pad moves.
 * Focusable announces its label (and hint) while a screen reader is on — debounced, and only if the element still
 * has focus, so holding ► along a row speaks where you stop, not every card passed.
 */
export const ANNOUNCE_DEBOUNCE_MS = 200
let readerOn = false
void AccessibilityInfo.isScreenReaderEnabled().then((on) => { readerOn = on }).catch(() => {})
AccessibilityInfo.addEventListener?.('screenReaderChanged', (on: boolean) => { readerOn = on })
let timer: ReturnType<typeof setTimeout> | undefined
export function announceFocus(label: string, hint: string | undefined, stillFocused: () => boolean) {
  if (!readerOn) return
  clearTimeout(timer)
  timer = setTimeout(() => { if (stillFocused()) AccessibilityInfo.announceForAccessibility(hint ? `${label}. ${hint}` : label) }, ANNOUNCE_DEBOUNCE_MS)
}
/** Test seam. */
export const _setScreenReader = (on: boolean) => { readerOn = on }
