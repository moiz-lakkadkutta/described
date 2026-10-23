import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createKeyHub } from '../src/keys'

const require = createRequire(import.meta.url)
const keyEvent = require('../plugins/withKeyEvent.js') as { patch: (s: string) => string }
type Manifest = { manifest: { application: { $: Record<string, string>; 'meta-data'?: { $: Record<string, string> }[] }[] } }
const fireTvVoice = require('../plugins/withFireTvVoice.js') as { patch: (m: Manifest) => Manifest }
const tvBanner = require('../plugins/withTvBanner.js') as { patch: (m: Manifest) => Manifest; SOURCE: string; RES_DIR: string }
type FeatureManifest = { manifest: { $: Record<string, string>; 'uses-feature'?: { $: Record<string, string> }[] } }
const tvFeatures = require('../plugins/withTvFeatures.js') as { patch: (m: FeatureManifest) => FeatureManifest; FEATURES: string[] }
const appJson = require('../app.json') as {
  expo: { icon: string; plugins: (string | unknown[])[]; android: { permissions: string[]; blockedPermissions: string[]; adaptiveIcon: { foregroundImage: string; backgroundColor: string } } }
}
const localApi = require('../plugins/withLocalApi.js') as { cleartextHost: (u?: string) => string | null; securityConfig: (h: string) => string; debugSecurityConfig: () => string }

/**
 * expo-audio as 1.1.1 behaves on Android (AudioPlayer.kt): prepared on creation, so `buffering` at once; a good clip goes
 * `ready` → plays → `ended` with didJustFinish; a failed load (404) sends `isLoaded: true` (onIsLoadingChanged(false))
 * and then `idle` — never `error`. `emit` sends a status to every listener, with the full status like currentStatus().
 */
type Mock = { uri: string; removed: boolean; paused: boolean; played: number; state: string; readonly audible: boolean; listeners: ((s: object) => void)[]; readonly currentStatus: object; emit(s: object): void }
const players: Mock[] = []
vi.mock('expo-audio', () => ({
  createAudioPlayer: ({ uri }: { uri: string }) => {
    const p: Mock = {
      uri, removed: false, paused: false, played: 0, state: 'buffering', listeners: [],
      // What the viewer hears: play() was called, the clip loaded, and nothing paused or released the ExoPlayer.
      get audible() { return p.played > 0 && !p.paused && !p.removed && p.state === 'ready' },
      get currentStatus() { return { playbackState: p.state, isLoaded: p.state === 'ready', didJustFinish: p.state === 'ended', playing: false } },
      emit(s: object) { const st = s as { playbackState?: string }; if (st.playbackState) p.state = st.playbackState; for (const l of [...p.listeners]) l({ ...p.currentStatus, ...s }) },
    }
    // Android: remove() only drops the module's map entry (AudioModule.kt) — the ExoPlayer plays on; release() frees it.
    Object.assign(p, { addListener(_: string, l: (s: object) => void) { p.listeners.push(l) }, play() { p.played++; p.paused = false }, pause() { p.paused = true }, remove() {}, release() { p.removed = true } })
    players.push(p); return p
  },
}))
const ok = (p: Mock) => { p.emit({ playbackState: 'ready' }); p.emit({ playing: true }) }
const finish = (p: Mock) => p.emit({ playbackState: 'ended', didJustFinish: true })
const fail404 = (p: Mock) => { p.emit({ isLoaded: true }); p.emit({ playbackState: 'idle' }) } // what Android really sends
const androidId = vi.fn(() => 'a1b2c3')
vi.mock('expo-application', () => ({ getAndroidId: () => androidId() }))
// react-native's DeviceEventEmitter as react-native-keyevent drives it; the kit maps Android keycodes.
const emitter = vi.hoisted(() => {
  const l: Record<string, ((e: { keyCode: number }) => void)[]> = {}
  return { l, emit: (ev: string, keyCode: number) => (l[ev] ?? []).forEach((f) => f({ keyCode })) }
})
vi.mock('react-native', () => ({ DeviceEventEmitter: { addListener: (ev: string, f: (e: { keyCode: number }) => void) => { (emitter.l[ev] ??= []).push(f); return { remove() {} } } } }))
vi.mock('@moiz0309/vega-media-kit/platform', () => ({ mapKey: (c: number) => ({ 23: 'select', 22: 'right', 4: 'back' } as Record<number, string>)[c] }))

