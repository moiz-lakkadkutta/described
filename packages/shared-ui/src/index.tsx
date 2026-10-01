import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, BackHandler, View } from 'react-native'
import { SpatialNavigationRoot, useLockSpatialNavigation } from 'react-tv-space-navigation'
import { useDpad } from '@moizp/vega-media-kit/focus'
import type { About as AboutData, Catalog, Prefs, PromptKey, TitleDetail } from '@described/contracts'
import { screenReaderOn } from './a11y'
import { Focusable, FontsLoadedContext, Rail, Screen, T } from './components'
import { setDpadGate } from './focus/remote'
import { nextCaptionKind, type SampleState } from './models'
import { About } from './screens/About'
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

type Route = { name: 'home' } | { name: 'title'; slug: string } | { name: 'reading'; slug: string } | { name: 'player'; slug: string; withAd: boolean } | { name: 'settings' } | { name: 'about' } | { name: 'firstRun'; from?: 'settings' }
const noSpeech = async () => {}
const defaultPrefs: Prefs = { adDefault: true, extendedMode: true, voice: 'Joanna', captionKind: 'sdh', captionScale: 100, captionStyle: 'box', firstRunDone: false }
const routeKey = (r: Route) => ('slug' in r ? `${r.name}:${r.slug}` : r.name)
/** RN Android's own fetch timeout is about 2 minutes; the offline screen should come much sooner. */
export const FETCH_TIMEOUT_MS = 10_000

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
  /** Platform audio: resolves when the clip ends or is stopped. Used for "Hear a sample", first-run prompts, Settings "Hear it" (and extended cues, DESC-007). */
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
  const [about, setAbout] = useState<AboutData | null | 'offline'>(null)
  const shouldHandle = useDpad()
  useEffect(() => { setDpadGate(shouldHandle) }, [shouldHandle])

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
      .then(([c, p]) => {
        setCatalog(c); setPrefs({ ...defaultPrefs, ...p }); setOffline(false)
        // First run until the profile says it is done (a Retry while on Title must not jump there).
        if (!p.firstRunDone) setRoute((r) => (r.name === 'home' ? { name: 'firstRun' } : r))
      })
      .catch(() => setOffline(true))
  }, [api, attempt])
  const slug = 'slug' in route ? route.slug : null
  // `attempt` too: Retry on the offline screen must refetch the title, not only the catalog.
  useEffect(() => { if (slug && title?.slug !== slug) api<TitleDetail>(`/titles/${slug}`).then(setTitle).catch(() => setOffline(true)) }, [slug, api, attempt]) // eslint-disable-line react-hooks/exhaustive-deps
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
        case 'about': setRoute({ name: 'settings' }); return true
        case 'firstRun': return false // FirstRun's own listener: previous panel, or Back-Back to skip; never exits
        case 'player': setRoute({ name: 'title', slug: route.slug }); return true
        default: return false
      }
    })
    return () => sub.remove()
  }, [route])

  // PUTs go one at a time, in order, so quick ◄► presses can't land out of order and persist an older value.
  const saving = useRef<Promise<unknown>>(Promise.resolve())
  const savePrefs = (p: Partial<Prefs>) => {
    setPrefs((cur) => ({ ...cur, ...p }))
    saving.current = saving.current.then(() => api('/me/prefs', { method: 'PUT', body: JSON.stringify(p) })).catch(() => {})
  }
  // App-voice prompts: clips at /prompts/<voice>/<key>.mp3 (API → CloudFront; TODO(DESC-010) generate them with Polly in
  // the pipeline). FirstRun always announces the text too; with VoiceView on the clip is skipped so two voices never
  // talk over each other (same rule as earcons, PLAN §8).
  const promptUrl = useCallback((voice: Prefs['voice'], key: PromptKey) => `${apiBaseUrl}/prompts/${voice}/${key}.mp3`, [apiBaseUrl])
  const voice = useRef(prefs.voice)
  voice.current = prefs.voice
  const speakPrompt = useCallback((key: PromptKey) => { if (!screenReaderOn()) speak(promptUrl(voice.current, key)).catch(() => {}) }, [speak, promptUrl])
  const hearVoice = (v: Prefs['voice']) => { speak(promptUrl(v, 'voicePreview')).catch(() => {}) }
  const finishFirstRun = (p: Partial<Prefs>) => { savePrefs({ ...p, firstRunDone: true }); setRoute(route.name === 'firstRun' && route.from === 'settings' ? { name: 'settings' } : { name: 'home' }) }
  useEffect(() => { if (route.name === 'about') api<AboutData>('/about').then(setAbout).catch(() => setAbout('offline')) }, [route.name, api])
  const toggleList = (s: string) => setMyList((l) => { const n = new Set(l); if (n.has(s)) n.delete(s); else n.add(s); return n })
  const rail = <Rail current={route.name === 'settings' || route.name === 'about' ? 'settings' : 'home'} items={[{ key: 'home', label: strings.rail.home }, { key: 'described', label: strings.rail.described }, { key: 'list', label: strings.rail.list }, { key: 'settings', label: strings.rail.settings }]} onSelect={(k) => setRoute(k === 'settings' ? { name: 'settings' } : { name: 'home' })} /> // TODO(DESC-011): Described and My list screens; both open Home until then

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
      case 'firstRun': return <Screen><FirstRun speakPrompt={speakPrompt} onDone={(ext) => finishFirstRun({ extendedMode: ext })} onSkip={() => finishFirstRun({})} /></Screen>
      case 'settings': return <Screen rail={rail}><Settings prefs={prefs} onChange={savePrefs} onHearVoice={hearVoice} onResetFirstRun={() => { savePrefs({ firstRunDone: false }); setRoute({ name: 'firstRun', from: 'settings' }) }} onAbout={() => { setAbout(null); setRoute({ name: 'about' }) }} /></Screen>
      case 'about': return <Screen rail={rail}><About about={about} onClose={() => setRoute({ name: 'settings' })} /></Screen>
      case 'reading': return <Screen><Reading title={current} onClose={() => setRoute({ name: 'title', slug: route.slug })} /></Screen>
      case 'title': return (
        <Screen rail={rail}>
          <Title title={current} adDefault={prefs.adDefault} captionKind={prefs.captionKind} inList={myList.has(route.slug)} sample={sample}
            onPlay={(withAd) => setRoute({ name: 'player', slug: route.slug, withAd })} onSample={toggleSample}
            onCaptions={() => savePrefs({ captionKind: nextCaptionKind(prefs.captionKind) })} onToggleList={() => toggleList(route.slug)}
            onMore={() => setRoute({ name: 'reading', slug: route.slug })} />
        </Screen>
      )
      // TODO(DESC-007): pass `speak` once extended cues carry their own audio; today Player would play the sample clip.
      case 'player': return current ? <Player title={current} prefs={prefs} withAd={route.withAd} scale={scale} speak={noSpeech} onProgress={(s) => { if (Math.round(s) % 10 === 0) void api('/me/progress', { method: 'PUT', body: JSON.stringify({ titleSlug: current.slug, positionS: s }) }).catch(() => {}) }} onBack={() => setRoute({ name: 'title', slug: current.slug })} /> : <Screen><T variant="body">{strings.player.loading}</T></Screen>
      default: return <Screen rail={rail}><Home catalog={catalog} myList={myList} adDefault={prefs.adDefault} onOpen={(s) => setRoute({ name: 'title', slug: s })} onPlay={(s, withAd) => setRoute({ name: 'player', slug: s, withAd })} onToggleList={toggleList} /></Screen>
    }
  })()
  return (
    <FontsLoadedContext.Provider value={fontsLoaded}>
      <View style={{ flex: 1, backgroundColor: tokens.color.ground }}>
        <SpatialNavigationRoot key={offline ? 'offline' : key}>
          <LockWhile locked={!offline && ((route.name === 'home' && !catalog) || ((route.name === 'title' || route.name === 'reading') && !current) || (route.name === 'about' && about === null))} />
          {screen}
        </SpatialNavigationRoot>
      </View>
    </FontsLoadedContext.Provider>
  )
}
