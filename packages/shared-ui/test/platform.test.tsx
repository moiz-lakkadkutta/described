import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { toTransport, type RemoteKey } from '@moizp/vega-media-kit/platform'
import type { LaunchTarget } from '@described/contracts'
import { Root, type PlayerSession } from '../src/index'
import { configureRemote } from '../src/focus/remote'
import {
  configurePlatform, createNowPlayingSink, fromKitControl, REPORT_EVERY_MS, routeForLaunch, transportAction,
  type LaunchSource, type NowPlayingInfo, type PlaybackEvent, type Transport,
} from '../src/platform'
import { SEEK_COMMIT_MS, SEEK_STEP_S } from '../src/playback'
import { strings } from '../src/strings'
import { kit } from './stubs/kit'
import { catalog, title } from './fixtures'

describe('routeForLaunch', () => {
  it('title link → Title; play link → Player with the AD default and the start time', () => {
    expect(routeForLaunch({ kind: 'title', slug: 'sintel-90-210' }, catalog, true)).toEqual({ name: 'title', slug: 'sintel-90-210' })
    expect(routeForLaunch({ kind: 'play', slug: 'sintel-90-210' }, catalog, false)).toEqual({ name: 'player', slug: 'sintel-90-210', withAd: false })
    expect(routeForLaunch({ kind: 'play', slug: 'tears-of-steel', startAtS: 60 }, catalog, true)).toEqual({ name: 'player', slug: 'tears-of-steel', withAd: true, startAtS: 60 })
  })
  it('?t= is clamped to the title (sintel is 888 s in the fixture)', () => {
    expect(routeForLaunch({ kind: 'play', slug: 'sintel-90-210', startAtS: 5000 }, catalog, true)).toMatchObject({ startAtS: 887 })
    expect(routeForLaunch({ kind: 'play', slug: 'sintel-90-210', startAtS: 887.5 }, catalog, true)).toMatchObject({ startAtS: 887 })
    const unknownLength = { ...catalog, all: catalog.all.map((t) => ({ ...t, durationS: null })) }
    expect(routeForLaunch({ kind: 'play', slug: 'sintel-90-210', startAtS: 5000 }, unknownLength, true)).toMatchObject({ startAtS: 5000 })
  })
  it('a title that is not in the catalog goes nowhere', () => {
    expect(routeForLaunch({ kind: 'play', slug: 'gone' }, catalog, true)).toBeNull()
  })
})

describe('transport → player action', () => {
  const at = (playing: boolean, positionS = 100) => ({ playing, positionS })
  it.each<[Transport, boolean, unknown]>([
    [{ kind: 'pause' }, true, { kind: 'pause' }],
    [{ kind: 'pause' }, false, { kind: 'pause' }], // paused for an extended clip: the viewer's pause must still land
    [{ kind: 'play' }, false, { kind: 'play' }],
    [{ kind: 'play' }, true, null],
    [{ kind: 'toggle' }, true, { kind: 'pause' }],
    [{ kind: 'toggle' }, false, { kind: 'play' }],
    [{ kind: 'stop' }, true, { kind: 'pause' }],
    [{ kind: 'stop' }, false, { kind: 'pause' }],
    [{ kind: 'seekBy', dir: 1 }, true, { kind: 'seek', toS: 100 + SEEK_STEP_S }],
    [{ kind: 'seekBy', dir: -1 }, false, { kind: 'seek', toS: 100 - SEEK_STEP_S }],
    [{ kind: 'seekTo', s: 300 }, true, { kind: 'seek', toS: 300 }],
  ])('%j while playing=%s → %j', (t, playing, want) => expect(transportAction(t, at(playing))).toEqual(want))
  it('the kit transport names (remote keys, Vega) map to the same requests', () => {
    const viaKit = (k: RemoteKey) => { const c = toTransport(k); return c ? fromKitControl(c) : null }
    expect(viaKit('playPause')).toEqual({ kind: 'toggle' })
    expect(viaKit('play')).toEqual({ kind: 'play' })
    expect(viaKit('pause')).toEqual({ kind: 'pause' })
    expect(viaKit('fastForward')).toEqual({ kind: 'seekBy', dir: 1 })
    expect(viaKit('rewind')).toEqual({ kind: 'seekBy', dir: -1 })
    expect(fromKitControl('next')).toBeNull()
  })
})

