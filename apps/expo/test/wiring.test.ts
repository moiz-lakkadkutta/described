import { createRequire } from 'node:module'
import { createRepeatTracker } from '../src/keys'

const require = createRequire(import.meta.url)
const keyEvent = require('../plugins/withKeyEvent.js') as { patch: (s: string) => string }
const localApi = require('../plugins/withLocalApi.js') as { cleartextHost: (u?: string) => string | null; securityConfig: (h: string) => string }

const players: { listener?: (s: object) => void; removed: boolean; uri: string; played: number; isLoaded: boolean }[] = []
vi.mock('expo-audio', () => ({
  createAudioPlayer: ({ uri }: { uri: string }) => {
    const p = { uri, removed: false, played: 0, isLoaded: false, listener: undefined as undefined | ((s: object) => void), addListener(_: string, l: (s: object) => void) { p.listener = l }, play() { p.played++ }, remove() { p.removed = true } }
    players.push(p); return p
  },
}))
const androidId = vi.fn(() => 'a1b2c3')
vi.mock('expo-application', () => ({ getAndroidId: () => androidId() }))

describe('Select repeat', () => {
  it('a held key reports repeat until it is released', () => {
    const t = createRepeatTracker()
    expect([t.down(23), t.down(23), t.down(23)]).toEqual([false, true, true])
    t.up(23)
    expect(t.down(23)).toBe(false)
  })
})

describe('speak always settles', () => {
  beforeEach(() => { vi.useFakeTimers(); players.length = 0 })
  afterEach(() => vi.useRealTimers())
  it('when the clip finishes', async () => {
    const { speak } = await import('../src/audio')
    const done = vi.fn(); void speak('https://cdn/x.mp3').then(done)
    players[0]!.listener!({ isLoaded: true, didJustFinish: true })
    await vi.runAllTicks(); await Promise.resolve()
    expect(done).toHaveBeenCalled(); expect(players[0]!.removed).toBe(true)
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
    players[0]!.listener!({ isLoaded: true, didJustFinish: false })
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
    players[0]!.isLoaded = true // loaded before speak listened
    const done = vi.fn(); void speak('https://api/titles/s/cues/d2/audio').then(done)
    expect(players).toHaveLength(1); expect(players[0]!.played).toBe(1); expect(players[0]!.removed).toBe(false)
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS) // already loaded: the load timeout does not cut it
    expect(done).not.toHaveBeenCalled()
    stopSpeaking(); await Promise.resolve(); expect(done).toHaveBeenCalled()
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
  })
})
