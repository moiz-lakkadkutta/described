import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Root } from '../src/index'
import { configureRemote } from '../src/focus/remote'
import { SEEK_COMMIT_MS } from '../src/playback'
import { strings } from '../src/strings'
import { back } from './stubs/react-native'
import { kit } from './stubs/kit'
import { stub } from './stubs/space-navigation'
import { catalog, title } from './fixtures'

// Root-level paths the unit tests can't see: Back on the player route before a Player exists, and one key path from
// the platform source through the handlers to spatial navigation.
const prefs = { adDefault: true, extendedMode: true, voice: 'Joanna', captionKind: 'sdh', captionScale: 100, captionStyle: 'box', firstRunDone: true }
const ok = (data: unknown) => Promise.resolve({ json: async () => ({ success: true, data }) } as Response)
function api() {
  const state = { titleHang: false, titleDown: false, puts: [] as string[] }
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace('http://api', '')
    if (init?.method === 'PUT') { state.puts.push(path); return ok({}) }
    if (path === '/catalog') return ok(catalog)
    if (path === '/me/prefs') return ok(prefs)
    if (path.startsWith('/titles/')) {
      if (state.titleHang) return new Promise(() => {})
      if (state.titleDown) return Promise.reject(new Error('network'))
      return ok(title)
    }
    return ok({})
  }))
  return state
}
/** The platform key source: `press('left')` is one key-down. */
const listeners = new Set<(k: never, repeat?: boolean) => void>()
configureRemote((onKey) => { listeners.add(onKey as never); return () => listeners.delete(onKey as never) })
const press = (k: string) => act(() => { for (const l of [...listeners]) l(k as never, false) })

const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
const focusables = (r: TestRenderer.ReactTestRenderer) => r.root.findAll((n) => (n.type as unknown) === 'FocusableView')
const find = (r: TestRenderer.ReactTestRenderer, l: string) => focusables(r).find((n) => String(n.props['aria-label']).startsWith(l))!
const select = (r: TestRenderer.ReactTestRenderer, l: string) => act(() => find(r, l).props.onSelect())
const text = (r: TestRenderer.ReactTestRenderer) => JSON.stringify(r.toJSON())
const players = (r: TestRenderer.ReactTestRenderer) => r.root.findAll((n) => (n.type as unknown) === 'KitPlayer')
let r: TestRenderer.ReactTestRenderer | undefined
async function mount() { act(() => { r = TestRenderer.create(<Root apiBaseUrl="http://api" scale={0.5} />) }); await flush(); return r! }
beforeEach(() => kit.reset())
afterEach(() => { if (r) act(() => r!.unmount()); r = undefined; vi.unstubAllGlobals() })

describe('Back on the player route with no Player mounted', () => {
  it('while the title is still loading (Home → Play): goes to Title, never leaves the app', async () => {
    const s = api(); const r = await mount()
    s.titleHang = true
    select(r, 'Play Sintel with audio description'); await flush()
    expect(text(r)).toContain(strings.player.loading)
    expect(players(r)).toHaveLength(0)
    act(() => { expect(back.press()).toBe(true) })
    expect(text(r)).not.toContain(strings.player.loading) // the Title skeleton, not the player's loading line
  })
  it('while the offline screen is up: goes to Title; Retry then loads Title, not the player', async () => {
    const s = api(); const r = await mount()
    s.titleDown = true
    select(r, 'Play Sintel with audio description'); await flush()
    expect(text(r)).toContain('reach the library')
    act(() => { expect(back.press()).toBe(true) })
    s.titleDown = false
    select(r, strings.a11y.retry); await flush()
    expect(players(r)).toHaveLength(0)
    expect(text(r)).toContain(strings.title.playWithout)
  })
})

describe('one key path: platform source → handlers → spatial navigation', () => {
  it("Player takes Play/Pause once and ◄ without a focus move; Settings' ◄► handler is gone after it closes", async () => {
    const s = api(); const r = await mount()
    select(r, 'Open Sintel'); await flush()
    select(r, 'Play Sintel with audio description'); await flush()
    act(() => { (players(r)[0]!.props.onState as (x: string) => void)('playing') })
    stub.moves.length = 0
    press('playPause')
    expect(kit.ref.pause).toHaveBeenCalledTimes(1)
    press('left')
    expect(stub.moves).toEqual([])

    // Back to Title (Player owns Back), then Settings with a value row focused, so its ◄► handler is live…
    act(() => { back.press() }); await flush()
    select(r, 'Go to Settings')
    act(() => find(r, strings.settings.capSize).props.onFocus())
    press('right'); await flush()
    expect(s.puts.filter((p) => p === '/me/prefs')).toHaveLength(1) // Settings took ►
    // …then Home → Title → Player: ◄► must seek, not change Settings.
    select(r, 'Go to Home')
    select(r, 'Open Sintel'); await flush()
    select(r, 'Play Sintel with audio description'); await flush()
    kit.ref.seek.mockClear(); stub.moves.length = 0
    press('right')
    await act(() => new Promise<void>((res) => setTimeout(res, SEEK_COMMIT_MS + 30)))
    expect(kit.ref.seek).toHaveBeenCalledTimes(1)
    expect(stub.moves).toEqual([])
    expect(s.puts.filter((p) => p === '/me/prefs')).toHaveLength(1) // no Settings change from the player's ►
  })
})
