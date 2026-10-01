/**
 * Deep links into the TV app (DESC-008). One format, shared by the API's Fire TV catalog feed (which writes them) and
 * the app's launch handling (which reads them):
 *
 *   described://title/{slug}            open the Title screen
 *   described://play/{slug}             start the Player (resume point from the profile's progress)
 *   described://play/{slug}?t=754       start the Player at 754 s
 *
 * Parsed by hand, not with `URL`: React Native's URL polyfill does not parse custom schemes reliably on Hermes.
 * The Android intent filter for the scheme comes from `scheme` in apps/expo/app.json.
 */
export const DEEP_LINK_SCHEME = 'described'

export type LaunchTarget = { kind: 'title'; slug: string } | { kind: 'play'; slug: string; startAtS?: number }

const SLUG = /^[a-z0-9][a-z0-9-]{0,127}$/

export const titleLink = (slug: string) => `${DEEP_LINK_SCHEME}://title/${slug}`
export const playLink = (slug: string, startAtS?: number) =>
  `${DEEP_LINK_SCHEME}://play/${slug}${startAtS !== undefined && startAtS > 0 ? `?t=${Math.floor(startAtS)}` : ''}`

/** The launch target for a deep link, or null for anything that is not one of ours (wrong scheme, unknown path, bad slug). */
export function parseDeepLink(url: string | null | undefined): LaunchTarget | null {
  if (!url) return null
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)\/([^/?#]+)\/?(?:\?([^#]*))?(?:#.*)?$/i.exec(url.trim())
  if (!m || m[1]!.toLowerCase() !== DEEP_LINK_SCHEME) return null
  const host = m[2]!.toLowerCase()
  let slug: string
  try { slug = decodeURIComponent(m[3]!).toLowerCase() } catch { return null }
  if (!SLUG.test(slug)) return null
  if (host === 'title') return { kind: 'title', slug }
  if (host !== 'play') return null
  const t = query(m[4] ?? '').get('t')
  const startAtS = t !== undefined && /^\d+(\.\d+)?$/.test(t) ? Number(t) : undefined
  return startAtS !== undefined && startAtS > 0 ? { kind: 'play', slug, startAtS } : { kind: 'play', slug }
}

function query(q: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const part of q.split('&')) {
    if (!part) continue
    const [k, v = ''] = part.split('=')
    try { out.set(decodeURIComponent(k!), decodeURIComponent(v)) } catch { /* skip malformed pairs */ }
  }
  return out
}
