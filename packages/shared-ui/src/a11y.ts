import { AccessibilityInfo } from 'react-native'
/**
 * Spatial navigation moves a JS focus, not the platform's, so VoiceView would stay silent on D-pad moves.
 * Focusable announces its label (and hint) on focus while a screen reader is on.
 */
let readerOn = false
void AccessibilityInfo.isScreenReaderEnabled().then((on) => { readerOn = on }).catch(() => {})
AccessibilityInfo.addEventListener?.('screenReaderChanged', (on: boolean) => { readerOn = on })
export function announceFocus(label: string, hint?: string) {
  if (readerOn) AccessibilityInfo.announceForAccessibility(hint ? `${label}. ${hint}` : label)
}