describe('key hub', () => {
  it('a held key reports repeat until it is released', () => {
    const hub = createKeyHub(); const seen: boolean[] = []
    hub.subscribe((_, r) => seen.push(r))
    hub.down(23); hub.down(23); hub.down(23); hub.up(23); hub.down(23)
    expect(seen).toEqual([false, true, true, false])
  })
  it('a Select held across a route change is no new press on the next screen', async () => {
    const { keySource } = await import('../src/remote')
    const first: [string, boolean | undefined][] = [], next: [string, boolean | undefined][] = []
    const unsubscribe = keySource((k, r) => first.push([k, r]))
    emitter.emit('onKeyDown', 23) // Select opens Title…
    unsubscribe() // …the Home navigator goes away
    keySource((k, r) => next.push([k, r])) // Title's navigator subscribes
    emitter.emit('onKeyDown', 23) // auto-repeat of the same held press
    emitter.emit('onKeyUp', 23)
    emitter.emit('onKeyDown', 23) // a real new press
    expect(first).toEqual([['select', false]])
    expect(next).toEqual([['select', true], ['select', false]])
  })
  it('unmapped keys are not delivered', async () => {
    const { keySource } = await import('../src/remote')
    const got: string[] = []; const off = keySource((k) => got.push(k))
    emitter.emit('onKeyDown', 999); emitter.emit('onKeyDown', 22); emitter.emit('onKeyUp', 22); off()
    expect(got).toEqual(['right'])
  })
})

describe('speak always settles', () => {
  beforeEach(() => { vi.useFakeTimers(); players.length = 0 })
  afterEach(() => vi.useRealTimers())
  it('when the clip finishes', async () => {
    const { speak } = await import('../src/audio')
    const done = vi.fn(); void speak('https://cdn/x.mp3').then(done)
    ok(players[0]!); finish(players[0]!)
    await vi.runAllTicks(); await Promise.resolve()
    expect(done).toHaveBeenCalled(); expect(players[0]!.removed).toBe(true)
  })
  it('a 404 ends it at once: Android sends isLoaded true, then idle — never error', async () => {
    const { speak } = await import('../src/audio')
    const done = vi.fn(); void speak('https://cdn/missing.mp3').then(done)
    players[0]!.emit({ isLoaded: true }) // not loaded: only 'ready' counts
    await Promise.resolve(); expect(done).not.toHaveBeenCalled()
    players[0]!.emit({ playbackState: 'idle' })
    await Promise.resolve(); expect(done).toHaveBeenCalled(); expect(players[0]!.removed).toBe(true)
  })
  it('isLoaded without ready does not stop the load timeout', async () => {
    const { speak, LOAD_TIMEOUT_MS } = await import('../src/audio')
    const done = vi.fn(); void speak('https://cdn/slow.mp3').then(done)
    players[0]!.emit({ isLoaded: true })
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS)
    expect(done).toHaveBeenCalled()
  })
  it('when the clip never loads', async () => {
    const { speak, LOAD_TIMEOUT_MS } = await import('../src/audio')
    const done = vi.fn(); void speak('https://cdn/bad.mp3').then(done)
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS)
    expect(done).toHaveBeenCalled()
  })
  it('when it plays past the cap', async () => {
    const { speak, MAX_CLIP_MS } = await import('../src/audio')
    const done = vi.fn(); void speak('https://cdn/long.mp3').then(done)
    ok(players[0]!)
    await vi.advanceTimersByTimeAsync(MAX_CLIP_MS - 1); expect(done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1); expect(done).toHaveBeenCalled()
  })
  it('when stopped, and a new clip replaces the old one', async () => {
    const { speak, stopSpeaking } = await import('../src/audio')
    const first = vi.fn(); void speak('https://cdn/a.mp3').then(first)
    const second = vi.fn(); void speak('https://cdn/b.mp3').then(second)
    await Promise.resolve(); expect(first).toHaveBeenCalled(); expect(players[0]!.removed).toBe(true)
    stopSpeaking(); await Promise.resolve(); expect(second).toHaveBeenCalled()
  })
})

