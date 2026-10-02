import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, BackHandler, View } from 'react-native'
import { SpatialNavigationRoot, useLockSpatialNavigation } from 'react-tv-space-navigation'
import { useDpad } from '@moizp/vega-media-kit/focus'
import type { Catalog, Prefs, TitleDetail } from '@described/contracts'
import { Focusable, FontsLoadedContext, Rail, Screen, T } from './components'
import { setDpadGate } from './focus/remote'
import { nextCaptionKind, type SampleState } from './models'
import { FirstRun } from './screens/FirstRun'
import { Home } from './screens/Home'
import { usePlatformNowPlaying, useLaunchRoute, type LaunchRoute, type LaunchSource } from './platform'
import { Player, type PlayerSession } from './screens/Player'
import { Settings } from './screens/Settings'
import { Reading, Title } from './screens/Title'
import { strings } from './strings'
import { tokens } from './theme/tokens'
import { px } from './theme/scale'
export { tokens } from './theme/tokens'
export * from './components'
export { configureRemote } from './focus'
export type { KeySource } from './focus'
export type { PlayerSession } from './screens/Player'
export * from './platform'
export { parseDeepLink } from '@described/contracts'
export type { LaunchTarget } from '@described/contracts'

type Route = { name: 'home' } | { name: 'title'; slug: string } | { name: 'reading'; slug: string } | { name: 'player'; slug: string; withAd: boolean; startAtS?: number } | { name: 'settings' } | { name: 'firstRun' }
const noSpeech = async () => {}
const noStop = () => {}
const defaultPrefs: Prefs = { adDefault: true, extendedMode: true, voice: 'Joanna', captionKind: 'sdh', captionScale: 100, firstRunDone: false }
// A player route keys on its audio and start too, so a new deep link to the same title remounts the Player.
const routeKey = (r: Route) => (r.name === 'player' ? `player:${r.slug}:${r.withAd ? 'ad' : 'main'}:${r.startAtS ?? ''}` : 'slug' in r ? `${r.name}:${r.slug}` : r.name)
/** RN Android's own fetch timeout is about 2 minutes; the offline screen should come much sooner. */
export const FETCH_TIMEOUT_MS = 10_000
/** While playing, the position is saved after it has moved this far (and always on Back). */
export const PROGRESS_SAVE_S = 10

/** Locks the D-pad while a screen has nothing focusable yet, so a press can't strand focus in the rail before DefaultFocus applies. */
function LockWhile({ locked }: { locked: boolean }) {
  const { lock, unlock } = useLockSpatialNavigation()
  useEffect(() => { if (locked) { lock(); return unlock } }, [locked, lock, unlock])
  return null
}

export interface RootProps {
  apiBaseUrl: string; scale: number; deviceId?: string
  /** False when the platform could not load Atkinson Hyperlegible: system sans at the same sizes. */
  fontsLoaded?: boolean
  /** Platform audio: resolves when the clip ends or is stopped. Used for "Hear a sample" (and extended cues, DESC-007). */
  speak?: (url: string) => Promise<void>
  stopSpeaking?: () => void
  /** The film on screen and its controls, `null` when the player closes — for Media Controls / Alexa (DESC-008). */
  onNowPlaying?: (session: PlayerSession | null) => void
  /** Deep links (`described://title/…`, `described://play/…`) the app is opened with (DESC-008). Pass a stable function. */
  launches?: LaunchSource
}

/**
 * Root: state-based router, rail, data loading. One SpatialNavigationRoot per route (keyed), so each screen mounts
 * with fresh focus and its DefaultFocus / focus memory decides where focus lands.
 * Platform entries (apps/expo, apps/vega) pass apiBaseUrl, scale, fonts state and audio; they call configureRemote first.
 */
