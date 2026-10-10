import React from 'react'
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer'
import { Home } from '../src/screens/Home'
import { Reading, Title } from '../src/screens/Title'
import { Described } from '../src/screens/Described'
import { MyList } from '../src/screens/MyList'
import { Rail } from '../src/components/Rail'
import { strings } from '../src/strings'
import { rowPadY, skeletonCount } from '../src/layout'
import { ANNOUNCE_DEBOUNCE_MS, _setScreenReader } from '../src/a11y'
import { tokens } from '../src/theme/tokens'
import { animCalls } from './stubs/react-native'
import { stub } from './stubs/space-navigation'
import { bunny, catalog, sintel, tears, title } from './fixtures'
import { a11yCalls } from './stubs/react-native'

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
  it.each([['Home', home()], ['Described', <Described catalog={catalog} onOpen={noop} />], ['My list', <MyList catalog={catalog} myList={new Set(['tears-of-steel'])} onOpen={noop} />], ['Title', titleEl()], ['Title (sample playing)', titleEl('playing')], ['Reading', <Reading title={title} onClose={noop} />]])('%s', (_, el) => {
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
  // DESC-019: on the stick the absolutely placed ✓ covered narrow labels ("My lis✓t"). The ✓ now has its own slot after the label.
  const own = (n: ReactTestInstance) => [n.props.style].flat(3).filter(Boolean).reduce((a, s) => Object.assign(a, s), {} as Record<string, unknown>)
  const hasCheck = (n: ReactTestInstance) => n.findAll((x) => (x.type as unknown) === 'Text').some((t) => [t.props.children].flat().includes('✓'))
  const listButton = (inList: boolean) => {
    const r = render(<Title title={title} captionKind="sdh" inList={inList} sample="idle" onPlay={noop} onSample={noop} onCaptions={noop} onToggleList={noop} onMore={noop} />)
    return focusables(r).find((n) => label(n) === (inList ? strings.a11y.listRemove(title.name) : strings.a11y.listAdd(title.name)))!
  }
  it('the selected check never overlaps the label: the label area excludes the check', () => {
    const list = listButton(true)
    const row = list.findByProps({ testID: 'focusable-content' })
    expect(own(row)).toMatchObject({ flexDirection: 'row', alignItems: 'center' })
    const [labelArea, slot] = row.children as ReactTestInstance[]
    expect(labelArea!.findAll((x) => (x.type as unknown) === 'Text').map((t) => t.props.children)).toContain(strings.home.myList)
    expect(hasCheck(labelArea!)).toBe(false)
    expect(slot!.props.testID).toBe('focusable-check')
    expect(hasCheck(slot!)).toBe(true)
    expect(own(slot!)).toMatchObject({ minWidth: tokens.focus.checkW, marginLeft: tokens.focus.checkGap }) // scale 1 in tests
    // In flow: nothing between the ✓ and the button is absolutely positioned, so it cannot be drawn over the text.
    const glyph = slot!.findAll((x) => (x.type as unknown) === 'Text').find((t) => [t.props.children].flat().includes('✓'))!
    for (let p: ReactTestInstance | null = glyph; p && p !== list; p = p.parent) expect(own(p).position).not.toBe('absolute')
    // The ring stays an overlay but carries no ✓ of its own.
    const ring = list.findAll((x) => (x.type as unknown) === 'View' && own(x).borderColor === tokens.color.interactive)
    expect(ring).toHaveLength(1)
    expect(hasCheck(ring[0]!)).toBe(false)
  })
  it('the check slot grows with a large Android font scale instead of clipping the ✓ (PR #28 review)', () => {
    const slot = listButton(true).findByProps({ testID: 'focusable-check' })
    expect(own(slot)).toMatchObject({ minWidth: tokens.focus.checkW })
    expect(own(slot).width).toBeUndefined() // a fixed width would clip a font-scaled glyph
    const glyph = slot.findAll((x) => (x.type as unknown) === 'Text').find((t) => [t.props.children].flat().includes('✓'))!
    expect(glyph.props.numberOfLines).toBe(1) // never wraps onto a second line inside the slot
  })
  it('toggling selected does not change the control width', () => {
    const off = listButton(false), on = listButton(true)
    const box = (n: ReactTestInstance) => ({ row: own(n.findByProps({ testID: 'focusable-content' })), slot: own(n.findByProps({ testID: 'focusable-check' })) })
    expect(box(off)).toEqual(box(on)) // the slot is reserved while unselected, so selecting only fills it
    expect(hasCheck(off)).toBe(false)
    expect(hasCheck(on)).toBe(true)
  })
  it('only toggles reserve the slot: Play has none', () => {
    const r = render(titleEl())
    const play = focusables(r).find((n) => label(n) === 'Play Sintel with audio description')!
    expect(play.findAll((x) => x.props.testID === 'focusable-check')).toHaveLength(0)
  })
  it('collapsed rail: no room, so no ✓ and no slot; open rail: ✓ in its slot', () => {
    const r = render(<Rail items={[{ key: 'home', label: 'Home' }, { key: 'list', label: 'My list' }]} current="list" onSelect={noop} />)
    const current = () => focusables(r).find((n) => n.props.accessibilityState.selected)!
    expect(hasCheck(current())).toBe(false)
    expect(current().findAll((x) => x.props.testID === 'focusable-check')).toHaveLength(0)
    act(() => r.root.findAll((n) => (n.type as unknown) === 'Node')[0]!.props.onActive())
    expect(hasCheck(current())).toBe(true)
    expect(current().findAll((x) => x.props.testID === 'focusable-check')).toHaveLength(1)
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

describe('Described and My list grids', () => {
  const four = { ...catalog, all: [sintel, tears, bunny, { ...bunny, slug: 'cosmos-laundromat', name: 'Cosmos Laundromat' }] }
  const described = (c = four) => <Described catalog={c} onOpen={noop} />
  const cardLabels = (r: TestRenderer.ReactTestRenderer) => focusables(r).map(label).filter((l) => l?.startsWith('Open '))
  it('lays cards in rows of 3, aligned in a grid, each labelled like a Home card', () => {
    const r = render(described())
    const grid = r.root.find((n) => (n.type as unknown) === 'Node' && n.props.orientation === 'vertical' && n.props.alignInGrid === true)
    const rows = grid.findAll((n) => (n.type as unknown) === 'Node' && n.props.orientation === 'horizontal')
    expect(rows.map((row) => row.findAll((n) => (n.type as unknown) === 'FocusableView').length)).toEqual([3, 1])
    const homeLabels = focusables(render(home())).map(label)
    for (const l of cardLabels(r).slice(0, 3)) expect(homeLabels).toContain(l)
  })
  it('Grid focus memory returns to the last card', () => {
    const first = render(described())
    expect(label(defaults(first)[0]!.findByType('FocusableView' as never))).toMatch(/^Open Sintel/) // first visit: first card
    act(() => focusables(first).find((n) => label(n)?.startsWith('Open Cosmos'))!.props.onFocus())
    act(() => first.unmount())
    const again = render(described())
    expect(defaults(again)).toHaveLength(1)
    expect(label(defaults(again)[0]!.findByType('FocusableView' as never))).toMatch(/^Open Cosmos/)
    act(() => again.unmount())
    // My list keeps its own memory: still starts on its first card.
    const list = render(<MyList catalog={four} myList={new Set(['tears-of-steel', 'sintel-90-210'])} onOpen={noop} />)
    expect(cardLabels(list)).toEqual([expect.stringMatching(/^Open Tears of Steel/), expect.stringMatching(/^Open Sintel/)]) // list order, newest first
    expect(label(defaults(list)[0]!.findByType('FocusableView' as never))).toMatch(/^Open Tears of Steel/)
  })
  it('a remembered card that left the grid falls back to the first', () => {
    const first = render(described())
    act(() => focusables(first).find((n) => label(n)?.startsWith('Open Cosmos'))!.props.onFocus())
    act(() => first.unmount())
    expect(label(defaults(render(described(catalog)))[0]!.findByType('FocusableView' as never))).toMatch(/^Open Sintel/)
  })
  it('says the heading once on entering the grid', () => {
    vi.useFakeTimers(); _setScreenReader(true)
    try {
      const r = render(described())
      expect(JSON.stringify(r.toJSON())).toContain(strings.described.heading)
      const grid = r.root.find((n) => (n.type as unknown) === 'Node' && n.props.alignInGrid === true)
      act(() => grid.props.onActive())
      const [a, b] = focusables(r).filter((n) => label(n)?.startsWith('Open '))
      for (const card of [a!, b!]) { act(() => card.props.onFocus()); act(() => { vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS) }) }
      expect(a11yCalls).toEqual([`${strings.described.heading}. ${label(a!)}`, label(b!)])
    } finally { vi.useRealTimers(); _setScreenReader(false) }
  })
  it("the last row keeps room below for the focus outline", () => {
    const r = render(described())
    const grid = r.root.find((n) => (n.type as unknown) === 'Node' && n.props.alignInGrid === true)
    const box = grid.findAll((n) => (n.type as unknown) === 'View')[0]!
    expect(box.props.style).toMatchObject({ paddingBottom: rowPadY })
  })
  describe.each([
    ['Described', strings.described.heading, () => described()],
    ['My list', strings.list.heading, () => <MyList catalog={four} myList={new Set(['tears-of-steel'])} onOpen={noop} />],
  ])('%s heading (device run 2026-10-10: only the lower half of the letters showed)', (_, heading, el) => {
    // Focusing the first card scrolled the grid so the card sat offsetFromStart below the top, which pushed the heading
    // above it half out of the scroll view. The heading now sits above the scroll view, so no focus scroll can move it.
    const headingText = (r: TestRenderer.ReactTestRenderer) => r.root.find((n) => (n.type as unknown) === 'Text' && n.props.children === heading)
    it('is outside the scroll view, at a non-negative top offset', () => {
      const r = render(el())
      const t = headingText(r)
      for (let n: ReactTestInstance | null = t.parent; n; n = n.parent) expect(n.type as unknown).not.toBe('ScrollView')
      const style = Object.assign({}, ...[t.props.style].flat(Infinity).filter(Boolean)) as Record<string, number>
      for (const k of ['top', 'marginTop', 'paddingTop'] as const) expect(style[k] ?? 0).toBeGreaterThanOrEqual(0)
      expect(style.position).not.toBe('absolute')
    })
    it('has a line height that holds its glyphs (Atkinson Bold: caps 0.668 em + descender 0.29 em)', () => {
      const t = headingText(render(el()))
      const style = Object.assign({}, ...[t.props.style].flat(Infinity).filter(Boolean)) as Record<string, number>
      expect(style.lineHeight).toBe(tokens.type.title.line)
      expect(style.lineHeight).toBeGreaterThanOrEqual(style.fontSize! * (0.668 + 0.29))
      expect(style.lineHeight).toBeGreaterThanOrEqual(style.fontSize!)
    })
    it('the first row keeps room above for the focus outline, and a focus scroll keeps it there', () => {
      const r = render(el())
      const scroll = r.root.find((n) => (n.type as unknown) === 'ScrollView')
      expect(scroll.props.offsetFromStart).toBe(rowPadY) // equal to the padding above the first row: focusing it scrolls to 0
      const grid = r.root.find((n) => (n.type as unknown) === 'Node' && n.props.alignInGrid === true)
      expect(grid.findAll((n) => (n.type as unknown) === 'View')[0]!.props.style).toMatchObject({ paddingTop: rowPadY })
    })
  })
  it('loading: skeleton cards, nothing focusable', () => {
    const r = render(<Described catalog={null} onOpen={noop} />)
    expect(focusables(r)).toHaveLength(0)
    expect(r.root.findAll((n) => (n.type as unknown) === 'View' && n.props.accessibilityElementsHidden === true).length).toBeGreaterThan(0)
  })
  it('empty My list: no cards, the empty sentence in a live region, said once with the rail item as one utterance', () => {
    vi.useFakeTimers(); _setScreenReader(true)
    try {
      const r = render(<MyList catalog={catalog} myList={new Set()} onOpen={noop} />)
      expect(focusables(r)).toHaveLength(0)
      const live = r.root.find((n) => (n.type as unknown) === 'View' && n.props.accessibilityLiveRegion === 'polite')
      expect(JSON.stringify(live.findAll((n) => (n.type as unknown) === 'Text').map((t) => t.props.children))).toContain(strings.list.empty)
      act(() => r.update(<MyList catalog={catalog} myList={new Set()} onOpen={noop} />))
      act(() => { vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS) })
      expect(a11yCalls).toEqual([[strings.list.heading, strings.list.empty.replace(/\.$/, ''), strings.a11y.rail(strings.rail.list)].join('. ')])
    } finally { vi.useRealTimers(); _setScreenReader(false) }
  })
})
