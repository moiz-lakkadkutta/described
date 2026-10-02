import { homeModel, titleModel } from '../src/models'
import { cardBox, focusBleed, rowPad, rowPadY, rowSlots, rowViewportW, skeletonCount } from '../src/layout'
import { tokens } from '../src/theme/tokens'
import { textStyle } from '../src/theme/typography'
import { catalog, title } from './fixtures'

describe('grid geometry', () => {
  it('a row shows 3 cards, 3 gutters and a 40 px peek', () => expect(rowViewportW).toBe(3 * 412 + 3 * 24 + 40))
  it('skeletons fill what a loaded row shows', () => expect(skeletonCount).toBe(4))
  it('row padding leaves room for the outline and 1.04 growth on every side', () => {
    const grow = (n: number) => (n * (tokens.motion.focusScale - 1)) / 2 + tokens.focus.width + tokens.focus.offset
    expect(rowPad).toBeGreaterThanOrEqual(grow(cardBox.w))
    expect(rowPadY).toBeGreaterThanOrEqual(grow(cardBox.h))
    expect(rowPadY).toBe(focusBleed(cardBox.h))
  })
  it('skeleton and loaded slots share one box, so focus geometry never jumps', () => {
    const loading = homeModel(null, new Set()), loaded = homeModel(catalog, new Set())
    const boxes = (m: typeof loading) => new Set(m.rows.flatMap((r) => r.cards.map((c) => `${c.w}x${c.h}`)))
    expect([...boxes(loading)]).toEqual([`${cardBox.w}x${cardBox.h}`])
    expect([...boxes(loaded)]).toEqual([...boxes(loading)])
    // Rows present in both states keep their order: Newly described then All titles.
    expect(loading.rows.map((r) => r.key)).toEqual(['newly', 'all'])
    expect(loaded.rows.map((r) => r.key).slice(-2)).toEqual(['newly', 'all'])
  })
  it('skeleton slots are never focus targets', () => {
    expect(homeModel(null, new Set()).ids).toEqual([])
    expect(rowSlots('all', null).every((s) => s.skeleton)).toBe(true)
  })
  it('Continue watching is hidden when empty', () => {
    expect(homeModel({ ...catalog, continue: [] }, new Set()).rows.map((r) => r.key)).toEqual(['newly', 'all'])
    expect(homeModel(catalog, new Set()).rows[0]!.key).toBe('continue')
  })
})

describe('type', () => {
  it('system-sans fallback keeps every size, line height and tracking', () => {
    for (const v of ['display', 'title', 'heading', 'body', 'label', 'caption', 'reading'] as const) {
      const a = textStyle(v, true, 0.5), b = textStyle(v, false, 0.5)
      expect([b.fontSize, b.lineHeight, b.letterSpacing]).toEqual([a.fontSize, a.lineHeight, a.letterSpacing])
      expect(a.fontFamily).toBe(tokens.type[v].family)
      expect(a.fontWeight).toBeUndefined() // the face carries the weight; Android would fake-bold a Bold face
      expect(b.fontWeight).toBe(tokens.type[v].weight)
    }
  })
  it('label tracking is +2 %', () => expect(textStyle('label', true, 1).letterSpacing).toBeCloseTo(28 * 0.02))
})

describe('Title model', () => {
  const m = titleModel(title, { sample: 'idle', inList: false, captionKind: 'sdh', synopsisLines: 6 })
  it('badges: AD (ochre), Rich captions, Extended pauses', () => expect(m.badges).toEqual([{ text: 'AD', ad: true }, { text: 'Rich captions', ad: false }, { text: 'Extended: 3 pauses', ad: false }]))
  it('year · duration', () => expect(m.meta).toBe('2010 · 15 min'))
  it('More only past 4 laid-out lines', () => {
    expect(m.more?.id).toBe('more')
    expect(titleModel(title, { sample: 'idle', inList: false, captionKind: 'sdh', synopsisLines: 4 }).more).toBeNull()
  })
  it('Extended badge is singular for one pause', () => expect(titleModel({ ...title, extendedCount: 1 }, { sample: 'idle', inList: false, captionKind: 'sdh' }).badges.at(-1)!.text).toBe('Extended: 1 pause'))
  it('no sample cue → no Hear a sample', () => expect(titleModel({ ...title, sampleCue: null }, { sample: 'idle', inList: false, captionKind: 'sdh' }).actions.map((a) => a.id)).not.toContain('sample'))
})

describe('progressSaver', () => {
  it('without a saved position, saves from 0, once per 10 s span; a seek back saves again', async () => {
    const { progressSaver } = await import('../src/models')
    const save = progressSaver(null)
    expect([0, 0.5, 9.9, 10, 10.2, 3].map(save)).toEqual([true, false, false, true, false, true])
  })
})