describe('a new clip interrupts the old one (pressing fast must never overlap two voices)', () => {
  beforeEach(() => { vi.useFakeTimers(); players.length = 0 })
  afterEach(() => vi.useRealTimers())
  it('a clip replaced while still buffering never starts when its load finishes late', async () => {
    const { speak, stopSpeaking } = await import('../src/audio')
    void speak('https://cdn/prompts/a.mp3'); void speak('https://cdn/prompts/b.mp3'); void speak('https://cdn/prompts/c.mp3')
    // Loads finish out of order: the newest first, then the two older ones.
    ok(players[2]!); ok(players[0]!); ok(players[1]!)
    expect(players.filter((p) => p.audible).map((p) => p.uri)).toEqual(['https://cdn/prompts/c.mp3'])
    expect(players[0]!.paused && players[0]!.removed).toBe(true); expect(players[1]!.paused && players[1]!.removed).toBe(true)
    stopSpeaking(); expect(players.some((p) => p.audible)).toBe(false)
  })
  it('a playing clip is silenced at once by the next one', async () => {
    const { speak } = await import('../src/audio')
    const first = vi.fn(); void speak('https://cdn/a.mp3').then(first)
    ok(players[0]!); expect(players[0]!.audible).toBe(true)
    void speak('https://cdn/b.mp3'); ok(players[1]!)
    expect(players[0]!.audible).toBe(false); expect(players[1]!.audible).toBe(true)
    await Promise.resolve(); expect(first).toHaveBeenCalled()
  })
  it("a superseded clip's late status events do not end the new clip", async () => {
    const { speak } = await import('../src/audio')
    void speak('https://cdn/a.mp3')
    const second = vi.fn(); void speak('https://cdn/b.mp3').then(second)
    ok(players[1]!)
    finish(players[0]!); fail404(players[0]!) // the old player's last events arrive after it was replaced
    await Promise.resolve(); await Promise.resolve()
    expect(second).not.toHaveBeenCalled(); expect(players[1]!.audible).toBe(true)
  })
  it('stopSpeaking silences a prefetched clip too', async () => {
    const { prefetch, stopSpeaking } = await import('../src/audio')
    prefetch('https://cdn/next.mp3'); stopSpeaking()
    expect(players[0]!.paused && players[0]!.removed).toBe(true)
  })
})

describe('prefetch (Extended mode: the next cue, 10 s ahead)', () => {
  beforeEach(() => { vi.useFakeTimers(); players.length = 0 })
  afterEach(() => vi.useRealTimers())
  it('loads the clip without playing it; speak of the same URL plays that player', async () => {
    const { prefetch, speak, stopSpeaking } = await import('../src/audio')
    prefetch('https://api/titles/s/cues/d2/audio')
    expect(players).toHaveLength(1); expect(players[0]!.played).toBe(0)
    prefetch('https://api/titles/s/cues/d2/audio') // twice: still one
    expect(players).toHaveLength(1)
    players[0]!.emit({ playbackState: 'ready' }) // loaded before speak listened
    const done = vi.fn(); void speak('https://api/titles/s/cues/d2/audio').then(done)
    expect(players).toHaveLength(1); expect(players[0]!.played).toBe(1); expect(players[0]!.removed).toBe(false)
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS) // already loaded: the load timeout does not cut it
    expect(done).not.toHaveBeenCalled()
    stopSpeaking(); await Promise.resolve(); expect(done).toHaveBeenCalled()
  })
  it('a prefetched clip that already failed (idle) ends speak at once', async () => {
    const { prefetch, speak } = await import('../src/audio')
    prefetch('https://api/titles/s/cues/d9/audio')
    fail404(players[0]!)
    const done = vi.fn(); void speak('https://api/titles/s/cues/d9/audio').then(done)
    await Promise.resolve(); await Promise.resolve()
    expect(done).toHaveBeenCalled(); expect(players[0]!.removed).toBe(true); expect(players[0]!.played).toBe(0)
  })
  it('a prefetched clip still buffering plays once ready, and fails at once if it goes idle', async () => {
    const { prefetch, speak } = await import('../src/audio')
    prefetch('https://cdn/a.mp3')
    const done = vi.fn(); void speak('https://cdn/a.mp3').then(done)
    expect(players[0]!.played).toBe(1)
    fail404(players[0]!)
    await Promise.resolve(); expect(done).toHaveBeenCalled()
  })
  it('cancelPrefetch releases the prefetched clip', async () => {
    const { prefetch, cancelPrefetch } = await import('../src/audio')
    prefetch('https://cdn/a.mp3'); cancelPrefetch()
    expect(players[0]!.removed).toBe(true)
  })
  it('a new prefetch replaces the old one; speak of another URL leaves the prefetched clip alone; stop releases it', async () => {
    const { prefetch, speak, stopSpeaking } = await import('../src/audio')
    prefetch('https://cdn/a.mp3'); prefetch('https://cdn/b.mp3')
    expect(players[0]!.removed).toBe(true); expect(players[1]!.removed).toBe(false)
    void speak('https://cdn/sample.mp3')
    expect(players).toHaveLength(3); expect(players[1]!.removed).toBe(false)
    stopSpeaking()
    expect(players[1]!.removed).toBe(true); expect(players[2]!.removed).toBe(true)
  })
})
const { LOAD_TIMEOUT_MS } = await import('../src/audio')

