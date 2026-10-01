import { Linking } from 'react-native'
import { parseDeepLink } from '@described/contracts'
import type { LaunchSource } from '@described/shared-ui'

let initialTaken = false
/**
 * Fire OS launch source (DESC-008). `scheme: "described"` in app.json makes prebuild add a VIEW / DEFAULT / BROWSABLE
 * intent filter to MainActivity (singleTask), so `adb shell am start -a android.intent.action.VIEW -d described://…`
 * — or anything else that fires that intent — opens the app. A cold start arrives through getInitialURL (read once
 * per process, so a remounted Root does not replay it); a link while running arrives as a 'url' event.
 * https://reactnative.dev/docs/linking#handling-deep-links
 */
export const launchSource: LaunchSource = (onLaunch) => {
  const deliver = (url: string | null) => {
    const target = parseDeepLink(url)
    if (url) console.log(`[described] launch ${url} → ${target ? `${target.kind} ${target.slug}` : 'ignored'}`) // eslint-disable-line no-console -- device check greps logcat for this
    if (target) onLaunch(target)
  }
  if (!initialTaken) { initialTaken = true; Linking.getInitialURL().then(deliver).catch(() => {}) }
  const sub = Linking.addEventListener('url', (e: { url: string }) => deliver(e.url))
  return () => sub.remove()
}
/** Tests only. */
export const _resetLaunch = () => { initialTaken = false }
