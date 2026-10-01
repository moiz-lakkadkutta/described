import { readFileSync } from 'node:fs'
import { DEEP_LINK_SCHEME } from '@described/contracts'

import { appState, linking } from './stubs/react-native'
const { launchSource, _resetLaunch } = await import('../src/platform/launch')
const { createMediaSession, fromNative } = await import('../src/platform/mediaSession')
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
    [{ control: 'fastForward' }, { kind: 'seekBy', s: 10 }],
    [{ control: 'rewind' }, { kind: 'seekBy', s: -10 }],
    [{ control: 'seekTo', positionS: 300 }, { kind: 'seekTo', s: 300 }],
    [{ control: 'seekTo' }, null],
    [{ control: 'skipToNext' }, null],
  ])('%j → %j', (e, want) => expect(fromNative(e)).toEqual(want))
  it('media buttons are dropped unless asked for (the key path already has them)', () => {
    expect(fromNative({ control: 'button', keyCode: 85 })).toBeNull()
    expect(fromNative({ control: 'button', keyCode: 85 }, { acceptButtons: true })).toEqual({ kind: 'toggle' })
    expect(fromNative({ control: 'button', keyCode: 127 }, { acceptButtons: true })).toEqual({ kind: 'pause' })
    expect(fromNative({ control: 'button', keyCode: 90 }, { acceptButtons: true })).toEqual({ kind: 'seekBy', s: 10 })
    expect(fromNative({ control: 'button', keyCode: 19 }, { acceptButtons: true })).toBeNull()
  })
})

describe('media session binding', () => {
  function native() {
    let listener: ((e: { control: string; positionS?: number }) => void) | undefined
    const n = { setNowPlaying: vi.fn(), release: vi.fn(), removed: false,
      addListener: (_: string, l: typeof listener) => { listener = l; return { remove: () => { n.removed = true } } },
      emit: (e: { control: string; positionS?: number }) => listener?.(e) }
    return n
  }
  it('is absent when the native module is not in the build', () => expect(createMediaSession(null)).toBeUndefined())
  it('publishes now-playing, releases on null, forwards transport', () => {
    const n = native(); const b = createMediaSession(n)!
    b.setNowPlaying({ title: 'Sintel', durationS: null, positionS: -1, playing: true })
    expect(n.setNowPlaying).toHaveBeenCalledWith('Sintel', -1, 0, true)
    b.setNowPlaying(null); expect(n.release).toHaveBeenCalled()
    const cb = vi.fn(); const off = b.onTransport(cb)
    n.emit({ control: 'pause' }); n.emit({ control: 'button' })
    expect(cb.mock.calls).toEqual([[{ kind: 'pause' }]])
    off(); expect(n.removed).toBe(true)
  })
})
