import React, { useRef } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { toTransport, type RemoteKey } from '@moizp/vega-media-kit/platform'
import type { LaunchTarget } from '@described/contracts'
import { Root } from '../src/index'
import {
  configurePlatform, fromKitControl, REPORT_EVERY_MS, routeForLaunch, SEEK_STEP_S, transportAction, usePlatformPlayback,
  type LaunchSource, type NowPlayingInfo, type PlaybackEvent, type PlayerControls, type Transport,
} from '../src/platform'
import { strings } from '../src/strings'
import { catalog, title } from './fixtures'

describe('routeForLaunch', () => {
  it('title link → Title; play link → Player with the AD default and the start time', () => {
    expect(routeForLaunch({ kind: 'title', slug: 'sintel-90-210' }, catalog, true)).toEqual({ name: 'title', slug: 'sintel-90-210' })
    expect(routeForLaunch({ kind: 'play', slug: 'sintel-90-210' }, catalog, false)).toEqual({ name: 'player', slug: 'sintel-90-210', withAd: false })
    expect(routeForLaunch({ kind: 'play', slug: 'tears-of-steel', startAtS: 60 }, catalog, true)).toEqual({ name: 'player', slug: 'tears-of-steel', withAd: true, startAtS: 60 })
  })
  it('a title that is not in the catalog goes nowhere', () => {
    expect(routeForLaunch({ kind: 'play', slug: 'gone' }, catalog, true)).toBeNull()
  })
})

describe('transport → player action', () => {
  const at = (playing: boolean, positionS = 100, durationS: number | null = 888) => ({ playing, positionS, durationS })
  it.each<[Transport, boolean, unknown]>([
    [{ kind: 'pause' }, true, { kind: 'pause' }],
    [{ kind: 'pause' }, false, null],
    [{ kind: 'play' }, false, { kind: 'play' }],
    [{ kind: 'play' }, true, null],
    [{ kind: 'toggle' }, true, { kind: 'pause' }],
    [{ kind: 'toggle' }, false, { kind: 'play' }],
    [{ kind: 'stop' }, true, { kind: 'pause' }],
    [{ kind: 'seekBy', s: 10 }, true, { kind: 'seek', toS: 110 }],
    [{ kind: 'seekBy', s: -10 }, false, { kind: 'seek', toS: 90 }],
    [{ kind: 'seekTo', s: 300 }, true, { kind: 'seek', toS: 300 }],
  ])('%j while playing=%s → %j', (t, playing, want) => expect(transportAction(t, at(playing))).toEqual(want))
  it('seeks clamp to the title', () => {
    expect(transportAction({ kind: 'seekBy', s: -10 }, at(true, 4))).toEqual({ kind: 'seek', toS: 0 })
    expect(transportAction({ kind: 'seekTo', s: 5000 }, at(true))).toEqual({ kind: 'seek', toS: 887 })
    expect(transportAction({ kind: 'seekTo', s: 5000 }, at(true, 0, null))).toEqual({ kind: 'seek', toS: 5000 })
  })
  it('the remote media keys map through the kit to the same actions as voice', () => {
    const viaRemote = (k: RemoteKey, playing: boolean) => { const c = toTransport(k); const t = c && fromKitControl(c); return t && transportAction(t, at(playing)) }
    expect(viaRemote('playPause', true)).toEqual(transportAction({ kind: 'pause' }, at(true)))
    expect(viaRemote('play', false)).toEqual(transportAction({ kind: 'play' }, at(false)))
    expect(viaRemote('pause', true)).toEqual(transportAction({ kind: 'pause' }, at(true)))
    expect(viaRemote('fastForward', true)).toEqual({ kind: 'seek', toS: 100 + SEEK_STEP_S })
    expect(viaRemote('rewind', true)).toEqual({ kind: 'seek', toS: 100 - SEEK_STEP_S })
    expect(fromKitControl('next')).toBeNull()
  })
})

describe('usePlatformPlayback', () => {
  function setup() {
    const now: (NowPlayingInfo | null)[] = []; const events: PlaybackEvent[] = []
    let send: ((t: Transport) => void) | undefined; const off = vi.fn()
    configurePlatform({ mediaSession: { setNowPlaying: (i) => now.push(i), onTransport: (cb) => { send = cb; return off } }, reporter: { report: (e) => events.push(e) } })
    const player = { pos: 42, play: vi.fn(), pause: vi.fn(), seek: vi.fn(), getPosition() { return this.pos } }
    function Probe({ state }: { state: string }) {
      const ref = useRef<PlayerControls | null>(player)
      usePlatformPlayback(ref, { slug: 'sintel-90-210', name: 'Sintel', durationS: 888, state })
      return null
    }
    let r!: TestRenderer.ReactTestRenderer
    act(() => { r = TestRenderer.create(<Probe state="loading" />) })
    return { now, events, off, player, r, Probe, send: (t: Transport) => act(() => send!(t)) }
  }
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); configurePlatform({}) })

  it('publishes now-playing and reports start, progress, pause and exit', () => {
    const s = setup()
    expect(s.now).toEqual([]); expect(s.events).toEqual([])
    act(() => s.r.update(<s.Probe state="playing" />))
    expect(s.now.at(-1)).toEqual({ title: 'Sintel', durationS: 888, positionS: 42, playing: true })
    expect(s.events.at(-1)).toEqual({ slug: 'sintel-90-210', positionS: 42, durationS: 888, state: 'playing' })
    s.player.pos = 72; act(() => { vi.advanceTimersByTime(REPORT_EVERY_MS) })
    expect(s.events.at(-1)).toMatchObject({ positionS: 72, state: 'playing' })
    act(() => s.r.update(<s.Probe state="paused" />))
    expect(s.now.at(-1)).toMatchObject({ playing: false }); expect(s.events.at(-1)).toMatchObject({ state: 'paused' })
    const n = s.events.length; act(() => { vi.advanceTimersByTime(REPORT_EVERY_MS * 3) }); expect(s.events).toHaveLength(n)
    act(() => s.r.unmount())
    expect(s.off).toHaveBeenCalled(); expect(s.now.at(-1)).toBeNull()
    expect(s.events.at(-1)).toEqual({ slug: 'sintel-90-210', positionS: 72, durationS: 888, state: 'exit' })
  })
  it('Alexa transport requests drive the player', () => {
    const s = setup()
    act(() => s.r.update(<s.Probe state="playing" />))
    s.send({ kind: 'pause' }); expect(s.player.pause).toHaveBeenCalledTimes(1)
    s.send({ kind: 'play' }); expect(s.player.play).not.toHaveBeenCalled() // still reported as playing
    act(() => s.r.update(<s.Probe state="paused" />))
    s.send({ kind: 'play' }); expect(s.player.play).toHaveBeenCalledTimes(1)
    s.send({ kind: 'seekBy', s: -SEEK_STEP_S }); expect(s.player.seek).toHaveBeenLastCalledWith(32)
    expect(s.now.at(-1)).toMatchObject({ positionS: 32 })
    s.send({ kind: 'seekTo', s: 600 }); expect(s.player.seek).toHaveBeenLastCalledWith(600)
    act(() => s.r.unmount())
  })
  it('without platform bindings it does nothing', () => {
    configurePlatform({})
    function Bare() { const ref = useRef<PlayerControls | null>(null); usePlatformPlayback(ref, { slug: 'x', name: 'X', durationS: null, state: 'playing' }); return null }
    let r!: TestRenderer.ReactTestRenderer
    expect(() => act(() => { r = TestRenderer.create(<Bare />) })).not.toThrow()
    act(() => r.unmount())
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
