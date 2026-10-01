import { useEffect, useState } from 'react'
import type { Catalog, LaunchTarget } from '@described/contracts'

/**
 * Platform launch source (DESC-008): call `onLaunch` for every deep link the app is opened with — the one it was
 * started by, and each later one while it runs — and return an unsubscribe. Fire OS: Android VIEW intents for
 * `described://…` through React Native's Linking (apps/expo/src/platform/launch.ts). Pass a stable function:
 * Root subscribes again whenever it changes.
 */
export type LaunchSource = (onLaunch: (target: LaunchTarget) => void) => () => void
export type LaunchRoute = { name: 'title'; slug: string } | { name: 'player'; slug: string; withAd: boolean; startAtS?: number }

/**
 * Where a deep link goes. Unknown titles go nowhere (Home stays), so a stale catalog entry or a mistyped adb command
 * never lands on the offline screen. A play link starts with description per the profile's default.
 *
 * `?t=` is clamped to [0, duration − 1] of the catalog item (the same bound as transport seeks), so a link past the
 * end opens on the last second rather than an ended player. It then reaches Player exactly like a saved resume point
 * (Root passes it as `resumeS`), so whatever rule Player applies to a resume point near the end (DESC-006) applies to
 * `?t=` too. Without a known duration, `?t=` is passed through.
 */
export function routeForLaunch(target: LaunchTarget, catalog: Catalog, adDefault: boolean): LaunchRoute | null {
  const item = catalog.all.find((t) => t.slug === target.slug)
  if (!item) return null
  if (target.kind === 'title') return { name: 'title', slug: target.slug }
  if (target.startAtS === undefined) return { name: 'player', slug: target.slug, withAd: adDefault }
  const d = item.durationS
  const startAtS = Math.max(0, d && d > 0 ? Math.min(target.startAtS, Math.max(0, d - 1)) : target.startAtS)
  return { name: 'player', slug: target.slug, withAd: adDefault, startAtS }
}

/**
 * Root's hook-up: hold the latest deep link until the catalog has loaded and first run is finished, then navigate.
 * A link that arrives during first run is applied when first run ends.
 */
export function useLaunchRoute(source: LaunchSource | undefined, o: {
  catalog: Catalog | null; holding: boolean; adDefault: boolean; navigate: (r: LaunchRoute) => void
}) {
  const [pending, setPending] = useState<LaunchTarget | null>(null)
  useEffect(() => source?.(setPending), [source])
  const { catalog, holding, adDefault, navigate } = o
  useEffect(() => {
    if (!pending || !catalog || holding) return
    setPending(null)
    const r = routeForLaunch(pending, catalog, adDefault)
    if (r) navigate(r)
  }, [pending, catalog, holding, adDefault, navigate])
}
