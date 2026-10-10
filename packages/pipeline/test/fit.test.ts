import { readFileSync } from 'node:fs'
import { capExtended, EXTENDED_WORDS, fit, textClauses, introducesNew, LATE_MS, preservesFacts, safeShorten, shortenDeterministic, WPS } from '../src/steps/05-fit'
import type { Described } from '../src/steps/04-describe'
import { mezzanineArgs } from '../src/steps/01-probe'
import { shotsFromCuts, sceneFilter } from '../src/steps/02-shots'
import { gapsFromWords, wordsFromTranscribe } from '../src/steps/03-speech'
import { segment, wrap } from '../src/steps/08-text'
import { buildMixArgs, buildLoudnormMeasureArgs, buildLoudnormApplyArgs, parseLoudnorm } from '../src/steps/07-mix'
import { buildPackagerArgs } from '../src/steps/09-package'
import { wordBudget, stripFence } from '../src/prompts'

const shorten = (t: string, n: number) => t.split(' ').slice(0, n).join(' ')

describe('shots', () => {
  it('merges short shots and splits long ones into equal parts', () => {
    const s = shotsFromCuts([1000, 1800, 20000], 30000)
    const even = (a: number, b: number, n: number) => Array.from({ length: n }, (_, k) => [Math.round(a + (k * (b - a)) / n), Math.round(a + ((k + 1) * (b - a)) / n)])
    expect(s.map((x) => [x.startMs, x.endMs])).toEqual([[0, 1800], ...even(1800, 20000, 3), ...even(20000, 30000, 2)])
  })
  // sintel-90-150: 11208→44042 was 4 × 8000 + an 834 ms tail (shot 6).
  it('never emits a shot shorter than minMs when splitting', () => {
    const s = shotsFromCuts([11208, 44042], 60000)
    for (const x of s) { expect(x.endMs - x.startMs).toBeGreaterThanOrEqual(1500); expect(x.endMs - x.startMs).toBeLessThanOrEqual(8000) }
    expect(s.at(-1)!.endMs).toBe(60000)
  })
  it('builds the scene filter with threshold 0.1', () => {
    expect(sceneFilter()).toContain('gt(scene,0.1)')
  })
})
describe('probe', () => {
  const pair = (args: string[], k: string) => args[args.indexOf(k) + 1]
  it('fits the mezzanine inside 1920x1080 without upscaling and encodes High Profile Level 4.0', () => {
    const args = mezzanineArgs('work/x', 24)
    expect(pair(args, '-vf')).toBe("scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2")
    for (const [k, v] of [['-profile:v', 'high'], ['-level:v', '4.0'], ['-maxrate', '16M'], ['-bufsize', '24M'], ['-force_key_frames', 'expr:gte(t,n_forced*4)'], ['-sc_threshold', '0']] as const) expect(pair(args, k)).toBe(v)
    expect(args.at(-1)).toBe('work/x/mezz.mp4')
  })
  it('maps only the first video and first audio stream and drops subtitle and data streams', () => {
    const args = mezzanineArgs('work/x', 24)
    expect(args.slice(0, 9)).toEqual(['-y', '-i', 'work/x/source.mp4', '-map', '0:v:0', '-map', '0:a:0', '-sn', '-dn'])
  })
  it('caps frame rate at 30 for sources above 30 fps so Level 4.0 holds', () => {
    expect(pair(mezzanineArgs('work/x', 60), '-vf')).toMatch(/,fps=30$/)
    expect(pair(mezzanineArgs('work/x', 25), '-vf')).not.toContain('fps=')
    expect(pair(mezzanineArgs('work/x', 0), '-vf')).toMatch(/,fps=30$/) // unknown rate: cap conservatively
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
    const cues = await fit([{ index: 0, startMs: 0, endMs: 4000, description: 'A woman in a red coat crosses a bridge.', sameAsPrev: false, tokens: 0, outputTokens: 0 }], gaps, shorten)
    expect(cues).toHaveLength(1)
    expect(cues[0]!.startMs).toBe(0)
    expect(cues[0]!.endMs).toBeLessThanOrEqual(3000)
    expect(cues[0]!.extended).toBe(false)
  })
  it('shortens to fit', async () => {
    const long = 'Night. A rooftop. A tall man in an olive coat and a burgundy scarf leans over the railing and looks down at the empty street below.'
    const cues = await fit([{ index: 0, startMs: 8000, endMs: 12000, description: long, sameAsPrev: false, tokens: 0, outputTokens: 0 }], gaps, shorten)
    expect(cues[0]!.wordCount).toBeLessThanOrEqual(4) // 1.5 s gap → 4 words
  })
  it('marks extended when there is no gap and the shot introduces new information', async () => {
    const cues = await fit([{ index: 0, startMs: 20000, endMs: 24000, description: 'Words appear: Berlin, 1989.', sameAsPrev: false, tokens: 0, outputTokens: 0 }], gaps, shorten)
    expect(cues[0]).toMatchObject({ extended: true, startMs: 20000 })
  })
  it('skips SAME shots', async () => {
    expect(await fit([{ index: 0, startMs: 0, endMs: 1000, description: '', sameAsPrev: true, tokens: 0, outputTokens: 0 }], gaps, shorten)).toEqual([])
  })
  // sintel-90-150 gaps and shots (Gate C plan D1).
  const shot = (index: number, startMs: number, endMs: number, description: string): Described => ({ index, startMs, endMs, description, sameAsPrev: false, tokens: 0, outputTokens: 0 })
  it('places later shots inside a long opening gap after the cursor, not in the next gap', async () => {
    const cues = await fit([
      shot(0, 0, 8000, 'Words appear: SINTEL. A person stands in the snow, holding a sword.'),
      shot(1, 8000, 11208, 'Large white snowy rock.'),
      shot(2, 11208, 19208, 'A person stands by a fire.'),
    ], [{ startMs: 0, endMs: 16720 }, { startMs: 19509, endMs: 21209 }], shorten)
    expect(cues.map((c) => c.startMs).slice(0, 2)).toEqual([0, 8000])
    expect(cues[2]!.startMs).toBeGreaterThanOrEqual(11208)
    expect(cues[2]!.startMs).toBeLessThanOrEqual(16720)
    expect(cues.some((c) => c.startMs === 19509)).toBe(false)
  })
  it('tries the next gap inside the shot window when the first candidate is too small', async () => {
    const cues = await fit([shot(4, 27208, 35208, 'Woman drinks from bowl.')], [{ startMs: 24269, endMs: 27470 }, { startMs: 33170, endMs: 34820 }], shorten)
    expect(cues.map((c) => c.startMs)).toEqual([33170])
  })
  it('never voices a description more than 1 s after its shot ends', async () => {
    const late = [{ startMs: 19509, endMs: 21209 }]
    expect(LATE_MS).toBe(1000)
    expect(await fit([shot(1, 8000, 11208, 'Large white snowy rock.')], late, shorten)).toEqual([])
    expect(await fit([shot(1, 8000, 11208, 'Words appear: X')], late, shorten)).toEqual([expect.objectContaining({ extended: true, startMs: 8000 })])
  })
  it('keeps the 150 ms cursor spacing and sorts by start', async () => {
    const cues = await fit([shot(0, 0, 1000, 'Snow falls on the hills.'), shot(1, 1000, 3000, 'Smoke rises from the chimney.')], [{ startMs: 0, endMs: 10000 }], shorten)
    expect(cues.map((c) => c.shotIndex)).toEqual([0, 1])
    expect(cues[1]!.startMs).toBeGreaterThanOrEqual(cues[0]!.endMs + 150)
  })
  it('sintel-90-150 replay: every non-extended cue starts within its shot window', async () => {
    const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/sintel-90-150.${n}.json`, import.meta.url), 'utf8'))
    const described = fx('described') as Described[]
    const cues = await fit(described, fx('gaps'), shorten)
    const placed = cues.filter((c) => !c.extended)
    expect(placed.length).toBeGreaterThan(0)
    for (const c of placed) { const s = described.find((d) => d.index === c.shotIndex)!; expect(c.startMs).toBeGreaterThanOrEqual(s.startMs); expect(c.startMs).toBeLessThanOrEqual(s.endMs + LATE_MS) }
    // planner's fit-replay (Gate C plan D1): first placed cue per shot
    const first = (i: number) => placed.find((c) => c.shotIndex === i)?.startMs
    expect([0, 1, 2, 3, 4, 8, 9].map(first)).toEqual([0, 8000, 12575, 19509, 33170, 50869, 56125])
  })
  it('allows a start exactly LATE_MS after the shot ends', async () => {
    expect((await fit([shot(0, 0, 1000, 'Snow falls on the hills.')], [{ startMs: 2000, endMs: 5000 }], shorten)).map((c) => c.startMs)).toEqual([2000])
  })
  it('no gaps at all: new information becomes extended, the rest is dropped', async () => {
    const cues = await fit([shot(0, 0, 4000, 'Night. A rooftop.'), shot(1, 4000, 8000, 'Snow falls.'), shot(2, 8000, 9000, 'Words appear: North.')], [], shorten)
    expect(cues.map((c) => [c.shotIndex, c.startMs, c.extended])).toEqual([[0, 0, true], [2, 8000, true]])
  })
  it('overlapping shots compete for one gap: the second gets only what the first left', async () => {
    const cues = await fit([shot(0, 0, 2000, 'Snow falls on hills.'), shot(1, 500, 2500, 'Smoke rises from chimney.')], [{ startMs: 0, endMs: 3000 }], shorten)
    expect(cues).toEqual([expect.objectContaining({ shotIndex: 0, startMs: 0, extended: false })]) // 1950 → 3000 is 2 words: dropped, not new
  })
  it('long dialogue across several shots: new information extended, plain action dropped, the next shot placed after the dialogue', async () => {
    const cues = await fit([shot(0, 2000, 6000, 'A woman enters the room.'), shot(1, 6000, 10000, 'She sits.'), shot(2, 15000, 19500, 'He nods slowly.')], [{ startMs: 0, endMs: 1000 }, { startMs: 20000, endMs: 25000 }], shorten)
    expect(cues.map((c) => [c.shotIndex, c.startMs, c.extended])).toEqual([[0, 2000, true], [2, 20000, false]])
  })
  it('places a shot that starts inside a gap at the shot start, never before the action', async () => {
    expect((await fit([shot(0, 4000, 6000, 'A kettle boils.')], [{ startMs: 0, endMs: 10000 }], shorten)).map((c) => c.startMs)).toEqual([4000])
  })
  it('caps extended cues at 25 words', async () => {
    const long = `Words appear: North. ${'snow '.repeat(30).trim()}.`
    const [c] = await fit([shot(0, 0, 4000, long)], [], shorten)
    expect(c).toMatchObject({ extended: true, wordCount: EXTENDED_WORDS })
  })
  it('fit sets limitMs to the gap end for placed cues', async () => {
    const cues = await fit([shot(0, 0, 1000, 'Snow falls on the hills.'), shot(1, 1000, 3000, 'Smoke rises from the chimney.'), shot(2, 20000, 22000, 'Words appear: North.')], [{ startMs: 0, endMs: 10000 }, { startMs: 12000, endMs: 13500 }], shorten)
    expect(cues.map((c) => [c.shotIndex, c.extended, c.limitMs])).toEqual([[0, false, 10000], [1, false, 10000], [2, true, undefined]])
    expect(cues[2]).not.toHaveProperty('limitMs')
  })
  it('capExtended cuts at a clause boundary', async () => {
    const same = (t: string) => t // the shortener fails: returns the text unchanged
    // 18th word "railing," is the last clause end within the first 25 words; 18 ≥ 8 words, so the cut is there.
    const long = 'Night. A rooftop. A tall man in an olive coat and a burgundy scarf leans over the railing, looks down at the empty street below and then turns to face the old wooden door.'
    const [c] = await fit([shot(0, 0, 4000, long)], [], same)
    expect(c).toMatchObject({ extended: true, text: 'Night. A rooftop. A tall man in an olive coat and a burgundy scarf leans over the railing.', wordCount: 18 })
    // Only "North." (3 words) ends a clause in the first 25: fewer than 8 words, so the cut stays at 25 words.
    const [d] = await fit([shot(0, 0, 4000, `Words appear: North. ${'snow '.repeat(30).trim()}.`)], [], same)
    expect(d).toMatchObject({ extended: true, text: `Words appear: North. ${'snow '.repeat(22).trim()}`, wordCount: EXTENDED_WORDS })
  })
  it('rejects a shortening that changes a fact and places the deterministic one', async () => {
    const model = vi.fn(() => 'Dragon spreads bloodied wings, roars.')
    const cues = await fit([shot(26, 0, 3000, 'The dragon spreads its bloodied wing, then roars.')], [{ startMs: 0, endMs: 2300 }], (t, n) => safeShorten(t, n, model))
    expect(model).toHaveBeenCalledWith('The dragon spreads its bloodied wing, then roars.', 6)
    expect(cues.map((c) => c.text)).toEqual(['The dragon spreads its bloodied wing.'])
  })
})
describe('shortening', () => {
  // Gate C confirmation run, shot 26: Qwen wrote "wing", the Nova Lite shortener voiced "bloodied wings".
  it('accepts only shortenings whose content words all appear in the original', () => {
    expect(preservesFacts('A dragon with a bloodied wing lands.', 'Dragon with bloodied wings lands.')).toBe(false)
    expect(preservesFacts('A dragon with a bloodied wing lands.', 'Dragon, bloodied wing, lands.')).toBe(true)
    expect(preservesFacts('Woman holds bowl.', 'The woman holds the bowl.')).toBe(true) // stopwords may be added
    expect(preservesFacts('Woman holds bowl.', 'Woman holds cup.')).toBe(false)
  })
  it('rejects dropped negations, swapped roles and added pronouns', () => {
    expect(preservesFacts('The girl does not open the door.', 'Girl opens door.')).toBe(false)
    expect(preservesFacts('A man walks away without his sword.', 'Man walks away with sword.')).toBe(false)
    expect(preservesFacts('Nobody answers the door.', 'Answers door.')).toBe(false)
    expect(preservesFacts('The girl does not open the door.', 'Girl does not open door.')).toBe(true)
    expect(preservesFacts('The dragon chases the girl.', 'The girl chases the dragon.')).toBe(false)
    expect(preservesFacts('A woman hands a man a cup.', 'A man hands a woman a cup.')).toBe(false)
    expect(preservesFacts('A woman hands a man a cup.', 'Woman hands man cup.')).toBe(true)
    expect(preservesFacts('A woman hands a man a cup.', 'Woman hands him cup.')).toBe(false)
    expect(preservesFacts('A woman lifts a cup.', 'She lifts cup.')).toBe(false)
  })
  it('lets a shortening add only a/an/the/and: no direction words', () => {
    expect(preservesFacts('A girl runs from the dragon.', 'Girl runs to dragon.')).toBe(false)
    expect(preservesFacts('A girl runs from the dragon.', 'Girl runs from dragon.')).toBe(true)
    expect(preservesFacts('Girl runs. Dragon follows.', 'The girl runs and the dragon follows.')).toBe(true)
    expect(preservesFacts('Woman holds bowl.', 'Woman holds bowl in hand.')).toBe(false)
  })
  // Second review: the -ly rule ate "Emily" and "butterfly", and "giant" was dropped as an adjective.
  it('never drops names, nouns ending in -ly, or an adjective used as a noun', () => {
    expect(shortenDeterministic('Emily slowly opens the heavy wooden door.', 5)).toBe('Emily opens the door.')
    expect(shortenDeterministic('A butterfly lands on a large leaf.', 6)).toBe('A butterfly lands on a leaf.')
    expect(shortenDeterministic('A giant walks across the old bridge.', 6)).toBe('A giant walks across the bridge.')
    expect(shortenDeterministic('The old walks past the young man.', 6)).toBe('The old walks past the man.')
    expect(shortenDeterministic('Sintel meets Old Tom in a small hut.', 7)).toBe('Sintel meets Old Tom in a hut.')
    expect(shortenDeterministic('A man nearly falls.', 3)).toBe('A man nearly falls.') // facts-bearing adverbs stay
  })
  it('falls back to deterministic shortening when the model changes a fact or does not fit', async () => {
    expect(await safeShorten('A dragon with a bloodied wing lands, then roars.', 7, () => 'Dragon with bloodied wings lands.')).toBe('A dragon with a bloodied wing lands.')
    expect(await safeShorten('A dragon with a bloodied wing lands, then roars.', 7, () => 'Dragon with bloodied wing lands.')).toBe('Dragon with bloodied wing lands.')
    expect(await safeShorten('A dragon with a bloodied wing lands, then roars.', 3, () => 'Dragon with bloodied wing lands.')).toBe('A dragon with a bloodied wing lands.') // still too long; fit() moves on
  })
  it('drops adjectives first, then clauses from the end, and only ever removes words', () => {
    expect(shortenDeterministic('A large white rock formation with snow on top and sides.', 10)).toBe('A white rock formation with snow on top and sides.')
    expect(shortenDeterministic('A large white rock formation with snow on top and sides.', 8)).toBe('A white rock formation with snow on top.')
    expect(shortenDeterministic('Large white snowy rock.', 2)).toBe('White rock.')
    expect(shortenDeterministic('The dragon slowly spreads its wing, then roars.', 6)).toBe('The dragon spreads its wing.')
    expect(shortenDeterministic('The sky is dark and the wind is cold.', 4)).toBe('The sky is dark.')
    expect(shortenDeterministic('Snow falls.', 4)).toBe('Snow falls.')
    for (const t of ['Night. A rooftop. A tall man in an olive coat leans over the railing and looks down at the empty street.', 'A woman in a red coat, holding a lantern, crosses the bridge.']) {
      for (const n of [3, 5, 8, 12]) expect(preservesFacts(t, shortenDeterministic(t, n))).toBe(true)
    }
  })
  it('flags new characters, locations and on-screen text as new information', () => {
    for (const t of ['Words appear: North.', 'Night. A rooftop.', 'A woman enters.']) expect(introducesNew(t)).toBe(true)
    for (const t of ['She sits.', 'Snow falls on the hills.']) expect(introducesNew(t)).toBe(false)
  })
})
// DESC-017, sintel-90-150-r2 cues 0 and 1: "… Words appear: SINTEL." was voiced without "Words appear: SINTEL." (06-voice's overrun shortening).
describe('on-screen text clause', () => {
  const SHOT0 = 'Snowy mountains. A lone figure walks left, carrying a spear. Words appear: SINTEL.'
  it('shortening never removes the on-screen text clause', async () => {
    expect(shortenDeterministic(SHOT0, 11)).toBe('Snowy mountains. A lone figure walks left. Words appear: SINTEL.')
    expect(shortenDeterministic(SHOT0, 6)).toBe('Snowy mountains. Words appear: SINTEL.')
    expect(shortenDeterministic('Words appear: "Berlin, 1989." A tall man slowly crosses the old bridge.', 9)).toBe('Words appear: "Berlin, 1989." A man crosses the bridge.')
    // the model shortener never sees the clause; its reply is checked against the rest, then the clause is put back
    const model = vi.fn(() => 'Snowy mountains. Lone figure walks left.') // r2's recorded shortening, minus the text it dropped
    expect(await safeShorten(SHOT0, 10, model)).toBe('Snowy mountains. Lone figure walks left. Words appear: SINTEL.')
    expect(model).toHaveBeenCalledWith('Snowy mountains. A lone figure walks left, carrying a spear.', 7)
    // a model reply that drops or rewrites the text is impossible: it only shortens the rest
    expect(await safeShorten(SHOT0, 10, () => 'Snowy mountains.')).toBe('Snowy mountains. Words appear: SINTEL.')
    expect(await safeShorten(SHOT0, 4, () => 'Mountains.')).toBe('Mountains. Words appear: SINTEL.')
    // no room for the action beside the text: the text comes back whole, and fit / 06-voice split it
    expect(shortenDeterministic(SHOT0, 3)).toBe(SHOT0)
    expect(await safeShorten(SHOT0, 3, () => '')).toBe(SHOT0)
    // capExtended's word cut (a failing shortener) keeps the clause too, with a sentence end before it
    const long = `${'Snow falls on the hills, '.repeat(6).trim()} Words appear: SINTEL.`
    expect((await capExtended(long, (t) => t)).text).toMatch(/hills\. Words appear: SINTEL\.$/)
    expect((await capExtended(long, (t) => t)).wordCount).toBeLessThanOrEqual(EXTENDED_WORDS)
    expect((await capExtended(`${'snow '.repeat(30).trim()} Words appear: SINTEL.`, (t) => t)).text).toBe(`${'snow '.repeat(22).trim()}. Words appear: SINTEL.`)
  })
  // PR #25 review M1, M2
  it('reads bare on-screen text up to its sentence end, not to a period inside it', () => {
    const clause = (t: string) => textClauses(t)?.clause
    expect(clause('Words appear: DR. NO. A man runs.')).toBe('Words appear: DR. NO.')
    expect(clause('Snow. Words appear: Mr. Smith. A man runs.')).toBe('Words appear: Mr. Smith.')
    expect(clause('Words appear: 3.14. Snow.')).toBe('Words appear: 3.14.')
    expect(clause('Words appear: U.S.A. A flag waves.')).toBe('Words appear: U.S.A.')
    expect(clause('Words appear: SINTEL. A figure walks.')).toBe('Words appear: SINTEL.')
    expect(textClauses('Snow falls. Words appear: SINTEL.')).toMatchObject({ lead: '', rest: 'Snow falls.' })
    // an unclosed quote runs to the end and is still protected
    const open = 'Snow falls slowly on the old hills. Words appear: "EXIT'
    expect(clause(open)).toBe('Words appear: "EXIT')
    expect(shortenDeterministic(open, 9)).toBe('Snow falls on the old hills. Words appear: "EXIT')
  })
  it('reads German labels and quotes in the shorteners and introducesNew (de)', () => {
    expect(textClauses('Text erscheint: „Kapitel 1. Der Anfang“. Schnee fällt.')).toMatchObject({ lead: 'Text erscheint: „Kapitel 1. Der Anfang“.', rest: 'Schnee fällt.' })
    expect(textClauses('Schnee. Schrift erscheint: «SINTEL».')?.clause).toBe('Schrift erscheint: «SINTEL».')
    expect(textClauses('Schnee. Wörter erscheinen: »ENDE«.')?.clause).toBe('Wörter erscheinen: »ENDE«.')
    expect(shortenDeterministic('Eine Frau läuft langsam über die alte Brücke. Text erscheint: „BERLIN“.', 6)).toMatch(/Text erscheint: „BERLIN“\.$/)
    for (const t of ['Text erscheint: SINTEL.', 'Wörter erscheinen: ENDE.', 'Schrift erscheint: «NORD».']) expect(introducesNew(t)).toBe(true)
  })
  // Human decision 2026-10-10 (M4): split, never drop either.
  it('on-screen text that does not fit becomes its own extended cue and the action stays on the AD track', async () => {
    const shot = (description: string, index = 0, startMs = 0): Described => ({ index, startMs, endMs: startMs + 2000, description, sameAsPrev: false, tokens: 0, outputTokens: 0 })
    const TEXT = 'A girl runs. Words appear: "The Hunt for the Dragon".' // a 7-word text clause, 3 words of room
    expect(shortenDeterministic(TEXT, 3)).toBe(TEXT) // nothing to remove: fit() decides
    const cues = await fit([shot(TEXT)], [{ startMs: 0, endMs: 1300 }], (t, n) => safeShorten(t, n, () => 'Girl runs.'))
    expect(cues).toEqual([
      { startMs: 0, endMs: 100, text: 'Words appear: "The Hunt for the Dragon".', extended: true, wordCount: 7, shotIndex: 0 },
      expect.objectContaining({ startMs: 0, text: 'A girl runs.', extended: false, limitMs: 1300 }),
    ])
    // the text fits but not beside any of the action: still split, the action shortened
    const two = await fit([shot(SHOT0), shot('Smoke rises.', 1, 3000)], [{ startMs: 0, endMs: 1500 }, { startMs: 3000, endMs: 6000 }], (t, n) => safeShorten(t, n, () => 'Mountains walk.'))
    expect(two.map((c) => [c.startMs, c.extended, c.text])).toEqual([[0, true, 'Words appear: SINTEL.'], [0, false, 'Snowy mountains.'], [3000, false, 'Smoke rises.']])
  })
})

describe('word budget', () => {
  it('8 words for a 3 s gap, min 4, extended 25', () => {
    expect(wordBudget({ index: 0, startMs: 0, endMs: 3000 }, [{ startMs: 0, endMs: 3000 }])).toBe(8)
    expect(wordBudget({ index: 0, startMs: 0, endMs: 1000 }, [{ startMs: 0, endMs: 500 }])).toBe(4)
    expect(wordBudget({ index: 0, startMs: 5000, endMs: 6000 }, [{ startMs: 0, endMs: 3000 }])).toBe(25)
  })
  it('uses the largest gap inside the shot window', () => {
    expect(wordBudget({ index: 4, startMs: 27208, endMs: 35208 }, [{ startMs: 24269, endMs: 27470 }, { startMs: 33170, endMs: 34820 }])).toBe(Math.floor(1.65 * WPS))
  })
  it('floors at 4 and returns 25 when no gap overlaps the window', () => {
    expect(wordBudget({ index: 0, startMs: 8000, endMs: 11208 }, [{ startMs: 8000, endMs: 8200 }])).toBe(4)
    expect(wordBudget({ index: 0, startMs: 8000, endMs: 11208 }, [{ startMs: 0, endMs: 7000 }, { startMs: 12208, endMs: 19000 }])).toBe(25)
  })
})
describe('captions', () => {
  it('segments at sentence ends and wraps to 2 × 42', () => {
    const words = 'I told you to wait. Twice. Now we are late for the train and it is raining again outside'.split(' ').map((t, i) => ({ start: i * 0.4, end: i * 0.4 + 0.3, text: t }))
    const cues = segment(words)
    expect(cues[0]!.text).toBe('I told you to wait.')
    for (const c of cues) { expect(c.text.split('\n').length).toBeLessThanOrEqual(2); for (const l of c.text.split('\n')) expect(l.length).toBeLessThanOrEqual(42) }
  })
  it('wrap respects limits', () => { expect(wrap('a '.repeat(40).trim(), 42, 2).split('\n').length).toBe(2) })
  it('wrap throws rather than drop text that needs more than maxLines lines', () => {
    expect(() => wrap('a '.repeat(50).trim(), 42, 2)).toThrow(/3 lines/)
  })
  const asTranscribe = (text: string) => wordsFromTranscribe({ results: { items: text.split(' ').map((w, i) => ({ type: 'pronunciation', start_time: String(i * 0.4), end_time: String(i * 0.4 + 0.3), alternatives: [{ content: w }] })) } })
  const checkCues = (cues: ReturnType<typeof segment>, maxLines = 2, maxChars = 42) => {
    for (const c of cues) { const lines = c.text.split('\n'); expect(lines.length).toBeLessThanOrEqual(maxLines); for (const l of lines) expect(l.length).toBeLessThanOrEqual(maxChars) }
  }
  it('keeps every word of a German line whose long compounds need three greedy lines', () => {
    const text = 'Selbstverständlich Bundesverfassungsgericht Entscheidungen Verantwortungsbewusstsein'
    const cues = segment(asTranscribe(text))
    expect(cues.map((c) => c.text.replace(/\n/g, ' ')).join(' ')).toBe(text)
    checkCues(cues)
  })
  it('keeps every word when a long English word lands on the line break', () => {
    const text = 'The minister said the agreement was fundamentally incomprehensible to all of them'
    const cues = segment(asTranscribe(text))
    expect(cues.map((c) => c.text.replace(/\n/g, ' ')).join(' ')).toBe(text)
    checkCues(cues)
  })
  it('never loses a word and never exceeds maxLines over 300 seeded random word sequences', () => {
    let seed = 0x5eed
    const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!
    for (let run = 0; run < 300; run++) {
      const n = 1 + Math.floor(rnd() * 40)
      const words = Array.from({ length: n }, (_, i) => {
        const len = rnd() < 0.15 ? 12 + Math.floor(rnd() * 14) : 1 + Math.floor(rnd() * 9)
        const text = Array.from({ length: len }, () => pick([...'abcdefghijklmnopqrstuvwxyzäöüß'])).join('') + (rnd() < 0.2 ? pick([',', ';', ':', '.', '!', '?']) : '')
        return { start: i * 0.3, end: i * 0.3 + 0.25, text, ...(rnd() < 0.5 ? { speaker: pick(['spk_0', 'spk_1']) } : {}) }
      })
      const cues = segment(words)
      expect(cues.map((c) => c.text.replace(/\n/g, ' ')).join(' ')).toBe(words.map((w) => w.text).join(' '))
      checkCues(cues)
    }
  })
  it('attaches Transcribe punctuation to the preceding word', () => {
    const item = (type: string, content: string, t?: number) => ({ type, alternatives: [{ content }], ...(t === undefined ? {} : { start_time: String(t), end_time: String(t + 0.2) }) })
    expect(wordsFromTranscribe({ results: { items: [item('pronunciation', 'past', 1), item('punctuation', '.'), item('pronunciation', 'It', 2)] } }).map((w) => w.text)).toEqual(['past.', 'It'])
  })
  it('segments the Sintel transcript at sentence ends', () => {
    const t = JSON.parse(readFileSync(new URL('./fixtures/sintel-90-150.transcript.json', import.meta.url), 'utf8'))
    expect(segment(wordsFromTranscribe(t)).slice(0, 3).map((c) => c.text)).toEqual(['This blade has a dark past.', 'It has shed much innocent blood.', "You're a fool for traveling alone,\nso completely unprepared."])
  })
  it('never drops words when a short clause opener precedes a long unpunctuated run', () => {
    const text = 'No, this blade has shed much innocent blood over the years and it will keep on shedding blood until somebody extraordinarily brave stops it.'
    const cues = segment(text.split(' ').map((t, i) => ({ start: i * 0.25, end: i * 0.25 + 0.2, text: t })))
    expect(cues.map((c) => c.text.replace(/\n/g, ' ')).join(' ')).toBe(text)
    for (let i = 1; i < cues.length; i++) expect(cues[i - 1]!.end).toBeLessThanOrEqual(cues[i]!.start)
  })
  it('breaks an overlong sentence at the last clause boundary, not mid-phrase', () => {
    const text = 'Twelve riders crossed the frozen river at dawn, then the scouts rode on north past the mill and the old stone bridge.'
    expect(text.indexOf(',')).toBeGreaterThan(40)
    const words = text.split(' ').map((t, i) => ({ start: i * 0.25, end: i * 0.25 + 0.2, text: t }))
    const cues = segment(words)
    expect(cues[0]!.text.endsWith(',')).toBe(true)
    expect(cues.map((c) => c.text.replace(/\n/g, ' ')).join(' ')).toBe(text)
  })
})
describe('mix', () => {
  const cue = { i: 0, startMs: 1000, endMs: 3000, text: 'x', extended: false, wordCount: 1, shotIndex: 0 }
  it('builds a constant −9 dB sidechain duck that terminates at the film duration', () => {
    const args = buildMixArgs('work/x', [cue], 60)
    const f = args[args.indexOf('-filter_complex') + 1]!
    expect(f).toContain('adelay=1000|1000')
    expect(f).toContain('aformat=sample_rates=48000:channel_layouts=stereo')
    expect(f).toContain('apad=whole_dur=60.000')
    expect(f).toContain("aevalsrc=exprs='between(t,1,3)|between(t,1,3)':s=48000:c=stereo:d=60.000[sc]")
    expect(f).toContain('[0:a][sc]sidechaincompress=threshold=0.25:ratio=4:attack=10:release=300:knee=1:detection=peak:makeup=1[ducked]')
    expect(f).toContain('[ducked][narr]amix=inputs=2:duration=first:normalize=0[out]')
    expect(f).not.toContain('loudnorm') // two-pass loudnorm is its own invocation
    expect(args.slice(-3)).toEqual(['-t', '60.000', 'work/x/premix.wav'])
  })
  it('sums the envelope over several cues and pads a silent narration when there are none', () => {
    const f = buildMixArgs('work/x', [cue, { ...cue, i: 2, startMs: 5000, endMs: 8500 }], 20).find((a) => a.includes('aevalsrc'))!
    expect(f).toContain("exprs='between(t,1,3)+between(t,5,8.5)|between(t,1,3)+between(t,5,8.5)'")
    expect(f).toContain('[n0][n1]amix=inputs=2:duration=first:normalize=0')
    const none = buildMixArgs('work/x', [], 20).find((a) => a.includes('aevalsrc'))!
    expect(none).toContain("exprs='0|0'")
    expect(none).toContain('anullsrc=r=48000:cl=stereo:d=20.000[narr]')
  })
  it('measures then applies loudnorm linearly with the measured values', () => {
    const measure = buildLoudnormMeasureArgs('work/x')
    expect(measure).toContain('loudnorm=I=-24:TP=-2:LRA=11:print_format=json')
    expect(measure.slice(-2)).toEqual(['null', '-'])
    const m = parseLoudnorm('[Parsed_loudnorm_0 @ 0x1] \n{\n\t"input_i" : "-27.21",\n\t"input_tp" : "-6.13",\n\t"input_lra" : "13.40",\n\t"input_thresh" : "-37.50",\n\t"output_i" : "-24.00",\n\t"target_offset" : "0.10"\n}\n')
    expect(m).toEqual({ input_i: -27.21, input_tp: -6.13, input_lra: 13.4, input_thresh: -37.5 })
    const apply = buildLoudnormApplyArgs('work/x', m)
    const af = apply[apply.indexOf('-af') + 1]!
    expect(af).toContain('loudnorm=I=-24:TP=-2:LRA=14:measured_I=-27.21:measured_TP=-6.13:measured_LRA=13.4:measured_thresh=-37.5:linear=true')
    expect(af).toContain('aresample=48000')
    expect(apply).toEqual(expect.arrayContaining(['-ar', '48000', '-ac', '2']))
    expect(apply.at(-1)).toBe('work/x/audio_ad.m4a')
    expect(buildLoudnormApplyArgs('work/x', { ...m, input_lra: 4 })[4]).toContain(':LRA=11:') // never below the −24 LUFS target's LRA
    expect(() => parseLoudnorm('no json here')).toThrow(/loudnorm/)
  })
})
describe('package', () => {
  it('signals the AD rendition and uses real spaces and ;-separated characteristics', () => {
    const args = buildPackagerArgs('en', true, true, true)
    const ad = args.find((a) => a.includes('in=audio_ad.m4a'))!
    expect(ad).toContain('hls_characteristics=public.accessibility.describes-video')
    expect(ad).toContain('hls_name=Audio description')
    expect(ad).toContain('roles=description')
    expect(args.join('\n')).not.toContain('%20')
    for (const a of args) for (const m of a.matchAll(/hls_characteristics=([^,]+)/g)) expect(m[1]).not.toContain(',')
    expect(args.find((a) => a.includes('in=sdh.vtt'))).toContain('hls_characteristics=public.accessibility.transcribes-spoken-dialog;public.accessibility.describes-music-and-sound')
    expect(args.filter((a) => a.includes('stream=text'))).toHaveLength(3)
    expect(args.slice(-4)).toEqual(['--segment_duration', '4', '--hls_master_playlist_output', 'hls/master.m3u8'])
    for (const a of args) expect(a).not.toMatch(/=\//) // relative paths only; packager runs with cwd = work dir
  })
  it('omits the caption tracks when there is no dialogue (Packager rejects zero-cue VTT)', () => {
    const text = buildPackagerArgs('de', false, false, true).filter((a) => a.includes('stream=text'))
    expect(text).toHaveLength(1)
    expect(text[0]).toContain('in=descriptions.vtt')
    expect(text[0]).toContain('language=de')
  })
  it('omits the SDH descriptor when the SDH step degraded to plain captions', () => {
    const args = buildPackagerArgs('en', true, false, true)
    expect(args.filter((a) => a.includes('stream=text')).map((a) => a.split(',')[0])).toEqual(['in=captions.vtt', 'in=descriptions.vtt'])
    expect(args.join('\n')).not.toContain('describes-music-and-sound')
  })
  it('omits the description text track when fit placed nothing', () => {
    const args = buildPackagerArgs('en', true, true, false)
    expect(args.filter((a) => a.includes('stream=text')).map((a) => a.split(',')[0])).toEqual(['in=captions.vtt', 'in=sdh.vtt'])
    expect(args.some((a) => a.includes('in=audio_ad.m4a'))).toBe(true)
  })
})
describe('prompts', () => {
  it('strips a ```json fence before parsing', () => {
    expect(JSON.parse(stripFence('```json\n{"cues":[]}\n```'))).toEqual({ cues: [] })
    expect(stripFence('{"cues":[]}')).toBe('{"cues":[]}')
  })
  it('strips a fence after leading prose and a trailing fence after a prefill', () => {
    expect(stripFence('Here is the JSON: ```json\n{"cues":[]}\n```')).toBe('{"cues":[]}')
    expect(stripFence('{"cues":[]}\n```')).toBe('{"cues":[]}')
    expect(stripFence('```json\n{"cues":[]}\n```\nHope this helps.')).toBe('{"cues":[]}')
  })
})
