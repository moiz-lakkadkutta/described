import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capEvents, fit, type FitCue } from '../src/steps/05-fit'
import { voice } from '../src/steps/06-voice'
import type { Described } from '../src/steps/04-describe'
import type { Ctx } from '../src/steps/index'
import { ACTION_VERBS, EVENT_SPACING_MS, eventSpaced, newWords, plotEvent, plotEvents } from '../src/plotEvent'
import { stem } from '../src/contentWords'

/**
 * DESC-020 (human-approved 2026-10-10): a shot with no room whose description carries a new plot event becomes an extended cue
 * (Extended mode only), at most one per 30 s. The shot texts are sintel-90-210 run A2's (test/fixtures/sintel-90-210.described.json);
 * the golden list of that run is in test/sintel-210.test.ts.
 */
const shot = (index: number, startMs: number, endMs: number, description: string): Described => ({ index, startMs, endMs, description, sameAsPrev: false, tokens: 0, outputTokens: 0 })
const same = (t: string) => t

describe('plot event test (deterministic)', () => {
  it('a new finite action verb the previous voiced cue did not say is a plot event', () => {
    expect(plotEvents('Red-haired girl accepts bowl.', 'Old man pours broth.')).toEqual(['accepts'])
    expect(plotEvents('Red-haired woman kneels beside bleeding creature on cobblestones.', 'Small dragon clutches bleeding wing on stone roof.')).toEqual(['kneels'])
    expect(plotEvents('The figure falls prone in the snow. The logo fades.', '')).toEqual(['falls'])
    expect(plotEvents('She turns, holding a spiky green fruit, then walks away.', 'The woman holds up a red apple.')).toEqual(['walks'])
    expect(plotEvents('Hand reaches toward small dragon on stone roof.', 'Red-haired woman stares.')).toEqual(['reaches'])
    expect(plotEvents('A dragon spreads its wing. The girl runs.', '')).toEqual(['spreads', 'runs'])
    expect(plotEvents('Red-haired woman kneels, then lifts the creature.', '')).toEqual(['kneels', 'lifts'])
  })
  it('an action the previous voiced cue already said is not new', () => {
    expect(plotEvent('Red-haired woman climbs brick rooftop.', 'Red-haired woman climbs stone steps.')).toBe(false)
    expect(plotEvent('The girl runs on.', 'A girl is running.')).toBe(false) // by stem
    expect(plotEvent('Red-haired woman climbs brick rooftop.', 'Red-haired woman stares.')).toBe(true)
  })
  it('setting, light, looks and expressions are not plot events', () => {
    for (const t of ['Tent glows.', 'Tent interior. Fire glows.', 'Dawn breaks over city.', 'Snow falls.', 'The logo appears.', 'Darkness. A fire pit glows faintly in a dim room.',
      'Red-haired woman opens eyes.', 'Red-haired woman in gray tank top stares.', 'Red-haired woman smiles. Scaly beast roars.', 'The woman with short red hair and a grey tank top blinks slowly, her expression unreadable in the dim, warm light.',
      'Red-haired girl holds book.', 'Two hands hold a reddish-brown bowl; a pale, veiled face slowly rises within its milky liquid.', 'Pink-haired woman in gray tank top stands near stone wall.', 'A figure leans forward, gripping a staff.',
      'A man lowers his head.', 'A tear falls.', 'Bearded man with red face paint speaks.', 'Words appear: SINTEL.']) expect(plotEvents(t, '')).toEqual([])
  })
  it('only the finite verb of a house-style line counts: what someone watches is not their act', () => {
    expect(plotEvents('Red-haired girl watches man stir pot over fire.', 'Bearded man holds staff.')).toEqual([])
    expect(plotEvents('Man stirs pot over fire.', 'Bearded man holds staff.')).toEqual(['stirs'])
    expect(plotEvents('Falls.', '')).toEqual([]) // no subject before it
    expect(plotEvents('Two hands hold a reddish-brown bowl; a pale, veiled face slowly rises within its milky liquid.', '')).toEqual([])
  })
  it('matches inflected finite forms through the stem: reaches, carries, dies, flies', () => {
    for (const w of ['accepts', 'reaches', 'carries', 'dies', 'flies', 'kneels', 'catches']) expect(ACTION_VERBS.has(stem(w))).toBe(true)
    for (const w of ['holds', 'stands', 'watches', 'stares', 'speaks', 'roars', 'glows', 'fades', 'steps', 'waves', 'blocks']) expect(ACTION_VERBS.has(stem(w))).toBe(false)
    expect(ACTION_VERBS.has(stem('hands'))).toBe(true) // only before her / him / a / the … (plotEvents)
  })
  // PR #29 review M2: the verb is the first -s word after the subject in each clause; plural nouns, -ss words, faces and flight over scenery
  it('table: reviewer lines', () => {
    const table: Array<[string, boolean]> = [
      ['Red-haired girl accepts bowl.', true],
      ['Red-haired woman kneels beside bleeding creature on cobblestones.', true],
      ['A man hands her a cup.', true], // (e) hands + her
      ['The old man hands over the sword.', true],
      ['Two hands hold a bowl.', false], // hands is the subject
      ['A man walks, hands in pockets.', true], // walks; "hands in pockets" is not a hand-over
      ['A woman in a red dress lifts a sword.', true], // (b) dress is not the verb; lifts is
      ['A man crosses the bridge.', true], // -es, not -ss
      ['The guard passes a lantern to the boy.', true],
      ['A man holds two drinks.', false], // (c) a later plural noun never counts
      ['The cook serves cuts of meat.', false], // serves not listed; cuts is a later noun
      ['A woman carries lights up the stairs.', true], // carries; "lights" is a later noun, never the verb
      ['A man signs the paper.', true],
      ['The clerk stamps the signs.', false], // stamps not listed
      ['A face appears in the bowl.', false], // (d)
      ['A veiled face emerges from the milk.', false],
      ['A reflection rises in the liquid.', false],
      ['A man with a scarred face draws a sword.', false], // the face rule is per sentence: a known cost
      ['A bird flies over the lake.', false], // (f) flight over scenery
      ['A dragon flies over the city.', true],
      ['A dragon swoops down and lands on the roof.', true], // lands
      ['Smoke drifts across the sky.', false], // setting subject
      ['A figure walks, falls.', true], // the second clause carries the subject over
      ['Dawn breaks over city.', false],
      ['Tent glows.', false],
      ['Red-haired girl watches man stir pot over fire.', false],
      ['She turns, holding a spiky green fruit, then walks away.', true], // walks, after "then"
      ['Across the room, a man draws his sword.', true], // across is not a verb
      ['His hands shake.', false],
      ['The figure falls prone in the snow. The logo fades.', true],
    ]
    for (const [line, yes] of table) expect([line, plotEvent(line, '')]).toEqual([line, yes])
    expect(plotEvents('A woman carries lights up the stairs.', '')).toEqual(['carries'])
    expect(plotEvents('A man drinks, then cuts the bread.', '')).toEqual(['drinks', 'cuts']) // one verb per clause, "then" starts a clause
    expect(plotEvents('A man holds two drinks.', '')).toEqual([])
  })
  it('counts the new content words for the tie-break and spaces event cues 30 s apart', () => {
    expect(newWords('Red-haired girl accepts bowl.', 'Old man pours broth.')).toBe(4)
    expect(newWords('Red-haired girl accepts bowl.', 'Red-haired girl holds bowl.')).toBe(1)
    expect(EVENT_SPACING_MS).toBe(30_000)
    expect(eventSpaced([10_000], 40_000)).toBe(true)
    expect(eventSpaced([10_000], 39_999)).toBe(false)
    expect(eventSpaced([50_000], 20_000)).toBe(true)
    expect(eventSpaced([], 0)).toBe(true)
  })
})

