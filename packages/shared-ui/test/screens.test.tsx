import React from 'react'
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer'
import { Home } from '../src/screens/Home'
import { Reading, Title } from '../src/screens/Title'
import { skeletonCount } from '../src/layout'
import { catalog, title } from './fixtures'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const error = console.error
beforeAll(() => { console.error = (...a: unknown[]) => { if (!String(a[0]).includes('react-test-renderer is deprecated')) error(...a) } })
afterAll(() => { console.error = error })
const noop = () => {}
function render(el: React.ReactElement) {
  let r!: TestRenderer.ReactTestRenderer
  act(() => { r = TestRenderer.create(el) })
  return r
}
const focusables = (r: TestRenderer.ReactTestRenderer) => r.root.findAll((n) => (n.type as unknown) === 'FocusableView')
const defaults = (r: TestRenderer.ReactTestRenderer) => r.root.findAll((n) => (n.type as unknown) === 'DefaultFocus' && n.props.enable === true)
const label = (n: ReactTestInstance) => n.props['aria-label'] as string | undefined
const home = (c = catalog) => <Home catalog={c} myList={new Set()} onOpen={noop} onPlay={noop} onToggleList={noop} />
const titleEl = (sample: 'idle' | 'playing' = 'idle') => <Title title={title} captionKind="sdh" inList={false} sample={sample} onPlay={noop} onSample={noop} onCaptions={noop} onToggleList={noop} onMore={noop} />

describe('every focusable states its purpose', () => {
  it.each([['Home', home()], ['Title', titleEl()], ['Title (sample playing)', titleEl('playing')], ['Reading', <Reading title={title} onClose={noop} />]])('%s', (_, el) => {
    const r = render(el)
    const f = focusables(r)
    expect(f.length).toBeGreaterThan(0)
    for (const n of f) {
      expect(label(n)?.trim().length, String(n.props.testID ?? label(n))).toBeGreaterThan(3)
      expect(label(n)).not.toMatch(/^(button|card|focusable)$/i)
    }
  })
  it('Home: primary action names the film and the description', () => {
    expect(focusables(render(home())).map(label)).toContain('Play Sintel with audio description')
  })
  it('Title: actions in spec order, sample hint present', () => {
    const f = focusables(render(titleEl()))
    expect(f.map(label)).toEqual([
      'Read the full synopsis of Sintel', 'Play Sintel with audio description', 'Play Sintel without description',
      'Hear a sample of the description voice for Sintel', 'Captions: Rich captions', 'Add Sintel to My list',
    ])
    expect(f.find((n) => label(n)?.startsWith('Hear'))!.props.accessibilityHint).toBeTruthy()
  })
  it('Title: processing replaces the play actions with words, never a spinner alone', () => {
    const r = render(<Title title={{ ...title, processingMinutesLeft: 12 }} captionKind="sdh" inList={false} sample="idle" onPlay={noop} onSample={noop} onCaptions={noop} onToggleList={noop} onMore={noop} />)
    expect(focusables(r).map(label)).not.toContain('Play Sintel with audio description')
    expect(JSON.stringify(r.toJSON())).toContain('about 12 minutes left')
  })
})

describe('initial focus and focus memory', () => {
  it('Home starts on "Play with description"; Title too', () => {
    for (const el of [home(), titleEl()]) {
      const d = defaults(render(el))
      expect(d).toHaveLength(1)
      expect(label(d[0]!.findByType('FocusableView' as never))).toBe('Play Sintel with audio description')
    }
  })
  it('returning to Home restores the last focused card', () => {
    const first = render(home())
    const card = focusables(first).find((n) => label(n)?.startsWith('Open Big Buck Bunny'))!
    act(() => card.props.onFocus())
    act(() => first.unmount())
    const again = render(home())
    const d = defaults(again)
    expect(d).toHaveLength(1)
    expect(label(d[0]!.findByType('FocusableView' as never))).toMatch(/^Open Big Buck Bunny/)
  })
  it('falls back to the default when the remembered title left the catalog', () => {
    const first = render(home())
    act(() => focusables(first).find((n) => label(n)?.startsWith('Open Big Buck Bunny'))!.props.onFocus())
    act(() => first.unmount())
    const r = render(home({ ...catalog, all: catalog.all.filter((i) => i.slug !== 'big-buck-bunny') }))
    expect(label(defaults(r)[0]!.findByType('FocusableView' as never))).toBe('Play Sintel with audio description')
  })
})

describe('loading', () => {
  it('Home skeleton: nothing focusable, skeleton rows sized like loaded rows', () => {
    const r = render(home(null as never))
    expect(focusables(r)).toHaveLength(0)
    expect(defaults(r)).toHaveLength(0)
    const json = JSON.stringify(r.toJSON())
    expect(json).not.toContain('Continue') // hidden until known non-empty
    const rows = r.root.findAll((n) => (n.type as unknown) === 'ScrollView').slice(1) // [0] is the page
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row.findAll((n) => (n.type as unknown) === 'View' && n.props.accessibilityElementsHidden === true)).toHaveLength(skeletonCount)
  })
  it('Title skeleton: nothing focusable', () => {
    const r = render(<Title title={null} captionKind="sdh" inList={false} sample="idle" onPlay={noop} onSample={noop} onCaptions={noop} onToggleList={noop} onMore={noop} />)
    expect(focusables(r)).toHaveLength(0)
  })
})
