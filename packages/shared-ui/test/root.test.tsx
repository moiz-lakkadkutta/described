import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { FETCH_TIMEOUT_MS, Root } from '../src/index'
import { Player } from '../src/screens/Player'
import { strings } from '../src/strings'
import { a11yCalls, back } from './stubs/react-native'
import { kit } from './stubs/kit'
import { stub } from './stubs/space-navigation'
import { catalog, title } from './fixtures'

const prefs = { adDefault: true, extendedMode: true, voice: 'Joanna', captionKind: 'sdh', captionScale: 100, firstRunDone: true }
const ok = (data: unknown) => Promise.resolve({ json: async () => ({ success: true, data }) } as Response)
/** Fetch routed by path; `down` makes every request fail like an unreachable host. */
function api() {
  const state = { down: false, hang: false, calls: [] as string[], headers: [] as Record<string, string>[], puts: [] as { path: string; body: unknown }[] }
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace('http://api', '')
    state.calls.push(path); state.headers.push(init?.headers as Record<string, string>)
    if (init?.method === 'PUT') state.puts.push({ path, body: JSON.parse(String(init.body)) })
    if (state.hang) return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    if (state.down) return Promise.reject(new Error('network'))
    if (path === '/catalog') return ok(catalog)
    if (path === '/me/prefs') return ok(prefs)
    if (path.startsWith('/titles/')) return ok(title)
    return ok({})
  })
  vi.stubGlobal('fetch', fetch)
  return state
}
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
const focusables = (r: TestRenderer.ReactTestRenderer) => r.root.findAll((n) => (n.type as unknown) === 'FocusableView')
const press = (r: TestRenderer.ReactTestRenderer, prefix: string) => act(() => focusables(r).find((n) => String(n.props['aria-label']).startsWith(prefix))!.props.onSelect())
const text = (r: TestRenderer.ReactTestRenderer) => JSON.stringify(r.toJSON())
const mounted: TestRenderer.ReactTestRenderer[] = []
function create(el: React.ReactElement) {
  let r!: TestRenderer.ReactTestRenderer
  act(() => { r = TestRenderer.create(el) })
  mounted.push(r)
  return r
}
async function mount(props: Partial<React.ComponentProps<typeof Root>> = {}) {
  const r = create(<Root apiBaseUrl="http://api" scale={0.5} deviceId="fireos-abc" {...props} />)
  await flush()
  return r
}
const onTitle = async (r: TestRenderer.ReactTestRenderer) => { press(r, 'Open Sintel'); await flush() }
afterEach(() => { mounted.splice(0).forEach((r) => act(() => r.unmount())); vi.unstubAllGlobals() })