describe('fit: dropped shots with a plot event (DESC-020)', () => {
  const gaps = [{ startMs: 0, endMs: 2000 }]
  it('a dropped shot with a new plot event becomes an extended cue', async () => {
    // sintel-90-210 shots 7 and 8: the broth is poured, the bowl is accepted; one gap, room for the first only
    const cues = await fit([shot(7, 0, 3000, 'Old man pours broth.'), shot(8, 3000, 6000, 'Red-haired girl accepts bowl.')], gaps, same)
    expect(cues.map((c) => [c.shotIndex, c.startMs, c.extended, c.text])).toEqual([[7, 0, false, 'Old man pours broth.'], [8, 3000, true, 'Red-haired girl accepts bowl.']])
    expect(cues[1]).toEqual({ startMs: 3000, endMs: 3100, text: 'Red-haired girl accepts bowl.', extended: true, wordCount: 4, shotIndex: 8, event: true })
    expect(cues[0]).not.toHaveProperty('event')
    // shot 24: the woman kneels beside the dragon
    const [k] = await fit([shot(24, 101875, 104667, 'Red-haired woman kneels beside bleeding creature on cobblestones.')], [], same)
    expect(k).toMatchObject({ extended: true, event: true, startMs: 101875, text: 'Red-haired woman kneels beside bleeding creature on cobblestones.' })
    // the text is the shot's own description, capped like any extended cue (never invented)
    const long = `Red-haired girl accepts bowl, ${'nods '.repeat(30).trim()}.`
    const [c] = await fit([shot(8, 0, 3000, long)], [], same)
    expect(c).toMatchObject({ extended: true, event: true, wordCount: 25 })
    expect(long.startsWith(c!.text.replace(/\.$/, ''))).toBe(true)
  })
  it('a setting-only dropped shot stays dropped', async () => {
    for (const t of ['Tent glows.', 'Tent interior. Fire glows.', 'Dawn breaks over city.', 'Red-haired woman opens eyes.', 'Red-haired woman in gray tank top stares.', 'Red-haired girl holds book.', 'Red-haired girl watches man stir pot over fire.']) {
      expect(await fit([shot(7, 0, 3000, 'Old man pours broth.'), shot(9, 3000, 6000, t)], gaps, same)).toEqual([expect.objectContaining({ shotIndex: 7 })])
    }
  })
  it('an action the previous voiced cue said is not an event: shot 19 after shot 18', async () => {
    // "climbs" was just heard; shot 19 is dropped here (no "rooftop", so not introducesNew either)
    const cues = await fit([shot(18, 0, 3000, 'Red-haired woman climbs stone steps.'), shot(19, 3000, 6000, 'Red-haired woman climbs brick wall.')], gaps, same)
    expect(cues.map((c) => c.shotIndex)).toEqual([18])
  })
  it('introducesNew still wins and is not counted against the cap', async () => {
    const cues = await fit([shot(0, 0, 3000, 'A woman enters the room.'), shot(1, 3000, 6000, 'Red-haired girl accepts bowl.')], [], same)
    expect(cues.map((c) => [c.shotIndex, c.extended, c.event])).toEqual([[0, true, undefined], [1, true, true]])
  })
  it('at most one added extended cue per 30 s', async () => {
    // three event shots of equal content 10 s apart, no room: the first and the one 40 s later
    const events = [shot(0, 0, 3000, 'Red-haired girl accepts bowl.'), shot(1, 10_000, 13_000, 'Red-haired girl drops bowl.'), shot(2, 40_000, 43_000, 'The dragon falls.')]
    expect((await fit(events, [], same)).map((c) => [c.shotIndex, c.startMs, c.event])).toEqual([[0, 0, true], [2, 40_000, true]])
    // the shot with the most new action content wins the window: two new verbs beat one
    const richer = [shot(0, 0, 3000, 'Red-haired girl accepts bowl.'), shot(1, 10_000, 13_000, 'Red-haired woman kneels, then lifts the creature.')]
    expect((await fit(richer, [], same)).map((c) => c.shotIndex)).toEqual([1])
    // equal verbs: more new words wins; then the earlier shot
    const words = [shot(0, 0, 3000, 'Red-haired girl accepts bowl.'), shot(1, 10_000, 13_000, 'Red-haired woman kneels beside bleeding creature on cobblestones.')]
    expect((await fit(words, [], same)).map((c) => c.shotIndex)).toEqual([1])
    const tie = [shot(0, 0, 3000, 'Red-haired girl accepts bowl.'), shot(1, 10_000, 13_000, 'Red-haired girl drops bowl.')]
    expect((await fit(tie, [], same)).map((c) => c.shotIndex)).toEqual([0])
    // exactly 30 s apart is allowed
    const edge = [shot(0, 0, 3000, 'Red-haired girl accepts bowl.'), shot(1, 30_000, 33_000, 'Red-haired girl drops bowl.')]
    expect((await fit(edge, [], same)).map((c) => c.shotIndex)).toEqual([0, 1])
    const ev = (startMs: number, verbs: number, fresh = 0) => ({ cue: { startMs, endMs: startMs + 100, text: 'x', extended: true as const, wordCount: 1, shotIndex: 0, event: true as const }, verbs, fresh })
    expect(capEvents([ev(0, 1), ev(20_000, 2), ev(45_000, 1), ev(70_000, 1, 3), ev(80_000, 1, 1)]).map((c) => c.startMs)).toEqual([20_000, 70_000])
  })
})