export function Root({ apiBaseUrl, scale, deviceId = 'dev-device', fontsLoaded = true, speak = noSpeech, stopSpeaking = noStop, onNowPlaying, launches }: RootProps) {
  const [route, setRoute] = useState<Route>({ name: 'home' })
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [title, setTitle] = useState<TitleDetail | null>(null)
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs)
  const [offline, setOffline] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [myList, setMyList] = useState<ReadonlySet<string>>(new Set()) // TODO: no My list API yet; kept for the session
  const [sample, setSample] = useState<SampleState>('idle')
  const shouldHandle = useDpad()
  useEffect(() => { setDpadGate(shouldHandle) }, [shouldHandle])
  // Media session, Alexa transport and watch activity consume the Player's now-playing; the prop still sees every update.
  // Root keeps the latest session too: a deep link that replaces the Player saves its position first (exitPlayer).
  const playerSession = useRef<PlayerSession | null>(null)
  const nowPlaying = usePlatformNowPlaying((s) => { playerSession.current = s; onNowPlaying?.(s) })

  const api = useCallback(async <R,>(path: string, init?: RequestInit): Promise<R> => {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
    try {
      const r = await fetch(apiBaseUrl + path, { ...init, signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-device-id': deviceId, ...(init?.headers ?? {}) } })
      const j = (await r.json()) as { success: boolean; data: R }
      if (!j.success) throw new Error('api')
      return j.data
    } finally { clearTimeout(timer) }
  }, [apiBaseUrl, deviceId])

  useEffect(() => {
    Promise.all([api<Catalog>('/catalog'), api<Prefs>('/me/prefs')])
      .then(([c, p]) => { setCatalog(c); setPrefs({ ...defaultPrefs, ...p }); setOffline(false); if (!p.firstRunDone) setRoute({ name: 'firstRun' }) })
      .catch(() => setOffline(true))
  }, [api, attempt])
  const slug = 'slug' in route ? route.slug : null
  // `attempt` too: Retry on the offline screen must refetch the title, not only the catalog.
  // `live`: a late answer for a slug we already left must not replace the title or flip the app offline.
  useEffect(() => {
    if (!slug || title?.slug === slug) return
    let live = true
    api<TitleDetail>(`/titles/${slug}`).then((t) => { if (live) setTitle(t) }).catch(() => { if (live) setOffline(true) })
    return () => { live = false }
  }, [slug, api, attempt]) // eslint-disable-line react-hooks/exhaustive-deps
  const current = title && title.slug === slug ? title : null
  // A live region does not speak on first appearance, so the offline message is announced explicitly.
  useEffect(() => { if (offline) AccessibilityInfo.announceForAccessibility(strings.offline) }, [offline])

  const sampleOn = useRef(false)
  const stopSample = useCallback(() => { if (sampleOn.current) { sampleOn.current = false; stopSpeaking(); setSample('idle') } }, [stopSpeaking])
  // Leaving a screen stops any clip it started (Title's sample; Player's description audio from DESC-007).
  const key = routeKey(route)
  useEffect(() => () => { stopSpeaking(); sampleOn.current = false; setSample('idle') }, [key, stopSpeaking])
  const toggleSample = () => {
    if (sampleOn.current) return stopSample()
    if (!current?.sampleCue) return
    sampleOn.current = true; setSample('playing')
    speak(current.sampleCue.audioUrl).catch(() => {}).finally(() => { sampleOn.current = false; setSample('idle') })
  }

  // Back: reading → title → home; player → title; settings → home. On Home, Back leaves the app (platform default).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      switch (route.name) {
        case 'reading': setRoute({ name: 'title', slug: route.slug }); return true
        case 'title': case 'settings': setRoute({ name: 'home' }); return true
        // A mounted Player owns Back (it closes the track sheet or saves the position first). Without one — the title
        // still loading, or the offline screen — Back goes to Title rather than leaving the app.
        case 'player': if (!current || offline) { setRoute({ name: 'title', slug: route.slug }); return true } return false
        default: return false
      }
    })
    return () => sub.remove()
  }, [route, current, offline])

  const savePrefs = (p: Partial<Prefs>) => { setPrefs((cur) => ({ ...cur, ...p })); void api('/me/prefs', { method: 'PUT', body: JSON.stringify(p) }).catch(() => {}) }
  // Progress: PUT /me/progress every PROGRESS_SAVE_S of movement while playing, and on Back (then back to Title,
  // whose cached detail takes the new resume point so Play resumes there without a refetch).
  const savedAt = useRef<number | null>(null)
  const savedThisPlay = useRef(false)
  useEffect(() => { savedAt.current = null; savedThisPlay.current = false }, [key])
  // One PUT at a time, in order, so an older position can never land after a newer one.
  const progressQueue = useRef<Promise<unknown>>(Promise.resolve())
  const catalogStale = useRef(false)
  const saveProgress = (slug: string, positionS: number) => {
    savedAt.current = positionS; savedThisPlay.current = true; catalogStale.current = true
    const body = JSON.stringify({ titleSlug: slug, positionS: Math.max(0, Math.round(positionS)) })
    progressQueue.current = progressQueue.current.then(() => api('/me/progress', { method: 'PUT', body })).catch(() => {})
  }
  // Continue watching: after a save, Home refetches the catalog once the queued saves have landed. The old catalog
  // stays on screen meanwhile (no skeleton), so Home's focus memory is untouched.
  const onHome = route.name === 'home'
  useEffect(() => {
    if (!onHome || !catalogStale.current) return
    catalogStale.current = false
    let live = true, done = false
    void progressQueue.current.then(() => api<Catalog>('/catalog')).then((c) => { done = true; if (live) setCatalog(c) }).catch(() => { done = true })
    return () => { live = false; if (!done) catalogStale.current = true } // left Home first: refetch next time
  }, [onHome, api])
  /**
   * Leaving a mounted Player — its Back, or a deep link that replaces it: save the position (which marks the catalog
   * stale, so Home refetches Continue watching), then go to `next` (Title on Back). With no Player mounted (title still
   * loading, offline) Root's own Back goes to Title and a deep link just navigates: there is no position to save.
   */
  const exitPlayer = (t: TitleDetail, positionS: number, next: Route = { name: 'title', slug: t.slug }) => {
    // Nothing watched and nothing saved before: no row (it would only say "0 s").
    if (!(positionS < 1 && !t.resumeS && !savedThisPlay.current)) saveProgress(t.slug, positionS)
    setTitle({ ...t, resumeS: positionS })
    setRoute(next)
  }
  // A deep link during playback takes the same save path as Back (position as Back reads it: 0 once the film ended).
  const launchTo = (r: LaunchRoute) => {
    const s = playerSession.current
    if (route.name === 'player' && !offline && current && s?.slug === current.slug) exitPlayer(current, s.state === 'ended' ? 0 : s.controls.getPosition(), r)
    else setRoute(r)
  }
  useLaunchRoute(launches, { catalog, holding: offline || route.name === 'firstRun', adDefault: prefs.adDefault, navigate: launchTo })
  const toggleList = (s: string) => setMyList((l) => { const n = new Set(l); if (n.has(s)) n.delete(s); else n.add(s); return n })
  const rail = <Rail current={route.name === 'settings' ? 'settings' : 'home'} items={[{ key: 'home', label: strings.rail.home }, { key: 'described', label: strings.rail.described }, { key: 'list', label: strings.rail.list }, { key: 'settings', label: strings.rail.settings }]} onSelect={(k) => setRoute(k === 'settings' ? { name: 'settings' } : { name: 'home' })} /> // TODO(DESC-011): Described and My list screens; both open Home until then

  const screen = (() => {
    if (offline) return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', gap: px(32) }}>
          <View accessibilityLiveRegion="polite"><T variant="heading" style={{ maxWidth: px(1200) }}>{strings.offline}</T></View>
          <Focusable label={strings.a11y.retry} defaultFocus onPress={() => { setOffline(false); setCatalog(null); setAttempt((a) => a + 1) }}
            style={{ alignSelf: 'flex-start', backgroundColor: tokens.color.surface2, paddingHorizontal: px(28), paddingVertical: px(12) }} focusedStyle={{ backgroundColor: tokens.color.surface3 }}>
            <T variant="body">{strings.retry}</T>
          </Focusable>
        </View>
      </Screen>
    )
    switch (route.name) {
      case 'firstRun': return <Screen><FirstRun speakText={() => {}} onDone={(ext) => { savePrefs({ extendedMode: ext, firstRunDone: true }); setRoute({ name: 'home' }) }} /></Screen>
      case 'settings': return <Screen rail={rail}><Settings prefs={prefs} onChange={savePrefs} onHearVoice={() => {}} /></Screen>
      case 'reading': return <Screen><Reading title={current} onClose={() => setRoute({ name: 'title', slug: route.slug })} /></Screen>
      case 'title': return (
        <Screen rail={rail}>
          <Title title={current} captionKind={prefs.captionKind} inList={myList.has(route.slug)} sample={sample}
            onPlay={(withAd) => setRoute({ name: 'player', slug: route.slug, withAd })} onSample={toggleSample}
            onCaptions={() => savePrefs({ captionKind: nextCaptionKind(prefs.captionKind) })} onToggleList={() => toggleList(route.slug)}
            onMore={() => setRoute({ name: 'reading', slug: route.slug })} />
        </Screen>
      )
      // TODO(DESC-007): pass `speak` once extended cues carry their own audio; today Player would play the sample clip.
      case 'player': return current ? (
        <Player title={current} prefs={prefs} withAd={route.withAd} startAtS={route.startAtS} scale={scale} speak={noSpeech} onPrefs={savePrefs} onNowPlaying={nowPlaying}
          onProgress={(s) => { if (savedAt.current === null) savedAt.current = s; else if (Math.abs(s - savedAt.current) >= PROGRESS_SAVE_S) saveProgress(current.slug, s) }}
          onBack={(s) => exitPlayer(current, s)} />
      ) : <Screen><T variant="body">{strings.player.loading}</T></Screen>
      default: return <Screen rail={rail}><Home catalog={catalog} myList={myList} onOpen={(s) => setRoute({ name: 'title', slug: s })} onPlay={(s, withAd) => setRoute({ name: 'player', slug: s, withAd })} onToggleList={toggleList} /></Screen>
    }
  })()
  return (
    <FontsLoadedContext.Provider value={fontsLoaded}>
      <View style={{ flex: 1, backgroundColor: tokens.color.ground }}>
        <SpatialNavigationRoot key={offline ? 'offline' : key}>
          <LockWhile locked={!offline && ((route.name === 'home' && !catalog) || ((route.name === 'title' || route.name === 'reading') && !current))} />
          {screen}
        </SpatialNavigationRoot>
      </View>
    </FontsLoadedContext.Provider>
  )
}
