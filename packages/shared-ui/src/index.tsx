import React, { useCallback, useEffect, useRef, useState } from 'react'
import { BackHandler, View } from 'react-native'
import { SpatialNavigationRoot } from 'react-tv-space-navigation'
import { useDpad } from '@moizp/vega-media-kit/focus'
import type { Catalog, Prefs, TitleDetail } from '@described/contracts'
import { Focusable, FontsLoadedContext, Rail, Screen, T } from './components'
import { setDpadGate } from './focus/remote'
import { nextCaptionKind, type SampleState } from './models'
import { FirstRun } from './screens/FirstRun'
import { Home } from './screens/Home'
import { Player } from './screens/Player'
import { Settings } from './screens/Settings'
import { Reading, Title } from './screens/Title'
import { strings } from './strings'
import { tokens } from './theme/tokens'
import { px } from './theme/scale'
export { tokens } from './theme/tokens'
export * from './components'
export { configureRemote } from './focus'
export type { KeySource } from './focus'

type Route = { name: 'home' } | { name: 'title'; slug: string } | { name: 'reading'; slug: string } | { name: 'player'; slug: string; withAd: boolean } | { name: 'settings' } | { name: 'firstRun' }
const defaultPrefs: Prefs = { adDefault: true, extendedMode: true, voice: 'Joanna', captionKind: 'sdh', captionScale: 100, firstRunDone: false }
const routeKey = (r: Route) => ('slug' in r ? `${r.name}:${r.slug}` : r.name)

export interface RootProps {
  apiBaseUrl: string; scale: number; deviceId?: string
  /** False when the platform could not load Atkinson Hyperlegible: system sans at the same sizes. */
  fontsLoaded?: boolean
  /** Platform audio: resolves when the clip ends or is stopped. Used for "Hear a sample" (and extended cues, DESC-007). */
  speak?: (url: string) => Promise<void>
  stopSpeaking?: () => void
}

/**
 * Root: state-based router, rail, data loading. One SpatialNavigationRoot per route (keyed), so each screen mounts
 * with fresh focus and its DefaultFocus / focus memory decides where focus lands.
 * Platform entries (apps/expo, apps/vega) pass apiBaseUrl, scale, fonts state and audio; they call configureRemote first.
 */
export function Root({ apiBaseUrl, scale, deviceId = 'dev-device', fontsLoaded = true, speak = async () => {}, stopSpeaking = () => {} }: RootProps) {
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

  const api = useCallback(async <R,>(path: string, init?: RequestInit): Promise<R> => {
    const r = await fetch(apiBaseUrl + path, { ...init, headers: { 'content-type': 'application/json', 'x-device-id': deviceId, ...(init?.headers ?? {}) } })
    const j = (await r.json()) as { success: boolean; data: R }
    if (!j.success) throw new Error('api')
    return j.data
  }, [apiBaseUrl, deviceId])

  useEffect(() => {
    Promise.all([api<Catalog>('/catalog'), api<Prefs>('/me/prefs')])
      .then(([c, p]) => { setCatalog(c); setPrefs({ ...defaultPrefs, ...p }); setOffline(false); if (!p.firstRunDone) setRoute({ name: 'firstRun' }) })
      .catch(() => setOffline(true))
  }, [api, attempt])
  const slug = 'slug' in route ? route.slug : null
  useEffect(() => { if (slug && title?.slug !== slug) api<TitleDetail>(`/titles/${slug}`).then(setTitle).catch(() => setOffline(true)) }, [slug, api]) // eslint-disable-line react-hooks/exhaustive-deps
  const current = title && title.slug === slug ? title : null

  const sampleOn = useRef(false)
  const stopSample = useCallback(() => { if (sampleOn.current) { sampleOn.current = false; stopSpeaking(); setSample('idle') } }, [stopSpeaking])
  useEffect(() => { if (route.name !== 'title') stopSample() }, [route.name, stopSample])
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
        case 'player': setRoute({ name: 'title', slug: route.slug }); return true
        default: return false
      }
    })
    return () => sub.remove()
  }, [route])

  const savePrefs = (p: Partial<Prefs>) => { setPrefs({ ...prefs, ...p }); void api('/me/prefs', { method: 'PUT', body: JSON.stringify(p) }).catch(() => {}) }
  const toggleList = (s: string) => setMyList((l) => { const n = new Set(l); if (n.has(s)) n.delete(s); else n.add(s); return n })
  const rail = <Rail current={route.name === 'settings' ? 'settings' : 'home'} items={[{ key: 'home', label: strings.rail.home }, { key: 'described', label: strings.rail.described }, { key: 'list', label: strings.rail.list }, { key: 'settings', label: strings.rail.settings }]} onSelect={(k) => setRoute(k === 'settings' ? { name: 'settings' } : { name: 'home' })} />

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
      case 'player': return current ? <Player title={current} prefs={prefs} withAd={route.withAd} scale={scale} speak={speak} onProgress={(s) => { if (Math.round(s) % 10 === 0) void api('/me/progress', { method: 'PUT', body: JSON.stringify({ titleSlug: current.slug, positionS: s }) }).catch(() => {}) }} onBack={() => setRoute({ name: 'title', slug: current.slug })} /> : <Screen><T variant="body">{strings.player.loading}</T></Screen>
      default: return <Screen rail={rail}><Home catalog={catalog} myList={myList} onOpen={(s) => setRoute({ name: 'title', slug: s })} onPlay={(s, withAd) => setRoute({ name: 'player', slug: s, withAd })} onToggleList={toggleList} /></Screen>
    }
  })()
  return (
    <FontsLoadedContext.Provider value={fontsLoaded}>
      <View style={{ flex: 1, backgroundColor: tokens.color.ground }}>
        <SpatialNavigationRoot key={offline ? 'offline' : routeKey(route)}>{screen}</SpatialNavigationRoot>
      </View>
    </FontsLoadedContext.Provider>
  )
}