describe('now-playing sink (bindings side of onNowPlaying)', () => {
  function setup() {
    const now: (NowPlayingInfo | null)[] = []; const events: PlaybackEvent[] = []
    let send: ((t: Transport) => void) | undefined; const off = vi.fn(); const subs = vi.fn()
    const sink = createNowPlayingSink(() => ({ mediaSession: { setNowPlaying: (i) => now.push(i), onTransport: (cb) => { subs(); send = cb; return off } }, reporter: { report: (e) => events.push(e) } }))
    const controls = { pos: 42, play: vi.fn(), pause: vi.fn(), seek: vi.fn(), getPosition() { return this.pos } }
    let seeks = 0
    const session = (state: string, slug = 'sintel-90-210'): PlayerSession => ({ slug, name: 'Sintel', state: state as PlayerSession['state'], adOn: true, durationS: 888, seeks, controls })
    return { now, events, off, subs, controls, sink, session, seek: () => { seeks++ }, send: (t: Transport) => send!(t) }
  }
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('publishes on state changes, reports start, progress, pause and exit', () => {
    const s = setup()
    s.sink(s.session('loading')); expect(s.now).toEqual([]); expect(s.subs).toHaveBeenCalledTimes(1)
    s.sink(s.session('playing'))
    expect(s.now.at(-1)).toEqual({ title: 'Sintel', durationS: 888, positionS: 42, playing: true })
    expect(s.events.at(-1)).toEqual({ slug: 'sintel-90-210', positionS: 42, durationS: 888, state: 'playing' })
    s.sink(s.session('playing')); expect(s.now).toHaveLength(1) // same state, no seek: nothing new
    s.controls.pos = 72; vi.advanceTimersByTime(REPORT_EVERY_MS)
    expect(s.events.at(-1)).toMatchObject({ positionS: 72, state: 'playing' })
    s.sink(s.session('buffering')); expect(s.now.at(-1)).toMatchObject({ playing: true })
    s.sink(s.session('paused')); expect(s.now.at(-1)).toMatchObject({ playing: false }); expect(s.events.at(-1)).toMatchObject({ state: 'paused' })
    const n = s.events.length; vi.advanceTimersByTime(REPORT_EVERY_MS * 3); expect(s.events).toHaveLength(n)
    s.sink(null)
    expect(s.off).toHaveBeenCalled(); expect(s.now.at(-1)).toBeNull()
    expect(s.events.at(-1)).toEqual({ slug: 'sintel-90-210', positionS: 72, durationS: 888, state: 'exit' })
    s.sink(null); expect(s.now.filter((x) => x === null)).toHaveLength(1)
  })
  it('republishes the position after every committed seek (review 8)', () => {
    const s = setup()
    s.sink(s.session('playing'))
    s.controls.pos = 300; s.seek(); s.sink(s.session('playing'))
    expect(s.now.at(-1)).toMatchObject({ positionS: 300, playing: true })
    expect(s.now).toHaveLength(2)
  })
  it('transport acts through controls; buffering counts as playing', () => {
    const s = setup()
    s.sink(s.session('buffering'))
    s.send({ kind: 'pause' }); expect(s.controls.pause).toHaveBeenCalledTimes(1)
    s.send({ kind: 'toggle' }); expect(s.controls.pause).toHaveBeenCalledTimes(2)
    s.send({ kind: 'play' }); expect(s.controls.play).not.toHaveBeenCalled()
    s.sink(s.session('paused'))
    s.send({ kind: 'play' }); expect(s.controls.play).toHaveBeenCalledTimes(1)
    s.send({ kind: 'seekBy', dir: -1 }); expect(s.controls.seek).toHaveBeenLastCalledWith(42 - SEEK_STEP_S)
    s.send({ kind: 'seekTo', s: 5000 }); expect(s.controls.seek).toHaveBeenLastCalledWith(5000) // Player's seekTo clamps
    s.sink(null); s.send({ kind: 'play' }); expect(s.controls.play).toHaveBeenCalledTimes(1)
  })
  it('a different film without a null in between ends the first session', () => {
    const s = setup()
    s.sink(s.session('playing'))
    s.sink(s.session('loading', 'tears-of-steel'))
    expect(s.events.at(-1)).toMatchObject({ slug: 'sintel-90-210', state: 'exit' }); expect(s.subs).toHaveBeenCalledTimes(2)
  })
  it('without platform bindings it does nothing', () => {
    const sink = createNowPlayingSink(() => ({}))
    expect(() => { sink({ slug: 'x', name: 'X', state: 'playing', adOn: true, durationS: null, seeks: 0, controls: { play() {}, pause() {}, seek() {}, getPosition: () => 0 } }); sink(null) }).not.toThrow()
  })
})

