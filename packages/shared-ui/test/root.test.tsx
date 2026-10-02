import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { FETCH_TIMEOUT_MS, Root } from '../src/index'
import { Player } from '../src/screens/Player'
import { Title } from '../src/screens/Title'
import { strings } from '../src/strings'
import { a11yCalls, back } from './stubs/react-native'
import { kit } from './stubs/kit'
import { stub } from './stubs/space-navigation'
import { catalog, tears, title } from './fixtures'

const prefs = { adDefault: true, extendedMode: true, voice: 'Joanna', captionKind: 'sdh', captionScale: 100, firstRunDone: true }
const ok = (data: unknown) => Promise.resolve({ json: async () => ({ success: true, data }) } as Response)
/** Fetch routed by path; `down` makes every request fail like an unreachable host. */
function api() {
  const state = {
    down: false, hang: false, calls: [] as string[], headers: [] as Record<string, string>[], bodies: [] as string[], puts: [] as { path: string; body: unknown }[],
    titles: { [title.slug]: title, [tears.slug]: { ...title, ...tears, synopsis: 'Robots.' } } as Record<string, typeof title>,
    /** Paths that wait until settle(path, ok) is called. */
    held: new Map<string, { resolve: (r: Response) => void; reject: (e: Error) => void }>(),
    hold: [] as string[],
  }
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace('http://api', '')
    state.calls.push(path); state.headers.push(init?.headers as Record<string, string>); state.bodies.push(String(init?.body ?? ''))
    if (init?.method === 'PUT') state.puts.push({ path, body: JSON.parse(String(init.body)) })
    if (state.hold.includes(path)) return new Promise<Response>((resolve, reject) => state.held.set(path, { resolve, reject }))
    if (state.hang) return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    if (state.down) return Promise.reject(new Error('network'))
    if (path === '/catalog') return ok(catalog)
    if (path === '/me/prefs') return ok(prefs)
    if (path.startsWith('/titles/')) return ok(state.titles[path.slice('/titles/'.length)])
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
      act(() => kitPlayer(r).props.onPosition(321.4))
      act(() => { back.press() }); await flush()
      expect(s.puts).toContainEqual({ path: '/me/progress', body: { titleSlug: 'sintel-90-210', positionS: 321 } })
      expect(text(r)).toContain(strings.title.playWithout)
      press(r, 'Play Sintel with audio description'); await flush()
      expect(kitPlayer(r).props.startAt).toBe(321.4)
    })
    it('while playing, saves progress every 10 s of movement, not on every tick', async () => {
      const s = api(); const r = await mount()
      await toPlayer(r)
      for (const p of [0, 0.25, 0.5, 5, 9.75, 10, 10.25, 15, 20.1]) act(() => kitPlayer(r).props.onPosition(p))
      await flush()
      expect(s.puts.filter((x) => x.path === '/me/progress').map((x) => (x.body as { positionS: number }).positionS)).toEqual([10, 20])
    })
    it('progress PUTs go one at a time, in order: an older position never lands after a newer one', async () => {
      const s = api(); const r = await mount()
      await toPlayer(r)
      const sent: number[] = []
      let release!: () => void
      const gate = new Promise<void>((res) => { release = res })
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
        const pos = JSON.parse(String(init?.body)).positionS as number
        if (pos === 10) await gate // the first save is slow
        sent.push(pos)
        return { json: async () => ({ success: true, data: {} }) } as Response
      }))
      void s
      for (const p of [0, 10, 20]) act(() => kitPlayer(r).props.onPosition(p))
      await flush()
      expect(sent).toEqual([])
      release(); await flush()
      expect(sent).toEqual([10, 20])
    })
    it('Back at 0:00 with nothing saved writes no progress row', async () => {
      const s = api(); const r = await mount()
      await toPlayer(r)
      act(() => { back.press() }); await flush()
      expect(s.puts.filter((x) => x.path === '/me/progress')).toEqual([])
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

  it('a late answer for a title you left is ignored: no offline screen, no stale title', async () => {
    const s = api(); s.hold.push('/titles/sintel-90-210')
    const r = await mount()
    await onTitle(r) // Sintel's request hangs
    act(() => { back.press() }); await flush()
    press(r, 'Open Tears of Steel'); await flush()
    expect(text(r)).toContain('Tears of Steel')
    await act(async () => { s.held.get('/titles/sintel-90-210')!.reject(new Error('network')) }); await flush()
    expect(text(r)).not.toContain(strings.a11y.retry)
    expect(text(r)).toContain(strings.title.playWithout)
    expect(stub.locks).toBe(0)
  })

  it('a late success for a title you left does not replace the current one', async () => {
    const s = api(); s.hold.push('/titles/sintel-90-210')
    const r = await mount()
    await onTitle(r)
    act(() => { back.press() }); await flush()
    press(r, 'Open Tears of Steel'); await flush()
    await act(async () => { s.held.get('/titles/sintel-90-210')!.resolve(await ok(title)) }); await flush()
    expect(r.root.findByType(Title).props.title.slug).toBe('tears-of-steel')
  })

  it('progress: the first reports before the resume seek never overwrite the saved position', async () => {
    const s = api(); s.titles[title.slug] = { ...title, resumeS: 300 }
    const r = await mount()
    await onTitle(r)
    press(r, 'Play Sintel with audio description'); await flush()
    const report = r.root.findByType(Player).props.onProgress as (n: number) => void
    for (const t of [0, 0.25, 0.5, 0.75, 300, 300.25, 305, 310.25]) act(() => report(t))
    await flush()
    const saves = s.bodies.filter((b) => b.includes('positionS')).map((b) => JSON.parse(b).positionS)
    expect(saves).toEqual([300, 310])
  })

  it('Back while the player is still loading the title goes to Title, not out of the app', async () => {
    const s = api(); s.hold.push('/titles/sintel-90-210')
    const r = await mount()
    press(r, 'Play Sintel with audio description'); await flush() // Home hero → player route, title not loaded
    expect(text(r)).toContain(strings.player.loading)
    let handled = false
    act(() => { handled = back.press() })
    expect(handled).toBe(true)
    await act(async () => { s.held.get('/titles/sintel-90-210')!.resolve(await ok(title)) }); await flush()
    expect(text(r)).toContain(strings.title.playWithout)
  })

  it('Back from the offline screen on the player route goes to Title', async () => {
    const s = api(); const r = await mount()
    s.down = true
    press(r, 'Play Sintel with audio description'); await flush()
    expect(focusables(r).map((n) => n.props['aria-label'])).toEqual([strings.a11y.retry])
    let handled = false
    act(() => { handled = back.press() })
    expect(handled).toBe(true)
  })

  it('a late title answer from a player route you left is ignored too', async () => {
    const s = api(); s.hold.push('/titles/sintel-90-210')
    const r = await mount()
    press(r, 'Play Sintel with audio description'); await flush()
    act(() => { back.press() }); await flush() // → Title (still loading)
    act(() => { back.press() }); await flush() // → Home
    press(r, 'Open Tears of Steel'); await flush()
    await act(async () => { s.held.get('/titles/sintel-90-210')!.reject(new Error('network')) }); await flush()
    expect(text(r)).not.toContain(strings.a11y.retry)
    expect(r.root.findByType(Title).props.title.slug).toBe('tears-of-steel')
  })

  it('Continue watching is refetched on the way back to Home after a progress save', async () => {
    const s = api(); const r = await mount()
    await onTitle(r)
    press(r, 'Play Sintel with audio description'); await flush()
    act(() => r.root.find((n) => (n.type as unknown) === 'KitPlayer').props.onPosition(200))
    act(() => { back.press() }); await flush() // saves 200, → Title
    s.calls.length = 0
    act(() => { back.press() }); await flush() // → Home
    expect(s.calls).toEqual(['/catalog'])
    s.calls.length = 0
    act(() => { back.press() }); await flush() // Home: left to the platform, nothing refetched
    await onTitle(r); act(() => { back.press() }); await flush()
    expect(s.calls).not.toContain('/catalog') // no save since: no refetch
  })

  it('Player status line names the caption setting in words', async () => {
    api(); const r = await mount()
    await onTitle(r)
    press(r, 'Play Sintel with audio description'); await flush()
    act(() => r.root.find((n) => (n.type as unknown) === 'KitPlayer').props.onTracks({ audio: [], text: [{ id: '0', language: 'en', label: 'Rich captions', kind: 'captions', active: false }] }))
    expect(text(r)).toContain('Description on · Joanna · Rich captions')
    expect(text(r)).not.toContain('· sdh')
  })
})
