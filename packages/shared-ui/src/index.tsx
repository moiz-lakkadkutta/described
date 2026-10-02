import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, BackHandler, View } from 'react-native'
import { SpatialNavigationRoot, useLockSpatialNavigation } from 'react-tv-space-navigation'
import { useDpad } from '@moizp/vega-media-kit/focus'
import type { About as AboutData, Catalog, Prefs, PromptKey, TitleDetail } from '@described/contracts'
import { screenReaderOn } from './a11y'
import { Focusable, FontsLoadedContext, Rail, Screen, T } from './components'
import { setDpadGate } from './focus/remote'
import { captionName, nextCaptionKind, type SampleState } from './models'
import { About } from './screens/About'
import { FirstRun } from './screens/FirstRun'
import { Home } from './screens/Home'
import { usePlatformNowPlaying, useLaunchRoute, type LaunchSource } from './platform'
import { Player, type PlayerSession } from './screens/Player'
import { Settings } from './screens/Settings'
import { Reading, Title } from './screens/Title'
import { strings } from './strings'
import { createQueue } from './queue'
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

type Route = { name: 'home' } | { name: 'title'; slug: string } | { name: 'reading'; slug: string } | { name: 'player'; slug: string; withAd: boolean; startAtS?: number } | { name: 'settings' } | { name: 'about' } | { name: 'firstRun'; from?: 'settings' }
const noSpeech = async () => {}
const noop = () => {}
const defaultPrefs: Prefs = { adDefault: true, extendedMode: true, voice: 'Joanna', captionKind: 'sdh', captionScale: 100, captionStyle: 'box', firstRunDone: false }
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
  /** Platform audio: resolves when the clip ends, fails, times out or is stopped. "Hear a sample", first-run prompts, Settings "Hear it" and extended cues. */
  speak?: (url: string) => Promise<void>
  stopSpeaking?: () => void
  /** Starts loading a clip so a later `speak(url)` starts at once (Extended mode, 10 s ahead). Optional. */
  prefetch?: (url: string) => void
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
export function Root({ apiBaseUrl, scale, deviceId = 'dev-device', fontsLoaded = true, speak = noSpeech, stopSpeaking = noop, prefetch = noop, onNowPlaying, launches }: RootProps) {
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
  useLaunchRoute(launches, { catalog, holding: offline || route.name === 'firstRun', adDefault: prefs.adDefault, navigate: setRoute })
  // Media session, Alexa transport and watch activity consume the Player's now-playing; the prop still sees every update.
  const nowPlaying = usePlatformNowPlaying(onNowPlaying)

  /** Settings changed here but not yet saved; kept until a PUT succeeds and laid over any prefs fetched meanwhile. */
  const unsaved = useRef<Partial<Prefs>>({})
  const flushPrefs = useRef<() => void>(() => {})
  const api = useCallback(async <R,>(path: string, init?: RequestInit): Promise<R> => {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
    try {
      const r = await fetch(apiBaseUrl + path, { ...init, signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-device-id': deviceId, ...(init?.headers ?? {}) } })
      const j = (await r.json()) as { success: boolean; data: R }
      if (!j.success) throw new Error('api')
      // The connection is back: send any settings a failed save left behind (a prefs PUT flushes itself).
      if (!(path === '/me/prefs' && init?.method === 'PUT') && Object.keys(unsaved.current).length) flushPrefs.current()
      return j.data
    } finally { clearTimeout(timer) }
  }, [apiBaseUrl, deviceId])

  useEffect(() => {
    Promise.all([api<Catalog>('/catalog'), api<Prefs>('/me/prefs')])
      .then(([c, p]) => {
        const merged = { ...defaultPrefs, ...p, ...unsaved.current } // unsaved local changes win over the server's copy
        setCatalog(c); setPrefs(merged); setOffline(false)
        // First run until the profile says it is done (a Retry while on Title must not jump there).
        if (!merged.firstRunDone) setRoute((r) => (r.name === 'home' ? { name: 'firstRun' } : r))
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
        // Player owns Back once it is mounted (it closes the track sheet or saves the position first). While the title is
        // still loading or the offline screen is up there is no Player, so Back goes to Title instead of leaving the app.
        case 'player': if (current && !offline) return false; setRoute({ name: 'title', slug: route.slug }); return true
        default: return false
      }
    })
    return () => sub.remove()
  }, [route, current, offline])

  /** Extended cue `d{n}`'s clip: the API redirects to the published MP3 (404 when the title has none). */
  const cueAudioUrl = useCallback((s: string, cueId: string) => `${apiBaseUrl}/titles/${encodeURIComponent(s)}/cues/${encodeURIComponent(cueId)}/audio`, [apiBaseUrl])
  // PUTs go one at a time, in order (createQueue), so quick ◄► presses can't land out of order and persist an older value. A failed
  // PUT keeps its changes in `unsaved`; they go with the next save, the next successful request, or Retry. The failure
  // is announced once per outage.
  const prefsQueue = useRef(createQueue()).current
  const toldUnsaved = useRef(false)
  flushPrefs.current = () => {
    void prefsQueue(async () => {
      const body = { ...unsaved.current }
      if (!Object.keys(body).length) return
      try {
        await api('/me/prefs', { method: 'PUT', body: JSON.stringify(body) })
        for (const k of Object.keys(body) as (keyof Prefs)[]) if (unsaved.current[k] === body[k]) delete unsaved.current[k]
        toldUnsaved.current = false
      } catch {
        if (!toldUnsaved.current) { toldUnsaved.current = true; AccessibilityInfo.announceForAccessibility(strings.a11y.notSaved) }
      }
    })
  }
  const savePrefs = (p: Partial<Prefs>) => {
    unsaved.current = { ...unsaved.current, ...p }
    setPrefs((cur) => ({ ...cur, ...p }))
    flushPrefs.current()
  }
  // Progress: PUT /me/progress every PROGRESS_SAVE_S of movement while playing, and on Back (then back to Title,
  // whose cached detail takes the new resume point so Play resumes there without a refetch).
  const savedAt = useRef<number | null>(null)
  const savedThisPlay = useRef(false)
  useEffect(() => { savedAt.current = null; savedThisPlay.current = false }, [key])
  // One PUT at a time, in order, so an older position can never land after a newer one.
  const progressQueue = useRef(createQueue()).current
  const saveProgress = (slug: string, positionS: number) => {
    savedAt.current = positionS; savedThisPlay.current = true
    const body = JSON.stringify({ titleSlug: slug, positionS: Math.max(0, Math.round(positionS)) })
    progressQueue(() => api('/me/progress', { method: 'PUT', body })).catch(() => {})
  }
  const leavePlayer = (t: TitleDetail, positionS: number) => {
    // Nothing watched and nothing saved before: no row (it would only say "0 s").
    if (!(positionS < 1 && !t.resumeS && !savedThisPlay.current)) saveProgress(t.slug, positionS)
    setTitle({ ...t, resumeS: positionS })
    setRoute({ name: 'title', slug: t.slug })
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
  const toggleList = (s: string) => {
    const name = catalog?.all.find((i) => i.slug === s)?.name ?? (current?.slug === s ? current.name : s)
    AccessibilityInfo.announceForAccessibility(myList.has(s) ? strings.a11y.listRemoved(name) : strings.a11y.listAdded(name))
    setMyList((l) => { const n = new Set(l); if (n.has(s)) n.delete(s); else n.add(s); return n })
  }
  const cycleCaptions = () => {
    const next = nextCaptionKind(prefs.captionKind)
    savePrefs({ captionKind: next })
    AccessibilityInfo.announceForAccessibility(strings.a11y.captions(captionName(next)))
  }
  const rail = <Rail current={route.name === 'settings' || route.name === 'about' ? 'settings' : 'home'} items={[{ key: 'home', label: strings.rail.home }, { key: 'described', label: strings.rail.described }, { key: 'list', label: strings.rail.list }, { key: 'settings', label: strings.rail.settings }]} onSelect={(k) => setRoute(k === 'settings' ? { name: 'settings' } : { name: 'home' })} /> // TODO(DESC-011): Described and My list screens; both open Home until then

  const loading = !offline && ((route.name === 'home' && !catalog) || ((route.name === 'title' || route.name === 'reading') && !current) || (route.name === 'about' && about === null))
  // Loading beyond 2 s is spoken (PLAN §8); the skeletons say it to everyone else.
  useEffect(() => { if (!loading) return; const t = setTimeout(() => AccessibilityInfo.announceForAccessibility(strings.a11y.loading), 2000); return () => clearTimeout(t) }, [loading, key])
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
            onCaptions={cycleCaptions} onToggleList={() => toggleList(route.slug)}
            onMore={() => setRoute({ name: 'reading', slug: route.slug })} />
        </Screen>
      )
      // Extended cues speak their own clip (cueAudioUrl), never the sample's.
      case 'player': return current ? (
        <Player title={current} prefs={prefs} withAd={route.withAd} startAtS={route.startAtS} scale={scale} onPrefs={savePrefs} onNowPlaying={nowPlaying}
          speak={speak} stopSpeaking={stopSpeaking} prefetch={prefetch} cueAudioUrl={cueAudioUrl} descriptionsUrl={`${apiBaseUrl}/titles/${encodeURIComponent(current.slug)}/descriptions.vtt`}
          onProgress={(s) => { if (savedAt.current === null) savedAt.current = s; else if (Math.abs(s - savedAt.current) >= PROGRESS_SAVE_S) saveProgress(current.slug, s) }}
          onBack={(s) => leavePlayer(current, s)} />
      ) : <Screen><T variant="body">{strings.player.loading}</T></Screen>
      default: return <Screen rail={rail}><Home catalog={catalog} myList={myList} adDefault={prefs.adDefault} onOpen={(s) => setRoute({ name: 'title', slug: s })} onPlay={(s, withAd) => setRoute({ name: 'player', slug: s, withAd })} onToggleList={toggleList} /></Screen>
    }
  })()
  return (
    <FontsLoadedContext.Provider value={fontsLoaded}>
      <View style={{ flex: 1, backgroundColor: tokens.color.ground }}>
        <SpatialNavigationRoot key={offline ? 'offline' : key}>
          <LockWhile locked={loading} />
          {screen}
        </SpatialNavigationRoot>
      </View>
    </FontsLoadedContext.Provider>
  )
}
