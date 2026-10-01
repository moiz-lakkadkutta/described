import React from 'react'
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer'
import { Home } from '../src/screens/Home'
import { Reading, Title } from '../src/screens/Title'
import { skeletonCount } from '../src/layout'
import { tokens } from '../src/theme/tokens'
import { animCalls } from './stubs/react-native'
import { stub } from './stubs/space-navigation'
import { catalog, title } from './fixtures'

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
    const r = render(titleEl())
    act(() => r.root.findByProps({ testID: 'synopsis-measure' }).props.onTextLayout({ nativeEvent: { lines: [1, 2, 3, 4, 5] } }))
    const f = focusables(r)
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

describe('More', () => {
  const more = (lines: number) => {
    const r = render(titleEl())
    act(() => r.root.findByProps({ testID: 'synopsis-measure' }).props.onTextLayout({ nativeEvent: { lines: Array(lines).fill(0) } }))
    return focusables(r).some((n) => label(n)?.startsWith('Read the full synopsis'))
  }
  it('appears only when the laid-out synopsis runs past 4 lines', () => {
    expect(more(4)).toBe(false)
    expect(more(5)).toBe(true)
  })
})

describe('focus visuals', () => {
  const styles = (n: ReactTestInstance) => n.findAll((x) => (x.type as unknown) === 'View').map((x) => Object.assign({}, ...[x.props.style].flat(3).filter(Boolean)))
  it('focused: off-white outline outside the element, scale 1.04 over 150 ms', () => {
    stub.focused = 'Play Sintel with audio description'
    const r = render(home())
    const f = focusables(r).find((n) => label(n) === stub.focused)!
    const outline = styles(f).find((s) => s.borderColor === tokens.color.focus)
    expect(outline).toMatchObject({ position: 'absolute', borderWidth: tokens.focus.width }) // stub screen is 1920 wide → scale 1
    expect(outline!.top).toBe(-(tokens.focus.width + tokens.focus.offset))
    act(() => f.props.onFocus())
    expect(animCalls).toContainEqual(expect.objectContaining({ toValue: tokens.motion.focusScale, duration: tokens.motion.focusMs }))
    expect(focusables(r).filter((n) => styles(n).some((s) => s.borderColor === tokens.color.focus))).toHaveLength(1)
  })
  it('selected: teal inset ring and a check', () => {
    const r = render(<Home catalog={catalog} myList={new Set(['sintel-90-210'])} onOpen={noop} onPlay={noop} onToggleList={noop} />)
    const list = focusables(r).find((n) => label(n) === 'Remove Sintel from My list')!
    expect(styles(list).some((s) => s.borderColor === tokens.color.interactive)).toBe(true)
    expect(JSON.stringify(list.findAll((x) => (x.type as unknown) === 'Text').map((t) => t.props.children))).toContain('✓')
    expect(list.props.accessibilityState).toEqual({ selected: true })
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
    expect(r.root.findAll((n) => (n.type as unknown) === 'Node' && n.props.orientation === 'horizontal').length).toBeGreaterThanOrEqual(3) // hero node mounted while loading
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row.findAll((n) => (n.type as unknown) === 'View' && n.props.accessibilityElementsHidden === true)).toHaveLength(skeletonCount)
  })
  it('Title skeleton: nothing focusable', () => {
    const r = render(<Title title={null} captionKind="sdh" inList={false} sample="idle" onPlay={noop} onSample={noop} onCaptions={noop} onToggleList={noop} onMore={noop} />)
    expect(focusables(r)).toHaveLength(0)
  })
})
