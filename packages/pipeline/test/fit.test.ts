import { fit } from '../src/steps/05-fit'
import { shotsFromCuts } from '../src/steps/02-shots'
import { gapsFromWords } from '../src/steps/03-speech'
import { segment, wrap } from '../src/steps/08-text'
import { buildMixArgs } from '../src/steps/07-mix'
import { wordBudget } from '../src/prompts'

const shorten = (t: string, n: number) => t.split(' ').slice(0, n).join(' ')

describe('shots', () => {
  it('merges short shots and splits long ones', () => {
    const s = shotsFromCuts([1000, 1800, 20000], 30000)
    expect(s.map((x) => [x.startMs, x.endMs])).toEqual([[0, 1800], [1800, 9800], [9800, 17800], [17800, 20000], [20000, 28000], [28000, 30000]])
  })
})
describe('gaps', () => {
  it('finds gaps ≥ 1.2 s with 200 ms margins', () => {
    const g = gapsFromWords([{ start: 2, end: 2.5, text: 'Hi' }, { start: 2.6, end: 3, text: 'there' }, { start: 6, end: 6.4, text: 'Bye' }], 10000)
    expect(g).toEqual([{ startMs: 0, endMs: 1800 }, { startMs: 3200, endMs: 5800 }, { startMs: 6600, endMs: 10000 }])
  })
})
describe('fit', () => {
  const gaps = [{ startMs: 0, endMs: 3000 }, { startMs: 8000, endMs: 9500 }]
  it('places a description in the first gap at/after the shot and never over dialogue', async () => {
    const cues = await fit([{ index: 0, startMs: 0, endMs: 4000, description: 'A woman in a red coat crosses a bridge.', sameAsPrev: false, tokens: 0 }], gaps, shorten)
    expect(cues).toHaveLength(1)
    expect(cues[0]!.startMs).toBe(0)
    expect(cues[0]!.endMs).toBeLessThanOrEqual(3000)
    expect(cues[0]!.extended).toBe(false)
  })
  it('shortens to fit', async () => {
    const long = 'Night. A rooftop. A tall man in an olive coat and a burgundy scarf leans over the railing and looks down at the empty street below.'
    const cues = await fit([{ index: 0, startMs: 8000, endMs: 12000, description: long, sameAsPrev: false, tokens: 0 }], gaps, shorten)
    expect(cues[0]!.wordCount).toBeLessThanOrEqual(4) // 1.5 s gap → 4 words
  })
  it('marks extended when there is no gap and the shot introduces new information', async () => {
    const cues = await fit([{ index: 0, startMs: 20000, endMs: 24000, description: 'Words appear: Berlin, 1989.', sameAsPrev: false, tokens: 0 }], gaps, shorten)
    expect(cues[0]).toMatchObject({ extended: true, startMs: 20000 })
  })
  it('skips SAME shots', async () => {
    expect(await fit([{ index: 0, startMs: 0, endMs: 1000, description: '', sameAsPrev: true, tokens: 0 }], gaps, shorten)).toEqual([])
  })
})
describe('word budget', () => {
  it('8 words for a 3 s gap, min 3, extended 25', () => {
    expect(wordBudget({ index: 0, startMs: 0, endMs: 1000 }, [{ startMs: 0, endMs: 3000 }])).toBe(8)
    expect(wordBudget({ index: 0, startMs: 0, endMs: 1000 }, [{ startMs: 0, endMs: 500 }])).toBe(3)
    expect(wordBudget({ index: 0, startMs: 5000, endMs: 6000 }, [{ startMs: 0, endMs: 3000 }])).toBe(25)
  })
})
describe('captions', () => {
  it('segments at sentence ends and wraps to 2 × 42', () => {
    const words = 'I told you to wait. Twice. Now we are late for the train and it is raining again outside'.split(' ').map((t, i) => ({ start: i * 0.4, end: i * 0.4 + 0.3, text: t }))
    const cues = segment(words)
    expect(cues[0]!.text).toBe('I told you to wait.')
    for (const c of cues) { expect(c.text.split('\n').length).toBeLessThanOrEqual(2); for (const l of c.text.split('\n')) expect(l.length).toBeLessThanOrEqual(42) }
  })
  it('wrap respects limits', () => { expect(wrap('a '.repeat(50).trim(), 42, 2).split('\n').length).toBe(2) })
})
describe('mix', () => {
  it('builds a sidechain-ducking filter graph', () => {
    const args = buildMixArgs('work/x', [{ i: 0, startMs: 1000, endMs: 3000, text: 'x', extended: false, wordCount: 1, shotIndex: 0 }])
    const f = args[args.indexOf('-filter_complex') + 1]!
    expect(f).toContain('adelay=1000|1000')
    expect(f).toContain('sidechaincompress=threshold=0.02:ratio=6:attack=10:release=300')
    expect(f).toContain('loudnorm=I=-24:TP=-2')
  })
})
