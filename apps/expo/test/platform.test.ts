import { readFileSync } from 'node:fs'
import { DEEP_LINK_SCHEME } from '@described/contracts'

import { appState, emitter, linking } from './stubs/react-native'
const { launchSource, _resetLaunch } = await import('../src/platform/launch')
const { createMediaSession, fromNative, keySkipFor, MEDIA_SESSION_OWNS_KEYS, SESSION_MAPPED_KEYS } = await import('../src/platform/mediaSession')
const { keySource, setKeySkip } = await import('../src/remote')
const flush = async () => { for (let i = 0; i < 3; i++) await Promise.resolve() }

describe('app.json', () => {
  it('registers the deep-link scheme the catalog writes', () => {
    expect(JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo.scheme).toBe(DEEP_LINK_SCHEME)
  })
})

describe('launch source (Android VIEW intents via Linking)', () => {
  beforeEach(() => { _resetLaunch(); linking.initial = null; linking.listeners.clear(); vi.spyOn(console, 'log').mockImplementation(() => {}) })
  it('delivers the start link, then each warm link', async () => {
    linking.initial = 'described://title/sintel-90-210'
    const got: unknown[] = []
    const off = launchSource((t) => got.push(t)); await flush()
    expect(got).toEqual([{ kind: 'title', slug: 'sintel-90-210' }])
    for (const l of linking.listeners) l({ url: 'described://play/sintel-90-210?t=754' })
    expect(got[1]).toEqual({ kind: 'play', slug: 'sintel-90-210', startAtS: 754 })
    off(); expect(linking.listeners.size).toBe(0)
  })
  it('a second subscribe in the same activity does not replay the start link', async () => {
    linking.initial = 'described://title/sintel-90-210'
    const cb = vi.fn()
    const off = launchSource(cb); await flush(); off()
    expect(cb).toHaveBeenCalledTimes(1)
    launchSource(cb); await flush()
    expect(cb).toHaveBeenCalledTimes(1)
  })
  it('after Back exits (background), a new activity with the same link is handled again', async () => {
    linking.initial = 'described://title/sintel-90-210'
    const cb = vi.fn()
    const off = launchSource(cb); await flush(); off()
    expect(cb).toHaveBeenCalledTimes(1)
    appState.emit('background') // Back on Home: the activity finishes, the JS context lives on
    launchSource(cb); await flush() // the new activity mounts a new Root
    expect(cb).toHaveBeenCalledTimes(2)
    linking.initial = 'described://play/tears-of-steel' // or a different link, without any background in between
    launchSource(cb); await flush()
    expect(cb).toHaveBeenLastCalledWith({ kind: 'play', slug: 'tears-of-steel' })
  })
  it('an unsubscribed source does not deliver a late start link', async () => {
    linking.initial = 'described://title/sintel-90-210'
    const cb = vi.fn()
    launchSource(cb)(); await flush()
    expect(cb).not.toHaveBeenCalled()
  })
  it('ignores links that are not ours', async () => {
    linking.initial = 'https://example.com/title/x'
    const cb = vi.fn(); launchSource(cb); await flush()
    for (const l of linking.listeners) l({ url: 'described://nowhere/x' })
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('media session: native events → Transport', () => {
  it.each([
    [{ control: 'play' }, { kind: 'play' }],
    [{ control: 'pause' }, { kind: 'pause' }],
    [{ control: 'stop' }, { kind: 'stop' }],
    [{ control: 'fastForward' }, { kind: 'seekBy', dir: 1 }],
    [{ control: 'rewind' }, { kind: 'seekBy', dir: -1 }],
    [{ control: 'seekTo', positionS: 300 }, { kind: 'seekTo', s: 300 }],
    [{ control: 'seekTo' }, null],
    [{ control: 'skipToNext' }, null],
  ])('%j → %j', (e, want) => expect(fromNative(e)).toEqual(want))
  it('media buttons are dropped unless asked for (the key path already has them)', () => {
    expect(fromNative({ control: 'button', keyCode: 85 })).toBeNull()
    expect(fromNative({ control: 'button', keyCode: 85 }, { acceptButtons: true })).toEqual({ kind: 'toggle' })
    expect(fromNative({ control: 'button', keyCode: 127 }, { acceptButtons: true })).toEqual({ kind: 'pause' })
    expect(fromNative({ control: 'button', keyCode: 90 }, { acceptButtons: true })).toEqual({ kind: 'seekBy', dir: 1 })
    expect(fromNative({ control: 'button', keyCode: 19 }, { acceptButtons: true })).toBeNull()
  })
})

/** A stand-in for the native module: `ensure` decides whether setNowPlaying really yields an active session. */
function fakeNative(o: { ensure?: boolean } = {}) {
  const listeners = new Map<string, Set<(e: never) => void>>()
  const n = {
    removed: false, ensure: o.ensure ?? true,
    setNowPlaying: vi.fn(() => n.emit('onSessionState', { active: n.ensure })),
    release: vi.fn(() => n.emit('onSessionState', { active: false })),
    addListener: (name: string, l: (e: never) => void) => {
      const set = listeners.get(name) ?? new Set(); set.add(l); listeners.set(name, set)
      return { remove: () => { set.delete(l); n.removed = true } }
    },
    emit: (name: string, e: object) => { for (const l of listeners.get(name) ?? []) l(e as never) },
  }
  return n
}
const PLAYING = { title: 'Sintel', durationS: 888, positionS: 0, playing: true }

describe('media session binding', () => {
  it('is absent when the native module is not in the build', () => expect(createMediaSession(null)).toBeUndefined())
  it('publishes now-playing, releases on null, forwards transport', () => {
    const n = fakeNative(); const b = createMediaSession(n)!
    b.setNowPlaying({ title: 'Sintel', durationS: null, positionS: -1, playing: true })
    expect(n.setNowPlaying).toHaveBeenCalledWith('Sintel', -1, 0, true)
    b.setNowPlaying(null); expect(n.release).toHaveBeenCalled()
    const cb = vi.fn(); const off = b.onTransport(cb)
    n.emit('onTransport', { control: 'pause' }); n.emit('onTransport', { control: 'button' })
    expect(cb.mock.calls).toEqual([[{ kind: 'pause' }]])
    off(); expect(n.removed).toBe(true)
  })
})

describe('one path per media key (key path vs media session)', () => {
  const NATIVE_CONTROL: Record<number, string> = { 126: 'play', 127: 'pause', 86: 'stop' } // DescribedMediaSessionModule default mapping
  function paths(code: number, sessionActive: boolean, acceptButtons = false) {
    const ms = createMediaSession(fakeNative(), { acceptButtons })!
    if (sessionActive) ms.setNowPlaying(PLAYING)
    setKeySkip(keySkipFor(ms))
    const keys: string[] = []
    const off = keySource((k) => keys.push(k))
    emitter.emit('onKeyDown', { keyCode: code }); emitter.emit('onKeyUp', { keyCode: code })
    off(); setKeySkip(() => false)
    // What the native session does with the same key (only while active): default-mapped, or swallowed as "button".
    const native = !sessionActive ? null : SESSION_MAPPED_KEYS.has(code) ? { control: NATIVE_CONTROL[code]! } : { control: 'button', keyCode: code }
    const session = native ? fromNative(native, { acceptButtons }) : null
    return { key: keys.length, session: session ? 1 : 0 }
  }
  // 85 play/pause, 126 play, 127 pause, 86 stop, 89 rewind, 90 fast forward
  it.each([
    [85, 'key'], [126, 'session'], [127, 'session'], [86, 'session'], [89, 'key'], [90, 'key'],
  ])('keyCode %i with the Player open is handled once, by the %s path', (code, owner) => {
    const p = paths(code, true)
    expect(p.key + p.session).toBe(1)
    expect(owner === 'key' ? p.key : p.session).toBe(1)
  })
  it.each([85, 126, 127, 89, 90])('keyCode %i without an active session stays on the key path', (code) => {
    expect(paths(code, false)).toEqual({ key: 1, session: 0 })
  })
  it.each([85, 126, 127, 86, 89, 90])('with acceptButtons, keyCode %i is still handled once (by the session)', (code) => {
    const p = paths(code, true, true)
    expect(p).toEqual({ key: 0, session: 1 })
  })
  it('release() hands the keys back to the key path', () => {
    const ms = createMediaSession(fakeNative())!
    ms.setNowPlaying(PLAYING); expect(ms.ownsKey(127)).toBe(true)
    ms.setNowPlaying(null); expect(ms.ownsKey(127)).toBe(false)
  })
  it('a publish that native could not turn into a session (ensure() → null) leaves the keys on the key path', () => {
    const ms = createMediaSession(fakeNative({ ensure: false }))!
    ms.setNowPlaying(PLAYING)
    expect([126, 127, 86].map((c) => ms.ownsKey(c))).toEqual([false, false, false])
  })
  it('the session going inactive (background) or active again (foreground) moves the keys with it', () => {
    const n = fakeNative(); const ms = createMediaSession(n)!
    ms.setNowPlaying(PLAYING); expect(ms.ownsKey(127)).toBe(true)
    n.emit('onSessionState', { active: false }); expect(ms.ownsKey(127)).toBe(false)
    n.emit('onSessionState', { active: true }); expect(ms.ownsKey(127)).toBe(true)
  })
  it('native active without a published Player does not take keys', () => {
    const n = fakeNative(); const ms = createMediaSession(n)!
    n.emit('onSessionState', { active: true })
    expect(ms.ownsKey(127)).toBe(false)
  })
  it('MEDIA_SESSION_OWNS_KEYS is the one switch: off keeps every key on the key path', () => {
    expect(MEDIA_SESSION_OWNS_KEYS).toBe(true)
    const ms = createMediaSession(fakeNative())!; ms.setNowPlaying(PLAYING)
    expect(keySkipFor(ms)(127)).toBe(true)
    expect(keySkipFor(ms, false)(127)).toBe(false)
    expect(keySkipFor(undefined)(127)).toBe(false)
  })
})