describe('Root → Player → media session', () => {
  const ok = (data: unknown) => Promise.resolve({ json: async () => ({ success: true, data }) } as Response)
  const keys = new Set<(k: never, repeat?: boolean) => void>()
  const press = (k: string) => act(() => { for (const l of [...keys]) l(k as never, false) })
  let r: TestRenderer.ReactTestRenderer | undefined
  beforeEach(() => {
    configureRemote((onKey) => { keys.add(onKey as never); return () => keys.delete(onKey as never) })
    kit.reset()
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const path = url.replace('http://api', '')
      if (path === '/catalog') return ok(catalog)
      if (path === '/me/prefs') return ok({ adDefault: true, extendedMode: true, voice: 'Joanna', captionKind: 'sdh', captionScale: 100, firstRunDone: true })
      if (path === '/titles/big-buck-bunny') return new Promise(() => {}) // a title that never loads: no Player mounts
      if (path.startsWith('/titles/')) return ok({ ...title, slug: path.slice('/titles/'.length) })
      if (path.startsWith('https://')) return new Promise(() => {}) // master playlist: never lands
      return ok({})
    }))
  })
  afterEach(() => { if (r) act(() => r!.unmount()); r = undefined; vi.unstubAllGlobals(); configurePlatform({}) })

  it('Alexa seeks go through Player\'s seekTo (clamped); key seeks republish when they commit; the prop still sees it all', async () => {
    const now: (NowPlayingInfo | null)[] = []; let send!: (t: Transport) => void
    configurePlatform({ mediaSession: { setNowPlaying: (i) => now.push(i), onTransport: (cb) => { send = cb; return () => {} } } })
    let open!: (t: LaunchTarget) => void
    const launches: LaunchSource = (on) => { open = on; return () => {} }
    const onNowPlaying = vi.fn()
    act(() => { r = TestRenderer.create(<Root apiBaseUrl="http://api" scale={0.5} launches={launches} onNowPlaying={onNowPlaying} />) })
    const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
    await flush(); act(() => open({ kind: 'play', slug: 'sintel-90-210' })); await flush()
    const kp = () => r!.root.find((n) => (n.type as unknown) === 'KitPlayer').props
    act(() => { kp().onState('playing') }); act(() => { kp().onPosition(100) })
    expect(now.at(-1)).toMatchObject({ title: 'Sintel', playing: true })
    act(() => send({ kind: 'seekTo', s: 5000 }))
    expect(kit.ref.seek).toHaveBeenLastCalledWith(887) // clampSeek(5000, 888)
    expect(now.at(-1)).toMatchObject({ positionS: 887 })
    vi.useFakeTimers()
    try {
      act(() => { kp().onPosition(887) })
      press('left'); expect(now.at(-1)).toMatchObject({ positionS: 887 }) // not yet: ◄ gathers presses
      act(() => { vi.advanceTimersByTime(SEEK_COMMIT_MS) })
      expect(now.at(-1)).toMatchObject({ positionS: 887 - SEEK_STEP_S })
    } finally { vi.useRealTimers() }
    act(() => send({ kind: 'pause' })); expect(kit.ref.pause).toHaveBeenCalledTimes(1)
    expect(onNowPlaying).toHaveBeenLastCalledWith(expect.objectContaining({ slug: 'sintel-90-210', seeks: 2 }))
    act(() => r!.unmount()); r = undefined
    expect(now.at(-1)).toBeNull(); expect(onNowPlaying).toHaveBeenLastCalledWith(null)
  })
  it('a deep link during playback saves the Player\'s position first, like Back', async () => {
    let open!: (t: LaunchTarget) => void
    const launches: LaunchSource = (on) => { open = on; return () => {} }
    act(() => { r = TestRenderer.create(<Root apiBaseUrl="http://api" scale={0.5} launches={launches} />) })
    const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
    const puts = () => (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit | undefined][])
      .filter(([u, i]) => u.endsWith('/me/progress') && i?.method === 'PUT').map(([, i]) => JSON.parse(String(i!.body)))
    await flush(); act(() => open({ kind: 'title', slug: 'tears-of-steel' })); await flush()
    expect(puts()).toEqual([]) // no Player open: nothing to save
    act(() => open({ kind: 'play', slug: 'sintel-90-210' })); await flush()
    const kp = () => r!.root.find((n) => (n.type as unknown) === 'KitPlayer').props
    act(() => { kp().onState('playing') }); act(() => { kp().onPosition(204) })
    act(() => open({ kind: 'title', slug: 'tears-of-steel' })); await flush()
    expect(puts()).toEqual([{ titleSlug: 'sintel-90-210', positionS: 204 }])
    expect(r!.root.findAll((n) => (n.type as unknown) === 'KitPlayer')).toHaveLength(0)
    expect(JSON.stringify(r!.toJSON())).toContain(strings.title.playWithout)
  })
  it('on the player route with no Player mounted (title still loading), a deep link just navigates — nothing to save', async () => {
    let open!: (t: LaunchTarget) => void
    const launches: LaunchSource = (on) => { open = on; return () => {} }
    act(() => { r = TestRenderer.create(<Root apiBaseUrl="http://api" scale={0.5} launches={launches} />) })
    const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
    await flush(); act(() => open({ kind: 'play', slug: 'big-buck-bunny' })); await flush()
    expect(r!.root.findAll((n) => (n.type as unknown) === 'KitPlayer')).toHaveLength(0)
    act(() => open({ kind: 'title', slug: 'sintel-90-210' })); await flush()
    const puts = (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit | undefined][]).filter(([u, i]) => u.endsWith('/me/progress') && i?.method === 'PUT')
    expect(puts).toEqual([])
    expect(JSON.stringify(r!.toJSON())).toContain(strings.title.playWithout)
  })
  it('a play link for the open title remounts the Player at the new time (review 6)', async () => {
    let open!: (t: LaunchTarget) => void
    const launches: LaunchSource = (on) => { open = on; return () => {} }
    act(() => { r = TestRenderer.create(<Root apiBaseUrl="http://api" scale={0.5} launches={launches} />) })
    const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
    await flush(); act(() => open({ kind: 'play', slug: 'sintel-90-210', startAtS: 60 })); await flush()
    const kp = () => r!.root.find((n) => (n.type as unknown) === 'KitPlayer').props
    expect(kp().startAt).toBe(60); expect(kit.mounts).toBe(1)
    act(() => open({ kind: 'play', slug: 'sintel-90-210', startAtS: 600 })); await flush()
    expect(kp().startAt).toBe(600); expect(kit.mounts).toBe(2)
  })
})

