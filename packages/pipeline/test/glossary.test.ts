import { allowedNames, loadGlossary, nameEvidence, peopleAndPlaces, placeStems, shortLook, withoutName, EMPTY_GLOSSARY, type Glossary } from '../src/glossary'

export const ED: Glossary = loadGlossary('elephants-dream-0-60')
const tos = loadGlossary('tears-of-steel-40-100')

describe('glossary (DESC-029)', () => {
  it('loads a title from apps/api/prisma/titles.json; an unknown slug or a missing file is empty', () => {
    expect(ED.characters.map((c) => c.name)).toEqual(['Proog', 'Emo'])
    expect(loadGlossary('my-own-video')).toEqual(EMPTY_GLOSSARY)
    expect(loadGlossary('elephants-dream-0-60', '/no/such/file.json')).toEqual(EMPTY_GLOSSARY)
  })
  it('allows a glossary name from revealedAtS on, and names spoken in the dialogue', () => {
    expect(allowedNames(ED, 25_000)).toEqual([])
    expect(allowedNames(ED, 30_000)).toEqual(['Emo'])
    expect(allowedNames(ED, 30_000, ['Emo', 'Hope'])).toEqual(['Emo', 'Hope'])
    expect(allowedNames(tos, 0)).toEqual(['Thom', 'Celia']) // named before the segment starts; "the sniper" is a label, never a name
  })
  it('the prompt block gives the look always, the name and role only once revealed', () => {
    const before = peopleAndPlaces(ED, 10_000), after = peopleAndPlaces(ED, 40_000)
    expect(before).toContain('- a thin young man with short dark hair and large ears, in a pale green shirt (not named yet: describe by this look, never by a name)')
    expect(before).not.toMatch(/\bEmo\b|\bProog\b|leading/)
    expect(after).toContain('- Emo: a thin young man with short dark hair and large ears, in a pale green shirt; the young man the old man is leading through the machine. Call them Emo.')
    expect(after).not.toContain('Proog') // never revealed in the segment
    expect(after).toContain('- Place: the white chamber, a pale blue-white chamber of cables and glowing panels, a narrow platform over a drop')
    expect(peopleAndPlaces(EMPTY_GLOSSARY, 0)).toBe('')
  })
  it('shortLook keeps the head of a look', () => {
    expect(shortLook('a thin young man with short dark hair and large ears, in a pale green shirt')).toBe('the thin young man')
    expect(shortLook('a bald old man with a long nose, in a long brown coat and a red tie')).toBe('the bald old man')
  })
  it('nameEvidence: glossary names once revealed, dialogue names once heard, premature and invented names reported', () => {
    expect(nameEvidence('Emo blinks, turns his head.', 30_000, ED)).toEqual({ names: [{ name: 'Emo', source: 'glossary', revealedAtS: 25.1, evidence: expect.stringContaining('c3') }], premature: [], invented: [] })
    expect(nameEvidence('Emo blinks.', 20_000, ED)).toMatchObject({ names: [], premature: ['Emo'] })
    expect(nameEvidence('The old man, Proog, points left.', 50_000, ED)).toMatchObject({ names: [], premature: ['Proog'] })
    expect(nameEvidence('The old man, Proog, points left.', 50_000, ED, [{ name: 'Proog', at: 45 }])).toMatchObject({ names: [{ name: 'Proog', source: 'dialogue', at: 45 }], premature: [] })
    expect(nameEvidence('A man named Jack waves.', 50_000, ED)).toMatchObject({ invented: ['Jack'] })
    expect(nameEvidence('Words appear: "Dr Amstelwijk ROBOTICIST CREATES KILLER ROBOTS"', 41_000, tos)).toEqual({ names: [], premature: [], invented: [] }) // on-screen text is not checked
    expect(nameEvidence('Celia raises her mechanical arm. Thom turns.', 0, tos).names.map((n) => n.name)).toEqual(['Thom', 'Celia'])
    expect(nameEvidence('Cables around glowing panels. Two figures lie on platform.', 33_000, ED)).toEqual({ names: [], premature: [], invented: [] })
  })
  it('withoutName puts the short look in place of a name the cue may not use', () => {
    expect(withoutName('Emo blinks. The old man turns to Emo.', 'Emo', ED)).toBe('The thin young man blinks. The old man turns to the thin young man.')
    expect(withoutName('A man named Jack waves.', 'Jack', ED)).toBe('A man named someone waves.')
  })
  it('placeStems finds the place nouns of a description, not those of its on-screen text', () => {
    expect(placeStems('Tent interior. Fire glows.')).toEqual(['tent', 'interior'])
    expect(placeStems('Dark room. Fire burns.')).toEqual(['room'])
    expect(placeStems('Words appear: "THE ROOM". A man sits.')).toEqual([])
  })
})
