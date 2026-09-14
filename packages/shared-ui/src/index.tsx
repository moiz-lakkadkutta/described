import React, { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import type { Catalog, Prefs, TitleDetail } from '@described/contracts'
import { Rail, Screen, T } from './components'
import { FirstRun } from './screens/FirstRun'
import { Home } from './screens/Home'
import { Player } from './screens/Player'
import { Settings } from './screens/Settings'
import { Title } from './screens/Title'
import { strings } from './strings'
import { tokens } from './theme/tokens'
export { tokens } from './theme/tokens'
export * from './components'

type Route = { name: 'home' } | { name: 'title'; slug: string } | { name: 'player'; slug: string; withAd: boolean } | { name: 'settings' } | { name: 'firstRun' }
const defaultPrefs: Prefs = { adDefault: true, extendedMode: true, voice: 'Joanna', captionKind: 'sdh', captionScale: 100, firstRunDone: false }

/**
 * Root: state-based router (no React Navigation until KIT/DESC decide the focus story on Vega), rail, data loading.
 * Platform entries (apps/expo, apps/vega) pass apiBaseUrl and scale. `speak` uses the platform's audio player (TODO DESC-007).
 */
export function Root({ apiBaseUrl, scale, deviceId = 'dev-device', speak = async () => {} }: { apiBaseUrl: string; scale: number; deviceId?: string; speak?: (url: string) => Promise<void> }) {
  const [route, setRoute] = useState<Route>({ name: 'home' })
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [title, setTitle] = useState<TitleDetail | null>(null)
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs)
  const [offline, setOffline] = useState(false)
  const headers = { 'content-type': 'application/json', 'x-device-id': deviceId }
  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const r = await fetch(apiBaseUrl + path, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } })
    const j = (await r.json()) as { success: boolean; data: T }
    if (!j.success) throw new Error('api')
    return j.data
  }, [apiBaseUrl, deviceId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    Promise.all([api<Catalog>('/catalog'), api<Prefs>('/me/prefs')])
      .then(([c, p]) => { setCatalog(c); setPrefs({ ...defaultPrefs, ...p }); setOffline(false); if (!p.firstRunDone) setRoute({ name: 'firstRun' }) })
      .catch(() => setOffline(true))
  }, [api])
  useEffect(() => { if (route.name === 'title' || route.name === 'player') api<TitleDetail>(`/titles/${route.slug}`).then(setTitle).catch(() => setOffline(true)) }, [route, api])

  const savePrefs = (p: Partial<Prefs>) => { const next = { ...prefs, ...p }; setPrefs(next); void api('/me/prefs', { method: 'PUT', body: JSON.stringify(p) }) }
  const rail = <Rail expanded={false} current={route.name === 'settings' ? 'settings' : 'home'} items={[{ key: 'home', label: strings.rail.home }, { key: 'described', label: strings.rail.described }, { key: 'list', label: strings.rail.list }, { key: 'settings', label: strings.rail.settings }]} onSelect={(k) => setRoute(k === 'settings' ? { name: 'settings' } : { name: 'home' })} />

  if (offline) return <Screen><View style={{ flex: 1, justifyContent: 'center' }} accessibilityLiveRegion="polite"><T variant="heading">{strings.offline}</T></View></Screen>
  switch (route.name) {
    case 'firstRun': return <Screen><FirstRun speakText={() => {}} onDone={(ext) => { savePrefs({ extendedMode: ext, firstRunDone: true }); setRoute({ name: 'home' }) }} /></Screen>
    case 'settings': return <Screen rail={rail}><Settings prefs={prefs} onChange={savePrefs} onHearVoice={() => {}} /></Screen>
    case 'title': return title ? <Screen rail={rail}><Title title={title} onBack={() => setRoute({ name: 'home' })} onHearSample={() => title.sampleCue && speak(title.sampleCue.audioUrl)} onPlay={(withAd) => setRoute({ name: 'player', slug: title.slug, withAd })} /></Screen> : <Screen rail={rail}><T variant="body">{strings.player.loading}</T></Screen>
    case 'player': return title ? <Player title={title} prefs={prefs} withAd={route.withAd} scale={scale} speak={speak} onProgress={(s) => { if (Math.round(s) % 10 === 0) void api('/me/progress', { method: 'PUT', body: JSON.stringify({ titleSlug: title.slug, positionS: s }) }) }} onBack={() => setRoute({ name: 'title', slug: title.slug })} /> : null
    default: return <Screen rail={rail}><Home catalog={catalog} onOpen={(slug) => setRoute({ name: 'title', slug })} onPlay={(slug) => setRoute({ name: 'player', slug, withAd: true })} /></Screen>
  }
}
void tokens
