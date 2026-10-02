import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseVtt } from '@moizp/vega-media-kit/core'
import { ExtendedScheduler, extendedCues, MAX_TICK_S, PREFETCH_AHEAD_S } from '../src/extended'

const VTT = readFileSync(path.resolve(__dirname, 'fixtures/descriptions.vtt'), 'utf8')
const cues = extendedCues(parseVtt(VTT, { trackId: 'descriptions' }))
const play = (s: ExtendedScheduler, from: number, to: number, step = 0.25) => {
  const out: { at: number; trigger?: string; upcoming?: string }[] = []
  for (let t = from; t <= to + 1e-9; t += step) { const r = s.tick(+t.toFixed(3)); out.push({ at: +t.toFixed(3), trigger: r.triggers.map((c) => c.id).join(',') || undefined, upcoming: r.upcoming?.id }) }
  return out
}

describe('extended cues from the description track', () => {
  it('only {extended=1} cues, with d{n} = their place among all description cues', () => {
    expect(cues.map((c) => [c.id, c.start])).toEqual([['d2', 20], ['d3', 40]])
  })
  it('counts places, not identifiers (packaging may drop cue ids)', () => {
    const noIds = VTT.replace(/^d\d\n/gm, '')
    expect(extendedCues(parseVtt(noIds, { trackId: 'x' })).map((c) => c.id)).toEqual(['d2', 'd3'])
  })
})

describe('ExtendedScheduler', () => {
  it('a forward crossing in playback triggers exactly once', () => {
    const s = new ExtendedScheduler(cues)
    const fired = play(s, 15, 45).filter((t) => t.trigger).map((t) => [t.at, t.trigger])
    expect(fired).toEqual([[20, 'd2'], [40, 'd3']])
  })
  it('a seek across or onto a cue never triggers it; the first tick after a seek is a baseline', () => {
    const s = new ExtendedScheduler(cues)
    play(s, 10, 12)
    expect(s.tick(25).triggers).toEqual([]) // a jump > MAX_TICK_S is a seek even unannounced
    s.seeked()
    expect(s.tick(20).triggers).toEqual([]) // landed exactly on d2
    expect(play(s, 20.25, 30).some((t) => t.trigger)).toBe(false)
  })
  it('re-crossing after a backwards seek triggers again', () => {
    const s = new ExtendedScheduler(cues)
    expect(play(s, 19, 21).filter((t) => t.trigger).length).toBe(1)
    s.seeked()
    expect(play(s, 15, 21).filter((t) => t.trigger).map((t) => t.trigger)).toEqual(['d2'])
  })
  it('a small backward step (a jittery tick) keeps the furthest position: no re-crossing', () => {
    const s = new ExtendedScheduler(cues)
    play(s, 19, 20.25); s.tick(19.5)
    expect(play(s, 19.75, 21).filter((t) => t.trigger).length).toBe(0)
  })
  it('a large backward jump without seeked() is a new baseline', () => {
    const s = new ExtendedScheduler(cues)
    play(s, 19, 21); s.tick(15)
    expect(play(s, 15.25, 21).filter((t) => t.trigger).map((t) => t.trigger)).toEqual(['d2'])
  })
  it('two extended cues crossed in one tick are both returned, in order', () => {
    const two = [{ id: 'd4', start: 30, end: 30.833, text: 'a' }, { id: 'd5', start: 30.1, end: 30.933, text: 'b' }]
    const s = new ExtendedScheduler(two); s.tick(29.9)
    expect(s.tick(30.15).triggers.map((c) => c.id)).toEqual(['d4', 'd5'])
  })
  it(`a step of up to ${MAX_TICK_S} s is still playback (a late tick)`, () => {
    const s = new ExtendedScheduler(cues)
    s.tick(19); expect(s.tick(19 + MAX_TICK_S).triggers.map((c) => c.id)).toEqual(['d2'])
  })
  it('a cue at 0:00 counts when playback begins there', () => {
    const at0 = [{ id: 'd1', start: 0, end: 0.833, text: 'x' }]
    const s = new ExtendedScheduler(at0); s.begin(0)
    expect(s.tick(0).triggers.map((c) => c.id)).toEqual(['d1'])
    expect(new ExtendedScheduler(at0).tick(0).triggers).toEqual([])
  })
  it(`upcoming is the next extended cue within ${PREFETCH_AHEAD_S} s`, () => {
    const s = new ExtendedScheduler(cues)
    expect(s.tick(9.75).upcoming).toBeUndefined()
    expect(s.tick(10).upcoming?.id).toBe('d2')
    expect(s.tick(20).upcoming).toBeUndefined() // d2 has started; d3 is 20 s away
    expect(s.tick(30).upcoming?.id).toBe('d3')
  })
})
