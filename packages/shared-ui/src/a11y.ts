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
let context: string | undefined
let usage: string | undefined
/**
 * What a sighted viewer takes in at a glance but VoiceView never reaches (a row's name, a title's facts and synopsis):
 * said once, before the next focus announcement. Set when a screen opens or focus enters a group.
 *
 * `usageHint`: how to move in the group just entered (a row, a grid), said once after that first focus announcement —
 * Amazon's VoiceView guidance puts usage hints on the list or grid container, read on entering it and not repeated
 * while moving inside it (`com.amazon.accessibility.usageHint.remote`; React Native cannot set node extras, so the app
 * speaks it). https://developer.amazon.com/docs/fire-tv/implement-voiceview-accessibility-features-fire-os.html
 */
export function setFocusContext(text: string | undefined, usageHint?: string) { if (readerOn) { context = text; usage = usageHint } }
export function announceFocus(label: string, hint: string | undefined, stillFocused: () => boolean) {
  if (!readerOn) return
  clearTimeout(timer)
  timer = setTimeout(() => {
    if (!stillFocused()) return
    const said = [context, label, hint, usage].filter((x): x is string => !!x).map((x) => x.replace(/[.\s]+$/, '')).join('. ')
    context = undefined; usage = undefined
    AccessibilityInfo.announceForAccessibility(said)
  }, ANNOUNCE_DEBOUNCE_MS)
}
/** True while VoiceView (or another screen reader) is on. */
export const screenReaderOn = () => readerOn
/** Test seam. */
export const _setScreenReader = (on: boolean) => { readerOn = on; if (!on) { context = undefined; usage = undefined } }