describe('device id', () => {
  it('is the Android ID, prefixed', async () => expect((await import('../src/deviceId')).deviceId()).toBe('fireos-a1b2c3'))
  it('falls back off Android', async () => { androidId.mockImplementationOnce(() => { throw new Error('no') }); expect((await import('../src/deviceId')).deviceId()).toBe('dev-device') })
})

describe('config plugins', () => {
  const activity = 'package dev.moizp.described\n\nimport android.os.Bundle\n\nclass MainActivity : ReactActivity() {\n  override fun onCreate() {}\n}\n'
  it('withKeyEvent patches MainActivity once, with null-safe forwarding', () => {
    const once = keyEvent.patch(activity)
    expect(keyEvent.patch(once)).toBe(once)
    expect(once).toContain('KeyEventModule.getInstance()?.onKeyDownEvent')
    expect(once).toContain('import com.github.kevinejohn.keyevent.KeyEventModule')
    expect(once).not.toMatch(/KEYCODE_BACK/)
  })
  it('withLocalApi allows cleartext only for an http API host', () => {
    expect(localApi.cleartextHost('http://192.168.1.20:4000')).toBe('192.168.1.20')
    expect(localApi.cleartextHost('https://api.example.com')).toBeNull()
    const xml = localApi.securityConfig('192.168.1.20')
    expect(xml).toContain('<base-config cleartextTrafficPermitted="false" />')
    expect(xml).toContain('<domain includeSubdomains="false">192.168.1.20</domain>')
    expect(xml.match(/<domain /g)).toHaveLength(1) // release: the API host and nothing else
  })
  it('withFireTvVoice adds the background media session opt-in once, idempotently', () => {
    const manifest: Manifest = { manifest: { application: [{ $: { 'android:name': '.MainApplication' }, 'meta-data': [{ $: { 'android:name': 'other', 'android:value': 'x' } }] }] } }
    const once = fireTvVoice.patch(manifest)
    const twice = fireTvVoice.patch(structuredClone(once))
    for (const m of [once, twice]) {
      const meta = m.manifest.application[0]!['meta-data']!
      expect(meta.filter((d) => d.$['android:name'] === 'com.amazon.voice.supports_background_media_session')).toEqual([
        { $: { 'android:name': 'com.amazon.voice.supports_background_media_session', 'android:value': 'true' } },
      ])
      expect(meta).toHaveLength(2) // the other entry is kept
    }
    const bare = fireTvVoice.patch({ manifest: { application: [{ $: {} }] } })
    expect(bare.manifest.application[0]!['meta-data']).toHaveLength(1)
  })
  it('app.json asks for the Fire TV voice permission (exact spelling) and registers withFireTvVoice', () => {
    // https://developer.amazon.com/docs/fire-tv/mediasession-api-integration.html "Add the Media Session Permission"
    expect(appJson.expo.android.permissions).toContain('com.amazon.permission.media.session.voicecommandcontrol')
    expect(appJson.expo.plugins).toContain('./plugins/withFireTvVoice')
  })
  it('withTvBanner points <application android:banner> at the xhdpi 320 x 180 banner, idempotently', () => {
    // https://developer.android.com/training/tv/get-started/create "Home screen banner"
    const manifest: Manifest = { manifest: { application: [{ $: { 'android:name': '.MainApplication', 'android:icon': '@mipmap/ic_launcher' } }] } }
    const once = tvBanner.patch(manifest)
    const twice = tvBanner.patch(structuredClone(once))
    for (const m of [once, twice]) {
      expect(m.manifest.application[0]!.$).toEqual({ 'android:name': '.MainApplication', 'android:icon': '@mipmap/ic_launcher', 'android:banner': '@drawable/tv_banner' })
    }
    expect(tvBanner.RES_DIR).toBe('app/src/main/res/drawable-xhdpi')
    const png = readFileSync(path.join(__dirname, '..', tvBanner.SOURCE))
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([320, 180]) // PNG IHDR width, height
  })
  it('app.json sets the icon, the adaptive icon on the ground colour, and registers withTvBanner', () => {
    expect(appJson.expo.icon).toBe('./assets/images/described-mark-1024.png')
    expect(appJson.expo.android.adaptiveIcon).toEqual({ foregroundImage: './assets/images/adaptive-foreground.png', backgroundColor: '#0D1215' })
    expect(appJson.expo.plugins).toContain('./plugins/withTvBanner')
    for (const p of [appJson.expo.icon, appJson.expo.android.adaptiveIcon.foregroundImage]) expect(existsSync(path.join(__dirname, '..', p))).toBe(true)
  })
  it('withTvFeatures declares touchscreen, faketouch, microphone and leanback as not required, once, idempotently', () => {
    // https://developer.amazon.com/docs/app-submission/device-filtering-and-compatibility.html (Fire TV: touchscreen false)
    const manifest: FeatureManifest = { manifest: { $: {}, 'uses-feature': [{ $: { 'android:name': 'android.hardware.touchscreen', 'android:required': 'true' } }, { $: { 'android:name': 'android.hardware.wifi' } }] } }
    const once = tvFeatures.patch(manifest)
    const twice = tvFeatures.patch(structuredClone(once))
    const names = ['android.hardware.touchscreen', 'android.hardware.faketouch', 'android.hardware.microphone', 'android.software.leanback']
    expect(tvFeatures.FEATURES).toEqual(names)
    for (const m of [once, twice]) {
      const f = m.manifest['uses-feature']!
      for (const n of names) expect(f.filter((x) => x.$['android:name'] === n)).toEqual([{ $: { 'android:name': n, 'android:required': 'false' } }])
      expect(f).toHaveLength(5) // the other entry is kept
    }
    const bare = tvFeatures.patch({ manifest: { $: {} } })
    expect(bare.manifest['uses-feature']!.map((x) => x.$['android:required'])).toEqual(['false', 'false', 'false', 'false'])
  })
  it('app.json registers withTvFeatures, never records, and blocks the permissions the app does not use', () => {
    expect(appJson.expo.plugins).toContain('./plugins/withTvFeatures')
    expect(appJson.expo.plugins).toContainEqual(['expo-audio', { recordAudioAndroid: false }])
    expect(appJson.expo.android.blockedPermissions).toEqual(expect.arrayContaining([
      'android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS', 'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.VIBRATE',
    ]))
    for (const kept of appJson.expo.android.permissions) expect(appJson.expo.android.blockedPermissions).not.toContain(kept)
  })
  it('debug builds keep cleartext open for the Metro dev server', () => {
    expect(localApi.debugSecurityConfig()).toContain('<base-config cleartextTrafficPermitted="true" />')
  })
})