describe('Root', () => {
  it('sends the platform device id', async () => {
    const s = api(); await mount()
    expect(s.headers.every((h) => h['x-device-id'] === 'fireos-abc')).toBe(true)
  })

  it('Back: reading → Title → Home; Back on Home is left to the platform', async () => {
    api(); const r = await mount()
    await onTitle(r)
    act(() => r.root.findByProps({ testID: 'synopsis-measure' }).props.onTextLayout({ nativeEvent: { lines: [1, 2, 3, 4, 5] } }))
    press(r, 'Read the full synopsis'); await flush()
    expect(focusables(r).map((n) => n.props['aria-label'])).toEqual([strings.a11y.close])
    act(() => { expect(back.press()).toBe(true) })
    expect(text(r)).toContain(strings.title.playWithout)
    act(() => { expect(back.press()).toBe(true) })
    expect(text(r)).toContain(strings.home.newly.toUpperCase())
    act(() => { expect(back.press()).toBe(false) })
  })

  it('Back from Player returns to Title and stops its audio', async () => {
    api(); const stopSpeaking = vi.fn(); const r = await mount({ stopSpeaking })
    await onTitle(r)
    press(r, 'Play Sintel with audio description'); await flush()
    expect(r.root.findAll((n) => (n.type as unknown) === 'KitPlayer')).toHaveLength(1)
    stopSpeaking.mockClear()
    act(() => { back.press() })
    expect(stopSpeaking).toHaveBeenCalled()
    expect(text(r)).toContain(strings.title.playWithout)
  })

  it('Player never gets the sample clip as narration (TODO DESC-007)', async () => {
    api(); const speak = vi.fn(async () => {}); const r = await mount({ speak })
    await onTitle(r)
    press(r, 'Play Sintel with audio description'); await flush()
    const player = r.root.findByType(Player)
    expect(player.props.speak).not.toBe(speak)
    await player.props.speak('https://cdn.example/cue.mp3')
    expect(speak).not.toHaveBeenCalled()
  })

  it('Hear a sample starts the clip; leaving Title stops it', async () => {
    api(); const speak = vi.fn(() => new Promise<void>(() => {})); const stopSpeaking = vi.fn(); const r = await mount({ speak, stopSpeaking })
    await onTitle(r)
    press(r, 'Hear a sample'); await flush()
    expect(speak).toHaveBeenCalledWith(title.sampleCue!.audioUrl)
    expect(text(r)).toContain(strings.title.samplePlaying)
    stopSpeaking.mockClear()
    act(() => { back.press() })
    expect(stopSpeaking).toHaveBeenCalled()
  })

  it('offline on Title: Retry fetches the title again, not only the catalog', async () => {
    const s = api(); const r = await mount()
    s.down = true
    await onTitle(r)
    expect(text(r)).toContain('Can')
    expect(a11yCalls).toContain(strings.offline)
    s.down = false; s.calls.length = 0
    press(r, strings.a11y.retry); await flush()
    expect(s.calls).toContain('/titles/sintel-90-210')
    expect(text(r)).toContain(strings.title.playWithout)
  })

  it('a request that hangs ends in the offline screen after the timeout', async () => {
    vi.useFakeTimers()
    try {
      const s = api(); s.hang = true
      const r = await mount()
      expect(text(r)).not.toContain(strings.a11y.retry)
      await act(async () => { await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS) })
      await flush()
      expect(focusables(r).map((n) => n.props['aria-label'])).toEqual([strings.a11y.retry])
    } finally { vi.useRealTimers() }
  })

  it('locks the D-pad while Home has nothing focusable, unlocks when data arrives', async () => {
    const s = api(); s.hang = true
    vi.useFakeTimers()
    try {
      const r = create(<Root apiBaseUrl="http://api" scale={0.5} />)
      expect(stub.locks).toBe(1)
      act(() => r.unmount()); mounted.pop()
      expect(stub.locks).toBe(0)
    } finally { vi.useRealTimers() }
    api(); await mount()
    expect(stub.locks).toBe(0)
  })

  describe('Player route', () => {
    const toPlayer = async (r: TestRenderer.ReactTestRenderer) => { await onTitle(r); press(r, 'Play Sintel with audio description'); await flush() }
    const kitPlayer = (r: TestRenderer.ReactTestRenderer) => r.root.find((n) => (n.type as unknown) === 'KitPlayer')

    it('Back saves the position (PUT /me/progress) and returns to Title; Play again resumes there', async () => {
      const s = api(); const r = await mount()
      await toPlayer(r)
      act(() => kitPlayer(r).props.onPosition(321.4)); kit.ref.getPosition.mockReturnValue(321.4)
      act(() => { back.press() })
      expect(s.puts).toContainEqual({ path: '/me/progress', body: { titleSlug: 'sintel-90-210', positionS: 321 } })
      expect(text(r)).toContain(strings.title.playWithout)
      press(r, 'Play Sintel with audio description'); await flush()
      expect(kitPlayer(r).props.startAt).toBe(321.4)
    })
    it('while playing, saves progress every 10 s of movement, not on every tick', async () => {
      const s = api(); const r = await mount()
      await toPlayer(r)
      for (const p of [0, 0.25, 0.5, 5, 9.75, 10, 10.25, 15, 20.1]) act(() => kitPlayer(r).props.onPosition(p))
      expect(s.puts.filter((x) => x.path === '/me/progress').map((x) => (x.body as { positionS: number }).positionS)).toEqual([10, 20])
    })
    it('a caption choice in the track sheet is saved to /me/prefs', async () => {
      const s = api(); const r = await mount()
      await toPlayer(r)
      act(() => r.root.findByType(Player).props.onPrefs({ captionKind: 'descriptions' }))
      expect(s.puts).toContainEqual({ path: '/me/prefs', body: { captionKind: 'descriptions' } })
      expect(r.root.findByType(Player).props.prefs.captionKind).toBe('descriptions')
    })
    it('passes the platform hook through to Player', async () => {
      api(); const onNowPlaying = vi.fn(); const r = await mount({ onNowPlaying })
      await toPlayer(r)
      expect(onNowPlaying).toHaveBeenCalledWith(expect.objectContaining({ slug: 'sintel-90-210', adOn: true }))
      act(() => { back.press() })
      expect(onNowPlaying).toHaveBeenLastCalledWith(null)
    })
  })
})
