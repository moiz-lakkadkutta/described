import React from 'react'
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer'
import { ANNOUNCE_DEBOUNCE_MS, _setScreenReader, announceFocus, setFocusContext } from '../src/a11y'
import { Root } from '../src/index'
import { titleSummary } from '../src/models'
import { Home } from '../src/screens/Home'
import { Reading, Title } from '../src/screens/Title'
import { strings } from '../src/strings'
import { a11yCalls } from './stubs/react-native'
import { catalog, title } from './fixtures'

// VoiceView pass (DESC-009): what a sighted viewer reads at a glance is also spoken, and state changes are announced.
const noop = () => {}
const mounted: TestRenderer.ReactTestRenderer[] = []
function create(el: React.ReactElement) { let r!: TestRenderer.ReactTestRenderer; act(() => { r = TestRenderer.create(el) }); mounted.push(r); return r }
const focusables = (r: TestRenderer.ReactTestRenderer) => r.root.findAll((n) => (n.type as unknown) === 'FocusableView')
const find = (r: TestRenderer.ReactTestRenderer, l: string) => focusables(r).find((n) => String(n.props['aria-label']).startsWith(l))!
const nodes = (r: TestRenderer.ReactTestRenderer) => r.root.findAll((n) => (n.type as unknown) === 'Node' && typeof n.props.onActive === 'function')
const settle = () => act(() => { vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS) })
const focusOn = (n: ReactTestInstance) => { act(() => n.props.onFocus()); settle() }
beforeEach(() => { vi.useFakeTimers(); _setScreenReader(true) })
afterEach(() => { mounted.splice(0).forEach((r) => act(() => r.unmount())); vi.useRealTimers(); _setScreenReader(false); vi.unstubAllGlobals() })

describe('focus context', () => {
  it('is said once, before the next focus announcement', () => {
    setFocusContext('Newly described')
    announceFocus('Open Sintel', undefined, () => true); vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS)
    announceFocus('Open Tears of Steel', undefined, () => true); vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS)
    expect(a11yCalls).toEqual(['Newly described. Open Sintel', 'Open Tears of Steel'])
  })
  it('is not kept while no screen reader is on', () => {
    _setScreenReader(false); setFocusContext('Newly described'); _setScreenReader(true)
    announceFocus('Open Sintel', undefined, () => true); vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS)
    expect(a11yCalls).toEqual(['Open Sintel'])
  })
})

describe('Home', () => {
  it('entering a row says its name; entering the hero says the film and synopsis', () => {
    const r = create(<Home catalog={catalog} myList={new Set()} onOpen={noop} onPlay={noop} onToggleList={noop} />)
    const [hero, ...rows] = nodes(r)
    expect(rows).toHaveLength(3) // Continue watching, Newly described, All titles
    act(() => rows[1]!.props.onActive())
    focusOn(find(r, 'Open Sintel'))
    expect(a11yCalls.at(-1)).toMatch(/^Newly described\. Open Sintel\. 2010/)
    act(() => hero!.props.onActive())
    focusOn(find(r, 'Play Sintel with audio description'))
    expect(a11yCalls.at(-1)).toBe('Sintel. Sintel synopsis. Play Sintel with audio description')
  })
})

describe('Title and reading view', () => {
  it('the first focus on Title is preceded by name, facts, badges and synopsis', () => {
    const r = create(<Title title={title} captionKind="sdh" inList={false} sample="idle" onPlay={noop} onSample={noop} onCaptions={noop} onToggleList={noop} onMore={noop} />)
    focusOn(find(r, 'Play Sintel with audio description'))
    expect(a11yCalls.at(-1)).toBe(`${titleSummary(title)}. Play Sintel with audio description`)
    expect(titleSummary(title)).toBe('Sintel. 2010. 15 minutes. Audio description. Rich captions. Pauses 3 times for longer descriptions. ' + title.synopsis!.replace(/\.$/, ''))
  })
  it('a processing title says how long is left (a live region is silent when it first appears)', () => {
    expect(titleSummary({ ...title, processingMinutesLeft: 12 })).toContain('about 12 minutes left')
  })
  it('the reading view reads the synopsis before Close', () => {
    const r = create(<Reading title={title} onClose={noop} />)
    focusOn(find(r, strings.a11y.close))
    expect(a11yCalls.at(-1)).toBe(`Sintel. ${title.synopsis!.replace(/\.$/, '')}. ${strings.a11y.close}`)
  })
})

describe('Root announces state changes', () => {
  const ok = (data: unknown) => Promise.resolve({ json: async () => ({ success: true, data }) } as Response)
  const prefs = { adDefault: true, extendedMode: true, voice: 'Joanna', captionKind: 'sdh', captionScale: 100, captionStyle: 'box', firstRunDone: true }
  const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
  function api(hang = false) {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (hang) return new Promise(() => {})
      const path = url.replace('http://api', '')
      return ok(path === '/catalog' ? catalog : path === '/me/prefs' ? prefs : path.startsWith('/titles/') ? title : {})
    }))
  }
  const press = (r: TestRenderer.ReactTestRenderer, l: string) => act(() => find(r, l).props.onSelect())
  it('Captions and My list say the new state', async () => {
    api(); const r = create(<Root apiBaseUrl="http://api" scale={0.5} />); await flush()
    press(r, 'Open Sintel'); await flush()
    press(r, 'Captions:')
    expect(a11yCalls.at(-1)).toBe('Captions: Description text')
    press(r, 'Add Sintel to My list')
    expect(a11yCalls.at(-1)).toBe('Sintel added to My list')
    press(r, 'Remove Sintel from My list')
    expect(a11yCalls.at(-1)).toBe('Sintel removed from My list')
  })
  it('loading beyond 2 s is spoken', async () => {
    api(true); create(<Root apiBaseUrl="http://api" scale={0.5} />)
    act(() => { vi.advanceTimersByTime(1900) })
    expect(a11yCalls).not.toContain(strings.a11y.loading)
    act(() => { vi.advanceTimersByTime(200) })
    expect(a11yCalls).toContain(strings.a11y.loading)
  })
})
