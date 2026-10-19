import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseVtt } from '@moiz0309/vega-media-kit/core'
import { ARM_WINDOW_S, EXTENDED_LEAD_S, ExtendedScheduler, extendedCues, MAX_TICK_S, PREFETCH_AHEAD_S, type ExtendedCue } from '../src/extended'

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
  it('uses the VTT\'s own ids: a cue the parser drops does not shift the others', () => {
    const dropped = VTT.replace('A girl climbs a snowy ridge.', '<c></c>') // cleans to nothing: parseVtt drops d1
    expect(parseVtt(dropped, { trackId: 'x' }).map((c) => c.id)).toEqual(['d2', 'd3'])
    expect(extendedCues(parseVtt(dropped, { trackId: 'x' })).map((c) => c.id)).toEqual(['d2', 'd3'])
  })
})

describe('ExtendedScheduler', () => {
  it('a forward crossing in playback triggers exactly once', () => {
    const s = new ExtendedScheduler(cues)
    const fired = play(s, 15, 45).filter((t) => t.trigger).map((t) => [t.at, t.trigger])
    expect(fired).toEqual([[19.75, 'd2'], [39.75, 'd3']]) // the first tick within EXTENDED_LEAD_S of the start, never after it
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
    play(s, 19, 20.25); s.tick(19.5) // d2 fired at 19.75
    expect(play(s, 19.75, 21).filter((t) => t.trigger).length).toBe(0)
  })
  it('a large backward jump without seeked() is a new baseline', () => {
    const s = new ExtendedScheduler(cues)
    play(s, 19, 21); s.tick(15)
    expect(play(s, 15.25, 21).filter((t) => t.trigger).map((t) => t.trigger)).toEqual(['d2'])
  })
  it('two extended cues crossed in one tick are both returned, in order', () => {
    const two = [{ id: 'd4', start: 30, end: 30.833, text: 'a' }, { id: 'd5', start: 30.1, end: 30.933, text: 'b' }]
    const s = new ExtendedScheduler(two); s.tick(29.5)
    expect(s.tick(29.75).triggers.map((c) => c.id)).toEqual(['d4', 'd5'])
  })
  it(`a step of up to ${MAX_TICK_S} s is still playback (a late tick)`, () => {
    const s = new ExtendedScheduler(cues)
    s.tick(18.5); expect(s.tick(18.5 + MAX_TICK_S).triggers.map((c) => c.id)).toEqual(['d2'])
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
    const p = new ExtendedScheduler(cues); play(p, 19, 19.5)
    expect(p.tick(19.75).upcoming).toBeUndefined() // d2 fired 0.25 s early: not prefetched again while it speaks
    expect(s.tick(30).upcoming?.id).toBe('d3')
  })
})

/**
 * tears-of-steel-40-100 (clip time; scratchpad diagnosis 2026-10-19): extended d1 at 0.000 with dialogue at 0.05, extended d10
 * at 43.226 with the AD track's d11 at 43.376 (its voice at 43.589). Firing only at pos >= start let the film play past both.
 */
const TOS: ExtendedCue[] = [
  { id: 'd1', start: 0, end: 6.53, text: 'A man in a dark jacket gestures.' },
  { id: 'd3', start: 8.018, end: 9.5, text: 'x' },
  { id: 'd5', start: 17.272, end: 18.5, text: 'x' },
  { id: 'd10', start: 43.226, end: 48.166, text: 'Words appear: Dr Amstelwijk.' },
  { id: 'd14', start: 59.573, end: 61, text: 'x' },
]
describe('ExtendedScheduler: pause early, never late (decision 0019)', () => {
  it(`ToS d10 at 43.226: at every 4 Hz tick phase it fires before its start, at most ${EXTENDED_LEAD_S} s early, once`, () => {
    for (let phase = 0; phase < 0.25; phase += 0.01) {
      const s = new ExtendedScheduler(TOS)
      const fired = play(s, 40 + phase, 46).filter((t) => t.trigger)
      expect(fired.map((t) => t.trigger)).toEqual(['d10'])
      const at = fired[0]!.at
      expect(at).toBeLessThan(43.226); expect(43.226 - at).toBeLessThanOrEqual(EXTENDED_LEAD_S + 1e-9)
    }
  })
  it('a tick just short of the lead window says when to fire between ticks (armIn); that synthetic tick fires the cue', () => {
    const s = new ExtendedScheduler(TOS)
    s.tick(42.5); const r = s.tick(42.75) // 43.226 − 0.35 = 42.876: 0.126 s after this tick
    expect(r.triggers).toEqual([])
    expect(r.armIn).toBeCloseTo(43.226 - EXTENDED_LEAD_S - 42.75, 6)
    expect(s.tick(42.75 + r.armIn!).triggers.map((c) => c.id)).toEqual(['d10'])
    expect(s.tick(43).triggers).toEqual([]) // the real tick after the timer: already fired
    expect(s.tick(43.25).armIn).toBeUndefined()
  })
  it(`armIn only within ARM_WINDOW_S (${ARM_WINDOW_S} s), and never for a cue already fired`, () => {
    const s = new ExtendedScheduler(TOS)
    s.tick(42); expect(s.tick(42.25).armIn).toBeUndefined() // 0.626 s off
    expect(s.tick(42.5).armIn).toBeCloseTo(0.376, 6)
  })
  it('a seek to just before a cue still fires it on the next tick; a seek onto or past it does not', () => {
    const s = new ExtendedScheduler(TOS)
    s.tick(30); s.seeked()
    expect(s.tick(43.1).triggers).toEqual([]) // baseline
    expect(s.tick(43.2).triggers.map((c) => c.id)).toEqual(['d10'])
    s.seeked(); s.tick(43.226)
    expect(play(s, 43.476, 50).some((t) => t.trigger)).toBe(false)
    s.seeked(); s.tick(40) // back before it: playing over it again fires it again
    expect(play(s, 40.25, 44).filter((t) => t.trigger).map((t) => t.trigger)).toEqual(['d10'])
  })
  it('a jittery backward tick inside the lead window does not fire it twice', () => {
    const s = new ExtendedScheduler(TOS)
    s.tick(42.75); expect(s.tick(43).triggers.map((c) => c.id)).toEqual(['d10'])
    expect(s.tick(42.9).triggers).toEqual([]); expect(s.tick(43.1).triggers).toEqual([])
  })
  it('ToS d1 at 0.000: begin(0) fires it on the tick at 0 (the Player speaks it before the first play())', () => {
    const s = new ExtendedScheduler(TOS); s.begin(0)
    expect(s.tick(0).triggers.map((c) => c.id)).toEqual(['d1'])
    expect(s.tick(0.25).triggers).toEqual([])
  })
})
