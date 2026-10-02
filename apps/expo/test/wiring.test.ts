import { createRequire } from 'node:module'
import { createKeyHub } from '../src/keys'

const require = createRequire(import.meta.url)
const keyEvent = require('../plugins/withKeyEvent.js') as { patch: (s: string) => string }
const localApi = require('../plugins/withLocalApi.js') as { cleartextHost: (u?: string) => string | null; securityConfig: (h: string) => string; debugSecurityConfig: () => string }

/**
 * expo-audio as 1.1.1 behaves on Android (AudioPlayer.kt): prepared on creation, so `buffering` at once; a good clip goes
 * `ready` → plays → `ended` with didJustFinish; a failed load (404) sends `isLoaded: true` (onIsLoadingChanged(false))
 * and then `idle` — never `error`. `emit` sends a status to every listener, with the full status like currentStatus().
 */
type Mock = { uri: string; removed: boolean; played: number; state: string; listeners: ((s: object) => void)[]; readonly currentStatus: object; emit(s: object): void }
const players: Mock[] = []
vi.mock('expo-audio', () => ({
  createAudioPlayer: ({ uri }: { uri: string }) => {
    const p: Mock = {
      uri, removed: false, played: 0, state: 'buffering', listeners: [],
      get currentStatus() { return { playbackState: p.state, isLoaded: p.state === 'ready', didJustFinish: p.state === 'ended', playing: false } },
      emit(s: object) { const st = s as { playbackState?: string }; if (st.playbackState) p.state = st.playbackState; for (const l of [...p.listeners]) l({ ...p.currentStatus, ...s }) },
    }
    Object.assign(p, { addListener(_: string, l: (s: object) => void) { p.listeners.push(l) }, play() { p.played++ }, remove() { p.removed = true } })
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
vi.mock('@moizp/vega-media-kit/platform', () => ({ mapKey: (c: number) => ({ 23: 'select', 22: 'right', 4: 'back' } as Record<number, string>)[c] }))

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
  it('debug builds keep cleartext open for the Metro dev server', () => {
    expect(localApi.debugSecurityConfig()).toContain('<base-config cleartextTrafficPermitted="true" />')
  })
})
