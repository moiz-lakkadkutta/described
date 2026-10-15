import { readFileSync } from 'node:fs'
import { fit, scenePauses, SCENE_PAUSE_SPACING_MS, shortenDeterministic, estimateClipMs, type FitCue } from '../src/steps/05-fit'
import { fallbackScenes, finishScenes, type Scene } from '../src/steps/04c-scenes'
import { sceneLine, sceneStems, settingLead, statesPlace } from '../src/sceneSetting'
import { EMPTY_GLOSSARY, loadGlossary } from '../src/glossary'
import type { Described } from '../src/steps/04-describe'

const fixture = <T>(f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')) as T
const sh = (index: number, startMs: number, endMs: number, description: string): Described => ({ index, startMs, endMs, description, sameAsPrev: false, tokens: 0, outputTokens: 0 })
const scene = (id: number, shots: number[], startMs: number, endMs: number, setting: string, extra: Partial<Scene> = {}): Scene => ({ id, shots, startMs, endMs, setting, returning: false, evidence: [], ...extra })
const room = (words: number) => estimateClipMs(words) // a gap that holds exactly `words` words at fit's estimate

describe('scene settings (DESC-029, sceneSetting)', () => {
  it('finds an opening setting statement: short, verbless, a place', () => {
    expect(settingLead('Tent interior. Fire glows.')).toBe('Tent interior.')
    expect(settingLead('Snowy mountains. A lone figure walks left.')).toBe('Snowy mountains.')
    expect(settingLead('Dim ship deck. Figure kneels beside prone bodies.')).toBe('Dim ship deck.')
    expect(settingLead('Fire glows in a pit.')).toBeUndefined() // a verb: an action, not a statement of place
    expect(settingLead('Words appear: THE ROOM. A man sits.')).toBeUndefined()
    expect(settingLead('Bearded man holds staff.')).toBeUndefined()
  })
  it('a cue states the scene\'s place with a word of its label or glossary name, or an opening setting statement — not a word of the look', () => {
    const g = loadGlossary('sintel-90-150-r2')
    const tent = sceneStems(scene(1, [2], 0, 1, 'the tent', { settingName: 'the tent' }), g)
    expect(statesPlace('Tent interior. Fire glows.', tent)).toBe(true)
    expect(statesPlace('Dark room. Fire burns.', tent)).toBe(true) // its own setting statement
    expect(statesPlace('A faint fire glows in a stone pit.', tent)).toBe(false) // fire and pit are in the tent's look, but say no place
  })
  it('says the scene label, or "Back in …" on a return', () => {
    expect(sceneLine(scene(0, [0], 0, 1, 'the tent'))).toBe('The tent.')
    expect(sceneLine(scene(0, [0], 0, 1, 'tent interior'))).toBe('Tent interior.')
    expect(sceneLine(scene(0, [0], 0, 1, 'the lab', { returning: true }))).toBe('Back in the lab.')
    expect(sceneLine(scene(0, [0], 0, 1, 'lab', { returning: true }))).toBe('Back in the lab.')
    expect(sceneLine(scene(0, [0], 0, 1, ''))).toBe('')
  })
})

describe('fit with scenes (DESC-029)', () => {
  it('sintel-90-150-r2: the tent scene\'s first cue states the place, and no later cue of a scene says its place again', async () => {
    const shots = fixture<Described[]>('sintel-90-150-r2.described.json'), gaps = fixture<{ startMs: number; endMs: number }[]>('sintel-90-150-r2.gaps.json')
    const g = loadGlossary('sintel-90-150-r2')
    const scenes = finishScenes(fallbackScenes(shots, g), shots, g)
    const text = (cs: { shotIndex: number; text: string }[]) => cs.map((c) => `${c.shotIndex}: ${c.text}`)
    expect(text(await fit(shots, gaps, shortenDeterministic))).toEqual([ // as before DESC-029, except that a shortening keeps the action (0012 amendment): shots 3 and 9 were "Dark room." and "Tent interior."
      '0: Snowy mountains. A lone figure walks left, carrying a spear. Words appear: SINTEL.',
      '1: Snowy mountains. A figure walks, falls. Logo fades. Words appear: SINTEL.',
      '2: A faint fire glows in a stone pit.', '3: Fire burns.', '4: Bearded man holds staff. Red-haired woman watches.', '7: Man pours broth.',
      '8: Red-haired girl accepts bowl.', '9: Fire glows.', '13: Red-haired woman stares intently forward.',
    ])
    const after = await fit(shots, gaps, shortenDeterministic, 'en', { scenes, glossary: g })
    expect(text(after)).toEqual([
      '0: Snowy mountains. A lone figure walks left, carrying a spear. Words appear: SINTEL.',
      '1: A figure walks, falls. Logo fades. Words appear: SINTEL.', // "Snowy mountains." not said twice
      '2: In the tent, a faint fire glows in a stone pit.', // the place, at the scene's first cue, merged into the action (0012 amendment; published: "Tent glows." 30 s in)
      '3: Fire burns.', // "Dark room." would say the place again; the action takes its slot
      '4: Bearded man holds staff. Red-haired woman watches.', '7: Man pours broth.', '8: Red-haired girl accepts bowl.',
      '9: Fire glows.', // "Tent interior. Fire glows.": the place is said, so the action (published as "Tent glows.")
      '13: Red-haired woman stares intently forward.',
    ])
    expect(after.some((c) => c.scene)).toBe(false) // both scenes state their place: no scene pause
  })
  it('protects a scene\'s own opening setting statement: the rest is shortened beside it, never the statement', async () => {
    const shots = [sh(0, 0, 4000, 'Tent interior. Fire glows brightly in a pit.')]
    const scenes = [scene(0, [0], 0, 4000, 'tent interior')]
    const model = (t: string) => (t.startsWith('Tent') ? 'Fire glows brightly.' : 'Fire glows.') // the whole text: drops the place
    expect((await fit(shots, [{ startMs: 0, endMs: room(4) }], model, 'en', { scenes })).find((c) => !c.extended)!.text).toBe('Tent interior. Fire glows.')
    expect((await fit(shots, [{ startMs: 0, endMs: room(4) }], model)).find((c) => !c.extended)!.text).toBe('Fire glows brightly.') // without scenes, as before
  })
  it('never voices the statement alone (decision 0012 amendment, 2026-10-15): the action takes the slot; an event outranks the setting', async () => {
    const quiet = [sh(0, 0, 4000, 'Tent interior. Fire glows.')]
    const scenes = [scene(0, [0], 0, 4000, 'tent interior')]
    const dropsPlace = () => 'Fire glows.'
    expect((await fit(quiet, [{ startMs: 0, endMs: room(3) }], dropsPlace, 'en', { scenes })).find((c) => !c.extended)!.text).toBe('Fire glows.') // was "Tent interior." (0012)
    const event = [sh(0, 0, 4000, 'Tent interior. A woman kneels beside the fire.')]
    const keepsEvent = (t: string, n: number) => t.split(' ').slice(-n).join(' ')
    // "beside the fire." drops the action, and no 3-word cut keeps it: the shot (it opens a place: introducesNew "a woman") becomes an extended cue, its own place statement in front
    expect((await fit(event, [{ startMs: 0, endMs: room(3) }], keepsEvent, 'en', { scenes })).map((c) => [c.text, c.extended])).toEqual([['Tent interior. A woman kneels beside the fire.', true]])
  })
  it('puts the scene label in front of a first cue that does not say where we are, when the words fit; "Back in …" on a return', async () => {
    const shots = [sh(0, 0, 4000, 'A man types at a console.'), sh(1, 4000, 8000, 'A woman runs.'), sh(2, 8000, 12000, 'A man reads.')]
    const scenes = [scene(0, [0], 0, 4000, 'the lab', { settingName: 'the lab' }), scene(1, [1], 4000, 8000, 'the street', { settingName: 'the street' }), scene(2, [2], 8000, 12000, 'the lab', { returning: true, settingName: 'the lab' })]
    const gaps = [{ startMs: 0, endMs: 3900 }, { startMs: 4000, endMs: 7900 }, { startMs: 8000, endMs: 12000 }]
    // decision 0012 amendment (2026-10-15): the place merged into the action as one sentence, never a sentence of its own
    expect((await fit(shots, gaps, shortenDeterministic, 'en', { scenes })).map((c) => c.text)).toEqual(['In the lab, a man types at a console.', 'In the street, a woman runs.', 'Back in the lab, a man reads.'])
    // no room for the place: the description alone; no scene pause, since its shot is voiced and a place is never a pause on its own
    const tight = await fit(shots.slice(0, 1), [{ startMs: 0, endMs: room(6) }], shortenDeterministic, 'en', { scenes: scenes.slice(0, 1) })
    expect(tight.map((c) => [c.text, c.extended, c.scene ?? false])).toEqual([['A man types at a console.', false, false]])
  })
  it('scene pauses: only where no cue states the place, at most one per title-minute, never inside an earlier shot\'s cue, never after the scene', () => {
    const cue = (shotIndex: number, startMs: number, text: string, extra: Partial<FitCue> = {}): FitCue => ({ startMs, endMs: startMs + 2000, text, extended: false, wordCount: 3, shotIndex, ...extra })
    const scenes = [scene(0, [0], 0, 10_000, 'the lab', { settingName: 'the lab' }), scene(1, [1, 4], 10_000, 20_000, 'the street', { settingName: 'the street' }), scene(2, [2], 20_000, 75_000, 'the bridge', { settingName: 'the bridge' }), scene(3, [3], 75_000, 76_000, 'the roof', { settingName: 'the roof' })]
    const shots = [sh(0, 0, 10_000, 'The lab hums.'), sh(1, 10_000, 15_000, 'A dog barks at a cart.'), sh(4, 15_000, 20_000, 'A woman runs.'), sh(2, 20_000, 75_000, 'A man waits.'), sh(3, 75_000, 76_000, 'A man jumps.')]
    const cues = [cue(0, 0, 'The lab hums.'), cue(4, 15_000, 'A woman runs.'), cue(2, 74_500, 'A man waits.'), cue(3, 75_500, 'A man jumps.')]
    const pauses = (cs: FitCue[]) => cs.filter((c) => c.scene).map((c) => [c.text, c.startMs, c.shotIndex])
    // the place merged into the action of the shot under the pause (decision 0012 amendment); the bridge is < 60 s later; the roof starts after its scene ended
    expect(pauses(scenePauses(scenes, cues, EMPTY_GLOSSARY, shots))).toEqual([['In the street, a dog barks at a cart.', 10_000, 1]])
    expect(SCENE_PAUSE_SPACING_MS).toBe(60_000)
    expect(scenePauses([scene(0, [0], 0, 10_000, 'the lab', { settingName: 'the lab' })], [], EMPTY_GLOSSARY, [sh(0, 0, 10_000, 'A man types.')]).find((c) => c.scene)).toMatchObject({ extended: true, text: 'In the lab, a man types.', wordCount: 6 })
    // never the place alone: the shot under it is voiced already, or has no action
    expect(scenePauses([scene(0, [0], 0, 10_000, 'the lab', { settingName: 'the lab' })], [cue(0, 3000, 'A man types.')], EMPTY_GLOSSARY, [sh(0, 0, 10_000, 'A man types.')]).find((c) => c.scene)).toBeUndefined()
    expect(scenePauses([scene(0, [0], 0, 10_000, 'the lab', { settingName: 'the lab' })], [], EMPTY_GLOSSARY, [sh(0, 0, 10_000, 'A dim console.')]).find((c) => c.scene)).toBeUndefined()
    // a label no glossary backs, taken from one other shot of the scene, is not said over this one (placeKnown)
    expect(scenePauses([scene(0, [0, 1], 0, 10_000, 'tower')], [], EMPTY_GLOSSARY, [sh(0, 0, 5000, 'A man aims a rifle.'), sh(1, 5000, 10_000, 'Ornate clock tower.')]).find((c) => c.scene)).toBeUndefined()
    expect(fit([sh(0, 0, 3000, 'A man types.')], [{ startMs: 0, endMs: 2900 }], shortenDeterministic, 'en', { scenes: [scene(0, [0], 0, 3000, 'the lab', { settingName: 'the lab' })], scenePauses: false })).resolves.toEqual([expect.objectContaining({ extended: false })])
  })
  it('one pause, not two: an event pause at the scene\'s start says the place first; a separate scene pause sorts before another pause', async () => {
    const event: FitCue = { startMs: 0, endMs: 100, text: 'A woman kneels beside the fire.', extended: true, wordCount: 6, shotIndex: 0, event: true }
    const merged = scenePauses([scene(0, [0], 0, 10_000, 'the lab', { settingName: 'the lab' })], [event], EMPTY_GLOSSARY)
    expect(merged).toEqual([{ ...event, text: 'In the lab, a woman kneels beside the fire.', wordCount: 9, scene: true }])
    const shots = [sh(0, 0, 3000, 'A woman kneels beside the fire.')] // no gap: fit makes it an event pause, and the place joins it
    expect((await fit(shots, [], shortenDeterministic, 'en', { scenes: [scene(0, [0], 0, 3000, 'the lab', { settingName: 'the lab' })] })).map((c) => c.text)).toEqual(['In the lab, a woman kneels beside the fire.'])
  })
})
