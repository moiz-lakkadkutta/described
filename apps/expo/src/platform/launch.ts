import { AppState, Linking } from 'react-native'
import { parseDeepLink } from '@described/contracts'
import type { LaunchSource } from '@described/shared-ui'

/**
 * The start URL already handled in the current activity. Back on Home finishes the activity but the JS context
 * survives, so a later `am start -d described://…` creates a new activity (and a new Root) whose getInitialURL must be
 * handled — even when it is the same URL as last time. Going to the background ends the "same activity" window; a
 * second subscribe inside one activity (same URL, no background in between) does not replay it.
 */
let handledInitial: string | null = null
let watchingAppState = false
function watchAppState() {
  if (watchingAppState) return
  watchingAppState = true
  AppState.addEventListener('change', (s: string) => { if (s === 'background') handledInitial = null })
}

/**
 * Fire OS launch source (DESC-008). `scheme: "described"` in app.json makes prebuild add a VIEW / DEFAULT / BROWSABLE
 * intent filter to MainActivity (singleTask), so `adb shell am start -a android.intent.action.VIEW -d described://…`
 * — or anything else that fires that intent — opens the app. The start link arrives through getInitialURL (read on
 * every subscribe, de-duplicated per activity); a link while running arrives as a 'url' event.
 * https://reactnative.dev/docs/linking#handling-deep-links
 */
export const launchSource: LaunchSource = (onLaunch) => {
  watchAppState()
  let live = true
  const deliver = (url: string | null) => {
    const target = parseDeepLink(url)
    if (url) console.log(`[described] launch ${url} → ${target ? `${target.kind} ${target.slug}` : 'ignored'}`) // eslint-disable-line no-console -- device check greps logcat for this
    if (target) onLaunch(target)
  }
  Linking.getInitialURL().then((url) => {
    if (!live || !url || url === handledInitial) return
    handledInitial = url
    deliver(url)
  }).catch(() => {})
  const sub = Linking.addEventListener('url', (e: { url: string }) => deliver(e.url))
  return () => { live = false; sub.remove() }
}
/** Tests only. */
export const _resetLaunch = () => { handledInitial = null }