describe('Root: launch from a deep link', () => {
  const ok = (data: unknown) => Promise.resolve({ json: async () => ({ success: true, data }) } as Response)
  function api(firstRunDone = true) {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const path = url.replace('http://api', '')
      if (path === '/catalog') return ok(catalog)
      if (path === '/me/prefs') return ok({ adDefault: true, extendedMode: true, voice: 'Joanna', captionKind: 'sdh', captionScale: 100, firstRunDone })
      if (path.startsWith('/titles/')) return ok({ ...title, slug: path.slice('/titles/'.length), resumeS: 30 })
      return ok({})
    }))
  }
  /** A launch source that delivers one link on subscribe (cold start) and exposes `send` for later ones (warm). */
  function links(first?: LaunchTarget) {
    const s = { subscribed: 0, unsubscribed: 0, send: (_: LaunchTarget) => {} }
    const source: LaunchSource = (on) => { s.subscribed++; s.send = on; if (first) on(first); return () => { s.unsubscribed++ } }
    return { s, source }
  }
  const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
  const text = (r: TestRenderer.ReactTestRenderer) => JSON.stringify(r.toJSON())
  const kit = (r: TestRenderer.ReactTestRenderer) => r.root.findAll((n) => (n.type as unknown) === 'KitPlayer')
  async function mount(source: LaunchSource) {
    let r!: TestRenderer.ReactTestRenderer
    act(() => { r = TestRenderer.create(<Root apiBaseUrl="http://api" scale={0.5} launches={source} />) })
    await flush()
    return r
  }
  let r: TestRenderer.ReactTestRenderer | undefined
  afterEach(() => { if (r) act(() => r!.unmount()); r = undefined; vi.unstubAllGlobals() })

  it('a cold-start title link opens Title once the catalog is in', async () => {
    api(); const { s, source } = links({ kind: 'title', slug: 'sintel-90-210' })
    r = await mount(source); await flush()
    expect(s.subscribed).toBe(1)
    expect(text(r)).toContain(strings.title.playWithout)
  })
  it('a play link with ?t= starts the Player there; without it, at saved progress', async () => {
    api(); const { s, source } = links()
    r = await mount(source)
    act(() => s.send({ kind: 'play', slug: 'sintel-90-210', startAtS: 754 })); await flush()
    expect(kit(r)[0]!.props.startAt).toBe(754)
    expect(kit(r)[0]!.props.preferredAudio).toEqual({ role: 'description' })
    act(() => s.send({ kind: 'play', slug: 'tears-of-steel' })); await flush()
    expect(kit(r)[0]!.props.startAt).toBe(30)
  })
  it('an unknown title stays on Home', async () => {
    api(); const { s, source } = links()
    r = await mount(source)
    act(() => s.send({ kind: 'title', slug: 'not-here' })); await flush()
    expect(text(r)).toContain(strings.home.newly.toUpperCase())
  })
  it('first run finishes before the link is followed', async () => {
    api(false); const { source } = links({ kind: 'title', slug: 'sintel-90-210' })
    r = await mount(source); await flush()
    expect(text(r)).not.toContain(strings.title.playWithout)
    for (let i = 0; i < 6 && !text(r).includes(strings.title.playWithout); i++) {
      act(() => r!.root.findAll((n) => (n.type as unknown) === 'FocusableView')[0]!.props.onSelect()); await flush()
    }
    expect(text(r)).toContain(strings.title.playWithout)
  })
  it('unsubscribes when Root unmounts', async () => {
    api(); const { s, source } = links()
    r = await mount(source); act(() => r!.unmount()); r = undefined
    expect(s.unsubscribed).toBe(1)
  })
})
