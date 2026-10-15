import { readFileSync } from 'node:fs'
import { allowedNames, assign, loadGlossary, matchedCharacters, mentions, nameEvidence, peopleAndPlaces, placeStems, shortLook, shortOf, withoutName, EMPTY_GLOSSARY, type Glossary } from '../src/glossary'
import type { Described } from '../src/steps/04-describe'

export const ED: Glossary = loadGlossary('elephants-dream-0-60')
const tos = loadGlossary('tears-of-steel-40-100'), bbb = loadGlossary('big-buck-bunny-0-60')
const tosShots = JSON.parse(readFileSync(new URL('./fixtures/tears-of-steel-40-100.described.json', import.meta.url), 'utf8')) as Described[]
const SNIPER = tosShots.find((s) => s.index === 11)!.description // "Man in dark jacket aims rifle from balcony."
const BRIDGE = tosShots.find((s) => s.index === 0)!.description

describe('glossary (DESC-029)', () => {
  it('loads a title from apps/api/prisma/titles.json; an unknown slug or a missing file is empty, with a loud warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(ED.characters.map((c) => c.name)).toEqual(['Proog', 'Emo'])
    expect(loadGlossary('my-own-video')).toEqual(EMPTY_GLOSSARY)
    expect(loadGlossary('elephants-dream-0-60', '/no/such/file.json')).toEqual(EMPTY_GLOSSARY)
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringMatching(/WARNING no people-and-places entry for "my-own-video"/), expect.stringMatching(/WARNING .*"elephants-dream-0-60"/)])
    warn.mockRestore()
  })
  it('reads a title the seeder must not create from apps/api/prisma/glossaries.json, after titles.json (full-length sintel, decision 0016)', () => {
    const g = loadGlossary('sintel')
    expect(g.characters.map((c) => c.name)).toContain('Sintel')
    expect(g.characters.find((c) => c.name === 'Sintel')!.revealedAtS).toBe(457.8) // "These are dragon lands, Sintel." film 7:37.8
    expect(g.characters.find((c) => c.name === 'Scales')!.revealedAtS).toBe(228.3) // "Good night, Scales." film 3:48.25
    expect(loadGlossary('sintel-g1')).toEqual(g) // an evaluation copy of it
    expect(loadGlossary('sintel-90-150-r2').characters.map((c) => c.name)).toEqual(['Sintel', 'Shaman']) // titles.json, not the full film's
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const prev = process.env.GLOSSARY_FILE
    process.env.GLOSSARY_FILE = '/no/such/file.json'
    try { expect(loadGlossary('sintel')).toEqual(EMPTY_GLOSSARY) } finally { if (prev === undefined) delete process.env.GLOSSARY_FILE; else process.env.GLOSSARY_FILE = prev } // GLOSSARY_FILE alone
    warn.mockRestore()
  })
  it('an evaluation copy of a slug reads its source\'s glossary (sintel-90-210-g10 → sintel-90-210; tears-of-steel-40-100-g1 → tears-of-steel-40-100)', () => {
    const file = new URL('../../../docs/eval/gate-c-glossary.json', import.meta.url)
    for (const slug of ['sintel-90-210', 'sintel-90-210-g10', 'sintel-90-210-g2']) {
      const g = loadGlossary(slug, file)
      expect(g.characters.map((c) => [c.name, c.revealedAtS])).toEqual([['Sintel', null], ['Shaman', null], ['Scales', null]])
      expect(g.settings.map((s) => s.name)).toEqual(['the snowy mountains', 'the tent', 'the town'])
    }
    expect(loadGlossary('tears-of-steel-40-100-g1')).toEqual(tos)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(loadGlossary('tears-of-steel-40-100-de')).toEqual(EMPTY_GLOSSARY) // a sibling title (another language) is not an eval copy
    expect(loadGlossary('tears-of-steel-40-100-g')).toEqual(EMPTY_GLOSSARY)
    warn.mockRestore()
  })
  it('allows a glossary name only from its reveal inside the segment (Emo 25.1 s, Thom 2.2 s; Celia never), and names spoken in the dialogue', () => {
    expect(allowedNames(ED, 25_000)).toEqual([])
    expect(allowedNames(ED, 30_000)).toEqual(['Emo'])
    expect(allowedNames(ED, 30_000, ['Emo', 'Hope'])).toEqual(['Emo', 'Hope'])
    expect(allowedNames(tos, 0)).toEqual([])
    expect(allowedNames(tos, 60_000)).toEqual(['Thom']) // "Celia" is said only before the segment starts; "the sniper" is a label
  })
  it('the prompt block gives the look always, a name only once revealed and only for a figure with that look, and never a role', () => {
    const before = peopleAndPlaces(ED, 10_000), after = peopleAndPlaces(ED, 40_000)
    expect(before).toContain('- a thin young man with short dark hair and large ears, in a pale green shirt (not named yet: describe by this look, never by a name)')
    expect(before).not.toMatch(/\bEmo\b|\bProog\b/)
    expect(after).toContain('- a thin young man with short dark hair and large ears, in a pale green shirt: only if the person visible matches this look, call them Emo (the first time: "the thin young man, Emo"); never give this name to anyone else.')
    expect(after).not.toContain('Proog') // never revealed in the segment
    for (const c of ED.characters) expect(after).not.toContain(c.role)
    expect(after).toContain('- Place: the white chamber, a pale blue-white chamber of cables and glowing panels, a narrow platform')
    expect(peopleAndPlaces(EMPTY_GLOSSARY, 0)).toBe('')
  })
  it('short references: the editor\'s `short`, else the look\'s head — never cut at a comma', () => {
    expect(shortOf(bbb.characters[0]!)).toBe('the big grey rabbit')
    expect(shortLook('a huge, round grey rabbit with long ears')).toBe('the huge round grey rabbit') // was "the huge"
    expect(shortLook('a thin young man with short dark hair and large ears, in a pale green shirt')).toBe('the thin young man')
    expect(shortOf({ look: 'a bald old man with a long nose', short: '' })).toBe('the bald old man')
  })
  it('binds a name to a look: Thom is not the man with the rifle', () => {
    expect(mentions(SNIPER)).toEqual(['man in dark jacket'])
    expect(assign('man in dark jacket', tos, 'man in dark jacket aims rifle from balcony')).toBe('the sniper') // the rifle breaks the tie
    expect(assign('young man in the leather jacket', tos)).toBe('Thom')
    expect(matchedCharacters([SNIPER], tos)).toEqual(new Set(['the sniper']))
    expect(matchedCharacters(['The young man in the leather jacket, Thom, gestures to the woman with a mechanical arm.'], tos)).toEqual(new Set(['Thom', 'Celia']))
    expect(nameEvidence('Thom aims a rifle from the balcony.', 45_000, tos, [], [SNIPER])).toMatchObject({ names: [], unbound: ['Thom'] })
    expect(nameEvidence('Thom gestures.', 3_000, tos, [], ['The young man in the leather jacket gestures.']).names.map((n) => n.name)).toEqual(['Thom']) // bound by look
    expect(nameEvidence('Thom gestures.', 3_000, tos, [], [BRIDGE]).unbound).toEqual(['Thom']) // "a man in a dark jacket": Thom or the sniper
  })
  it('a revealed name the describer itself wrote in the shot description is bound; one added later must match the look', () => {
    expect(nameEvidence('Emo runs.', 40_000, ED, [], ['Emo runs.'])).toMatchObject({ names: [{ name: 'Emo', source: 'glossary' }], unbound: [] })
    expect(nameEvidence('The old man pulls Emo.', 40_000, ED, [], ['The old man pulls Emo.'])).toMatchObject({ names: [{ name: 'Emo' }], unbound: [] })
    expect(nameEvidence('Emo runs.', 40_000, ED, [], ['A man runs.'])).toMatchObject({ names: [], unbound: ['Emo'] }) // added by fit or edit, no look
    expect(nameEvidence('Thom aims a rifle.', 45_000, tos, [], [SNIPER])).toMatchObject({ unbound: ['Thom'] })
    expect(nameEvidence('Thom aims a rifle.', 45_000, tos, [{ name: 'Thom', at: 3 }], [SNIPER])).toMatchObject({ names: [{ name: 'Thom', source: 'dialogue', at: 3 }], unbound: [] }) // heard in the dialogue: kept
    expect(nameEvidence('The young man in the leather jacket, Thom, aims a rifle.', 45_000, tos, [], [SNIPER])).toMatchObject({ unbound: ['Thom'] }) // the cue's own words do not bind
  })
  it('nameEvidence: glossary names once revealed, dialogue names once heard, premature and invented names reported', () => {
    expect(nameEvidence('Emo blinks, turns his head.', 30_000, ED)).toEqual({ names: [{ name: 'Emo', source: 'glossary', revealedAtS: 25.1, evidence: expect.stringContaining('c3') }], premature: [], invented: [], unbound: [], withheld: [] })
    expect(nameEvidence('Emo blinks.', 20_000, ED)).toMatchObject({ names: [], premature: ['Emo'] })
    expect(nameEvidence('The old man, Proog, points left.', 50_000, ED)).toMatchObject({ names: [], premature: ['Proog'] })
    expect(nameEvidence('The old man, Proog, points left.', 50_000, ED, [{ name: 'Proog', at: 45 }])).toMatchObject({ names: [{ name: 'Proog', source: 'dialogue', at: 45 }], premature: [] })
    expect(nameEvidence('A man named Jack waves.', 50_000, ED)).toMatchObject({ invented: ['Jack'] })
    expect(nameEvidence('Words appear: "Dr Amstelwijk ROBOTICIST CREATES KILLER ROBOTS"', 41_000, tos)).toEqual({ names: [], premature: [], invented: [], unbound: [], withheld: [] }) // on-screen text is not checked
    expect(nameEvidence('Cables around glowing panels. Two figures lie on platform.', 33_000, ED)).toEqual({ names: [], premature: [], invented: [], unbound: [], withheld: [] })
  })
  it('withoutName puts the short reference in place of a name, never inside on-screen text', () => {
    expect(withoutName('Emo blinks. The old man turns to Emo.', 'Emo', ED)).toBe('The thin young man blinks. The old man turns to the thin young man.')
    expect(withoutName('A man named Jack waves.', 'Jack', ED)).toBe('A man named someone waves.')
    expect(withoutName('Words appear: Big Buck Bunny. Big Buck Bunny yawns.', 'Big Buck Bunny', bbb)).toBe('Words appear: Big Buck Bunny. The big grey rabbit yawns.')
    expect(withoutName('Big Buck Bunny yawns. Words appear: "Big Buck Bunny"', 'Big Buck Bunny', bbb)).toBe('The big grey rabbit yawns. Words appear: "Big Buck Bunny"')
  })
  it('placeStems finds the place nouns of a description, not those of its on-screen text', () => {
    expect(placeStems('Tent interior. Fire glows.')).toEqual(['tent', 'interior'])
    expect(placeStems('Dark room. Fire burns.')).toEqual(['room'])
    expect(placeStems('Words appear: "THE ROOM". A man sits.')).toEqual([])
  })
})