describe('voice: a cue dropped for overrun with a plot event (DESC-020)', () => {
  let work: string
  const ctx = (): Ctx => ({ slug: 't', source: 's.mp4', language: 'en', voice: 'Joanna', work })
  const cue = (startMs: number, text: string, limitMs?: number, extra: Partial<FitCue> = {}): FitCue => ({ startMs, endMs: startMs + 1000, text, extended: false, wordCount: text.split(/\s+/).length, shotIndex: 0, ...(limitMs === undefined ? {} : { limitMs }), ...extra })
  const MS_PER_WORD = 600
  const deps = () => ({ synthesize: async (t: string) => new TextEncoder().encode(t), measureMs: async (f: string) => (await readFile(f, 'utf8')).split(/\s+/).length * MS_PER_WORD })
  const writeCues = (cues: FitCue[]) => writeFile(`${work}/cues.json`, JSON.stringify(cues))
  const run = async (cues: FitCue[]) => { await writeCues(cues); await voice(ctx(), deps()); return JSON.parse(await readFile(`${work}/cues.json`, 'utf8')) as FitCue[] }
  beforeEach(async () => { work = await mkdtemp(join(tmpdir(), 'ev-')) })
  afterEach(async () => { await rm(work, { recursive: true, force: true }) })

  it('a dropped shot with a new plot event becomes an extended cue (voice)', async () => {
    // 4 words × 600 = 2400 ms into a 1500 ms slot: shortened to 3 words — nothing to cut — still over; not introducesNew; a new event
    const out = await run([cue(0, 'Old man pours broth.', 5000, { shotIndex: 7 }), cue(10_000, 'Red-haired girl accepts bowl.', 11_500, { shotIndex: 8 })])
    expect(out).toEqual([
      { startMs: 0, endMs: 2400, text: 'Old man pours broth.', extended: false, wordCount: 4, shotIndex: 7, limitMs: 5000 },
      { startMs: 10_000, endMs: 12_400, text: 'Red-haired girl accepts bowl.', extended: true, wordCount: 4, shotIndex: 8, event: true },
    ])
    expect(out[1]).not.toHaveProperty('limitMs')
  })
  it('the full cue text is voiced in the pause, not the slot shortening', async () => {
    // 8 words × 600 = 4800 into 2000 ms: the slot shortening cuts the clause ("…, then falls."), 6 words still over; the pause has no slot, so the whole line is voiced — the original clip, set aside, not a third call
    const synthesized: string[] = []
    await writeCues([cue(0, 'Red-haired woman kneels beside the creature, then falls.', 2000, { shotIndex: 24 })])
    await voice(ctx(), { ...deps(), synthesize: async (t) => { synthesized.push(t); return new TextEncoder().encode(t) } })
    const out = JSON.parse(await readFile(`${work}/cues.json`, 'utf8')) as FitCue[]
    expect(out).toEqual([{ startMs: 0, endMs: 4800, text: 'Red-haired woman kneels beside the creature, then falls.', extended: true, wordCount: 8, shotIndex: 24, event: true }])
    expect(synthesized).toEqual(['Red-haired woman kneels beside the creature, then falls.', 'Red-haired woman kneels beside the creature.'])
    expect(await readFile(`${work}/cue_0.mp3`, 'utf8')).toBe(out[0]!.text)
    expect((await readdir(work)).filter((f) => f.startsWith('moving_'))).toEqual([])
    expect(JSON.parse(await readFile(`${work}/cue_0.json`, 'utf8'))).toMatchObject({ text: out[0]!.text, durationMs: 4800 })
  })
  it('a setting-only dropped shot stays dropped (voice)', async () => {
    // 'Tent interior. Fire glows.' into 1 s: the slot shortening keeps "Tent interior." and that fits; 'Tent glows.' into 0.5 s cannot be shortened and is not an event
    const out = await run([cue(0, 'Old man pours broth.', 5000), cue(10_000, 'Red-haired woman smiles.', 11_000), cue(20_000, 'Tent interior. Fire glows.', 21_000), cue(30_000, 'Tent glows.', 30_500)])
    expect(out.map((c) => c.text)).toEqual(['Old man pours broth.', 'Tent interior.'])
  })
  // PR #29 review H1: after the on-screen text is split off, the pause voices the rest (said once), at the action start
  it('a dropped event whose on-screen text was split off voices the rest in its own pause, after the text cue\'s lead', async () => {
    await writeFile(`${work}/shots.json`, JSON.stringify([{ index: 7, startMs: 0, endMs: 5000 }, { index: 8, startMs: 9000, endMs: 12_000 }]))
    const synthesized: string[] = []
    await writeCues([cue(0, 'Old man pours broth.', 5000, { shotIndex: 7 }), cue(10_000, 'Red-haired girl accepts bowl. Words appear: The Gift.', 11_500, { shotIndex: 8 })])
    await voice(ctx(), { ...deps(), synthesize: async (t) => { synthesized.push(t); return new TextEncoder().encode(t) } })
    const out = JSON.parse(await readFile(`${work}/cues.json`, 'utf8')) as FitCue[]
    expect(out).toEqual([
      { startMs: 0, endMs: 2400, text: 'Old man pours broth.', extended: false, wordCount: 4, shotIndex: 7, limitMs: 5000 },
      { startMs: 9600, endMs: 9600 + 4 * 600, text: 'Words appear: The Gift.', extended: true, wordCount: 4, shotIndex: 8 },
      { startMs: 10_000, endMs: 12_400, text: 'Red-haired girl accepts bowl.', extended: true, wordCount: 4, shotIndex: 8, event: true },
    ])
    expect(out.filter((c) => c.text.includes('Gift'))).toHaveLength(1)
    expect(synthesized).toEqual(['Old man pours broth.', 'Red-haired girl accepts bowl. Words appear: The Gift.', 'Red-haired girl accepts bowl.', 'Words appear: The Gift.'])
    for (const [i, c] of out.entries()) expect(await readFile(`${work}/cue_${i}.mp3`, 'utf8')).toBe(c.text)
  })
  // PR #29 review M1: fit's event cue starts at the shot start, which can be inside the previous clip
  it('an event cue (or any extended cue) never starts while the previous placed clip still speaks; the cap holds after the move', async () => {
    const LINE = 'A tall woman in a long red coat crosses the old stone bridge slowly.' // 14 words × 600 = 8400 ms from 0; limit 9000
    const fitEvent = (startMs: number, text: string, shotIndex: number): FitCue => ({ startMs, endMs: startMs + 100, text, extended: true, wordCount: text.split(/\s+/).length, shotIndex, event: true })
    const out = await run([cue(0, LINE, 9000, { shotIndex: 0 }), fitEvent(1500, 'Red-haired girl accepts bowl.', 1), { ...fitEvent(4000, 'Night. A rooftop.', 2), event: undefined } as FitCue])
    expect(out.map((c) => [c.startMs, c.endMs, c.event ?? false, c.text])).toEqual([[0, 8400, false, LINE], [8400, 8400 + 2400, true, 'Red-haired girl accepts bowl.'], [8400, 8400 + 1800, false, 'Night. A rooftop.']])
    for (const [i, c] of out.entries()) expect(await readFile(`${work}/cue_${i}.mp3`, 'utf8')).toBe(c.text)
    // an event cue 30 s after the first one's fit start is within 30 s of its moved start: dropped, deterministically
    const two = await run([cue(0, LINE, 9000, { shotIndex: 0 }), fitEvent(1500, 'Red-haired girl accepts bowl.', 1), fitEvent(31_600, 'The dragon falls.', 2), fitEvent(61_000, 'She kneels.', 3)])
    expect(two.map((c) => [c.startMs, c.text])).toEqual([[0, LINE], [8400, 'Red-haired girl accepts bowl.'], [61_000, 'She kneels.']])
    expect(await readFile(`${work}/cue_2.mp3`, 'utf8')).toBe('She kneels.')
    expect((await readdir(work)).filter((f) => f.startsWith('cue_')).sort()).toEqual(['cue_0.json', 'cue_0.mp3', 'cue_1.json', 'cue_1.mp3', 'cue_2.json', 'cue_2.mp3'])
  })
  it('at most one added extended cue per 30 s (voice, counting fit\'s event cues)', async () => {
    const dropped = (startMs: number, text: string, shotIndex: number) => cue(startMs, text, startMs + 1500, { shotIndex })
    const out = await run([dropped(1000, 'Red-haired girl accepts bowl.', 1), dropped(11_000, 'She kneels beside the dragon.', 2), dropped(41_000, 'The dragon falls.', 3)])
    expect(out.map((c) => [c.shotIndex, c.extended, c.event])).toEqual([[1, true, true], [3, true, true]]) // shot 2 is within 30 s of shot 1
    // a fit event cue 21 s before blocks the one voice would add
    const fitEvent: FitCue = { startMs: 20_000, endMs: 20_100, text: 'Red-haired woman kneels beside bleeding creature.', extended: true, wordCount: 6, shotIndex: 2, event: true }
    const out2 = await run([fitEvent, dropped(41_000, 'The dragon falls.', 3)])
    expect(out2.map((c) => [c.shotIndex, c.event])).toEqual([[2, true]])
  })
})
