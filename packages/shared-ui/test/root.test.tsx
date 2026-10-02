import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { FETCH_TIMEOUT_MS, Root } from '../src/index'
import { Player } from '../src/screens/Player'
import { Title } from '../src/screens/Title'
import { strings } from '../src/strings'
import { a11yCalls, back } from './stubs/react-native'
import { stub } from './stubs/space-navigation'
import { catalog, tears, title } from './fixtures'

const prefs = { adDefault: true, extendedMode: true, voice: 'Joanna', captionKind: 'sdh', captionScale: 100, firstRunDone: true }
const ok = (data: unknown) => Promise.resolve({ json: async () => ({ success: true, data }) } as Response)
/** Fetch routed by path; `down` makes every request fail like an unreachable host. */
function api() {
  const state = {
    down: false, hang: false, calls: [] as string[], headers: [] as Record<string, string>[], bodies: [] as string[],
    titles: { [title.slug]: title, [tears.slug]: { ...title, ...tears, synopsis: 'Robots.' } } as Record<string, typeof title>,
    /** Paths that wait until settle(path, ok) is called. */
    held: new Map<string, { resolve: (r: Response) => void; reject: (e: Error) => void }>(),
    hold: [] as string[],
  }
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace('http://api', '')
    state.calls.push(path); state.headers.push(init?.headers as Record<string, string>); state.bodies.push(String(init?.body ?? ''))
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

  it('progress: nothing under 1 s when resuming, then one save per 10 s span', async () => {
    const s = api(); s.titles[title.slug] = { ...title, resumeS: 300 }
    const r = await mount()
    await onTitle(r)
    press(r, 'Play Sintel with audio description'); await flush()
    const report = r.root.findByType(Player).props.onProgress as (n: number) => void
    for (const t of [0, 0.25, 0.5, 0.75, 1.2, 4, 9.9, 9.75, 10.0, 10.25, 10.5, 19.9, 20.25]) act(() => report(t))
    await flush()
    const saves = s.bodies.filter((b) => b.includes('positionS')).map((b) => JSON.parse(b).positionS)
    expect(saves).toEqual([1.2, 10.0, 20.25])
  })

  it('Player status line names the caption setting in words', async () => {
    api(); const r = await mount()
    await onTitle(r)
    press(r, 'Play Sintel with audio description'); await flush()
    expect(text(r)).toContain('Description on · Joanna · Rich captions')
    expect(text(r)).not.toContain('· sdh')
  })
})
