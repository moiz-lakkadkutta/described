import { editReadsAsSentences, inOrder, originalVerbs, readsAsSentences } from '../src/sentenceGuard'
import { capExtended, fit, safeShorten, shortenDeterministic, shortenSentences } from '../src/steps/05-fit'
import type { Described } from '../src/steps/04-describe'

/**
 * DESC-028: Sintel 1:30–3:30 run g9 (decision 0009 prompt), Gate C raters 1 and 2 failed shot 14 "City, central pyramid." (Nova Lite's
 * shortening in fit) and shot 26 "Scaled creature, horns, bloodied wing, stares." (the edit pass reworded fit's sentence) as broken
 * grammar: verbless fragments, lists of nouns. The drafts below are the run's descriptions (work/sintel-90-210-g9/described.json).
 */
const CITY = 'Dense city under hazy sky, central pyramid structure.'
const CREATURE = 'A scaled creature with horns and bloodied wing stares as a gloved hand reaches toward it.'
const SHOT0 = 'Snowy mountains. A lone figure walks left, carrying a spear.'

describe('in-order guard', () => {
  it('accepts content words that are a subsequence of the original, by stem', () => {
    expect(inOrder(CREATURE, 'A scaled creature stares.')).toBe(true)
    expect(inOrder(CREATURE, 'Creature stares as hand reaches.')).toBe(true)
    expect(inOrder('Woman offers bowl to man.', 'Woman offers bowl.')).toBe(true)
  })
  it('rejects swapped roles and reordered facts', () => {
    expect(inOrder('The dragon chases the girl.', 'The girl chases the dragon.')).toBe(false)
    expect(inOrder(CREATURE, 'A gloved hand reaches toward a scaled creature.')).toBe(false)
    expect(inOrder('Woman offers bowl to man.', 'Man offers bowl to woman.')).toBe(false)
    expect(inOrder('Woman offers bowl to man.', 'Woman offers cup.')).toBe(false) // a new word is never in order
  })
})

describe('verbs of the original (heuristic)', () => {
  it('finds present-tense -s verbs and is / are / has, not plural nouns after a preposition, article or number', () => {
    expect(originalVerbs(CREATURE)).toEqual(['stares', 'reaches'])
    expect(originalVerbs(SHOT0)).toEqual(['walks'])
    expect(originalVerbs('The sky is dark and the wind is cold.')).toEqual(['is', 'is'])
    expect(originalVerbs('A girl turns and runs.')).toEqual(['turns', 'runs'])
    expect(originalVerbs('A man with two swords and a shield.')).toEqual([])
    expect(originalVerbs('Pale light rises from the roof.')).toEqual(['rises'])
  })
  // PR #52 review H1: base-form verbs after a plural or "X and Y" subject
  it('finds a base-form verb after a plural subject or an "X and Y" subject', () => {
    expect(originalVerbs('Two hands hold a red bowl; mist swirls inside, revealing a faint, shifting face beneath the surface.')).toEqual(['hold', 'swirls'])
    expect(originalVerbs('Dragons attack the city.')).toEqual(['attack'])
    expect(originalVerbs('Flames rise from the roof.')).toEqual(['rise'])
    expect(originalVerbs('Two dragons fly over the city as smoke rises.')).toEqual(['fly', 'rises'])
    expect(originalVerbs('Celia and Thom argue on the bridge.')).toEqual(['argue'])
    expect(originalVerbs('The man and the woman talk.')).toEqual(['talk'])
    expect(originalVerbs('Faint red sparks drift downward.')).toEqual(['drift'])
  })
  // H2: a manner adverb is judged by the word before it
  it('reads the word after an -ly adverb by the word before the adverb', () => {
    expect(originalVerbs('Sintel slowly lifts the dragon.')).toEqual(['lifts'])
    expect(originalVerbs('A butterfly lands on a leaf.')).toEqual(['lands'])
  })
  it('finds none in a verbless description', () => {
    expect(originalVerbs(CITY)).toEqual([])
    expect(originalVerbs('Snowy mountains.')).toEqual([]) // after an adjective-like word (-y, -ed, a colour …), an -s word is a plural noun
    expect(originalVerbs('Bloodied wings. Boy runs. Sky darkens. Lady walks.')).toEqual(['runs', 'darkens', 'walks'])
  })
})

describe('readsAsSentences', () => {
  it('rejects the g9 fragments', () => {
    expect(readsAsSentences(CITY, 'City, central pyramid.')).toBe('new list comma after "city"')
    expect(readsAsSentences(CREATURE, 'Scaled creature, horns, bloodied wing, stares.')).toBe('new list comma after "creature"')
  })
  it('rejects a shortening that keeps only the subject of a sentence with a verb', () => {
    expect(readsAsSentences(CREATURE, 'A scaled creature with horns.')).toBe('no verb')
    expect(readsAsSentences('Two dragons fly over the city as smoke rises.', 'Two dragons.')).toBe('no verb')
    expect(readsAsSentences(CREATURE, 'Scaled creature. Hand reaches.')).toBe('verbless sentence: "Scaled creature."')
  })
  // the verb checks fail open (PR #52 review): unsure → accept
  it('accepts recorded and reviewer shortenings that keep a verb the heuristic may miss', () => {
    const BOWL = 'Two hands hold a red bowl; mist swirls inside, revealing a faint, shifting face beneath the surface.' // g9 shot 11
    for (const n of [3, 4, 5, 6, 7, 8]) expect(readsAsSentences(BOWL, 'Two hands hold a red bowl.'), String(n)).toBeUndefined()
    expect(readsAsSentences('Two hands hold a terracotta bowl; a pale, veiled face slowly rises within the milky liquid, eyes opening.', 'Two hands hold a terracotta bowl.')).toBeUndefined()
    expect(readsAsSentences('Two dragons fly over the city as smoke rises.', 'Two dragons fly over the city.')).toBeUndefined()
    expect(readsAsSentences('Celia and Thom argue on the bridge as rain falls.', 'Celia and Thom argue on the bridge.')).toBeUndefined()
    expect(readsAsSentences('Sintel slowly lifts the dragon as wind blows.', 'Sintel lifts the dragon.')).toBeUndefined()
    expect(readsAsSentences('A butterfly lands on a leaf as wind blows.', 'A butterfly lands on a leaf.')).toBeUndefined()
    expect(readsAsSentences(SHOT0, 'Snowy mountains.')).toBeUndefined() // a verbless sentence of the original: not only a subject
  })
  // H3: German -s words are not verbs; in German only the in-order and list-comma checks run
  it('German: only the in-order and list-comma checks', () => {
    expect(readsAsSentences('Ein Mann geht nach links, etwas später fällt Schnee.', 'Ein Mann geht nach links.', 'de')).toBeUndefined()
    expect(readsAsSentences('Ein Drache mit Hörnern starrt, während eine Hand greift.', 'Ein Drache mit Hörnern.', 'de')).toBeUndefined()
    expect(readsAsSentences('Dichte Stadt unter dunstigem Himmel, zentrale Pyramide.', 'Stadt, zentrale Pyramide.', 'de')).toBe('new list comma after "stadt"')
    expect(readsAsSentences('Der Drache jagt das Mädchen.', 'Das Mädchen jagt den Drache.', 'de')).toBe('out of order')
  })
  it('rejects swapped roles', () => {
    expect(readsAsSentences('The dragon chases the girl.', 'The girl chases the dragon.')).toBe('out of order')
  })
  it('accepts complete sentences that keep a verb', () => {
    expect(readsAsSentences(CREATURE, 'A scaled creature with horns and bloodied wing stares.')).toBeUndefined()
    expect(readsAsSentences(CREATURE, 'Creature stares as hand reaches toward it.')).toBeUndefined()
    expect(readsAsSentences(SHOT0, 'Snowy mountains. A lone figure walks left.')).toBeUndefined() // a verbless sentence of the original may stay
    expect(readsAsSentences(SHOT0, 'Figure walks left, carrying a spear.')).toBeUndefined() // a comma the original had
    expect(readsAsSentences('Tent interior. Fire glows.', 'Tent glows.')).toBeUndefined() // sintel-90-210 A2's recorded shortening
  })
  it('lets a verbless original stay verbless, without new list commas', () => {
    expect(readsAsSentences(CITY, 'Dense city under hazy sky.')).toBeUndefined()
    expect(readsAsSentences(CITY, 'City under hazy sky, central pyramid.')).toBeUndefined()
  })
})

describe('safeShorten with the sentence guard (DESC-028)', () => {
  it('g9 shot 14: Nova Lite\'s "City, central pyramid." is rejected for the deterministic sentence, which needs 5 words', async () => {
    expect(await safeShorten(CITY, 3, () => 'City, central pyramid.')).toBe('Dense city under hazy sky.') // 5 words: fit moves on
    expect(await safeShorten(CITY, 5, () => 'City, central pyramid.')).toBe('Dense city under hazy sky.')
  })
  it('g9 shot 26: a noun list is rejected for the deterministic sentence', async () => {
    expect(await safeShorten(CREATURE, 9, () => 'Scaled creature, horns, bloodied wing, stares.')).toBe('A scaled creature with horns and bloodied wing stares.')
  })
  it('a deterministic shortening that keeps only a subject is rejected too: the text comes back unshortened and fit moves on', async () => {
    expect(await safeShorten(CREATURE, 5, () => 'A scaled creature with horns.')).toBe(CREATURE) // deterministic at 5 is the same subject
    expect(await safeShorten(SHOT0, 2, () => 'Mountains.')).toBe('Mountains.') // a verbless sentence of the original: accepted (fail open)
  })
  it('German: a shortening without a verb the English heuristic would want is accepted', async () => {
    expect(await safeShorten('Ein Drache mit Hörnern starrt, während eine Hand greift.', 4, () => 'Ein Drache mit Hörnern.', 'de')).toBe('Ein Drache mit Hörnern.')
  })
  it('fit: shot 14 is not voiced as a fragment in a 3-word gap', async () => {
    const shot: Described = { index: 14, startMs: 60000, endMs: 63000, description: CITY, sameAsPrev: false, tokens: 0, outputTokens: 0 }
    const cues = await fit([shot], [{ startMs: 61119, endMs: 62829 + 300 }], (t, n) => safeShorten(t, n, () => 'City, central pyramid.'))
    expect(cues.map((c) => c.text)).not.toContain('City, central pyramid.')
  })
})

describe('editReadsAsSentences (the edit pass: words may be added and reordered)', () => {
  const FIT26 = 'A scaled creature with horns and bloodied wing stares.' // g9 cue 20: fit's text, which the edit pass turned into a list
  it('rejects the g9 edit of shot 26 and a verbless list', () => {
    expect(editReadsAsSentences(FIT26, 'Scaled creature, horns, bloodied wing, stares.', [CREATURE, FIT26])).toBe('new list comma after "creature"')
    expect(editReadsAsSentences(FIT26, 'A scaled creature with horns.', [CREATURE, FIT26])).toBe('no verb')
    expect(editReadsAsSentences(FIT26, 'Scaled creature. Gloved hand reaches toward it.', [CREATURE, FIT26])).toBe('verbless sentence: "Scaled creature."')
  })
  it('accepts folds, reworded sentences and a comma before a joining word or an -ing word', () => {
    const allowed = ['Red-haired girl watches man stir pot over fire.', 'Old man pours broth.']
    expect(editReadsAsSentences('Old man pours broth.', 'The man stirs a pot over the fire, then pours broth.', allowed)).toBeUndefined()
    expect(editReadsAsSentences(FIT26, 'A gloved hand reaches toward a scaled creature, which stares.', [CREATURE, FIT26])).toBeUndefined()
    expect(editReadsAsSentences('A figure walks, falls. Logo fades.', 'A figure walks, falls.', ['A figure walks, falls. Logo fades.'])).toBeUndefined() // a comma the source had
    expect(editReadsAsSentences('A figure walks.', 'A figure walks, holding a staff.', ['A figure walks.', 'A figure leans forward, holding a staff.'])).toBeUndefined()
  })
  it('lets a verbless sentence stay when the sources had it verbless', () => {
    expect(editReadsAsSentences('Snowy mountains. A figure walks.', 'Snowy mountains. The figure walks left.', ['Snowy mountains. A figure walks left.'])).toBeUndefined()
    expect(editReadsAsSentences(CITY, 'A dense city under a hazy sky.', [CITY])).toBeUndefined()
    expect(editReadsAsSentences(CITY, 'City, central pyramid.', [CITY])).toBe('new list comma after "city"')
  })
  it('PR #52 review: German edits pass the verb checks; a new semicolon list is rejected (L2, intended)', () => {
    expect(editReadsAsSentences('Ein Mann geht. Das Feuer brennt.', 'Ein Mann geht. Das Feuer brennt.', ['Ein Mann geht.', 'Das Feuer brennt.'], 'de')).toBeUndefined()
    expect(editReadsAsSentences('Ein Mann geht.', 'Ein Mann geht nach links.', ['Ein Mann geht nach links, etwas später.'], 'de')).toBeUndefined()
    expect(editReadsAsSentences('Old man pours broth.', 'Old man pours broth; woman smiles.', ['Red-haired woman smiles.', 'Old man pours broth.'])).toBe('new list comma after "broth"')
    expect(editReadsAsSentences('Two hands hold a red bowl.', 'Two hands hold the red bowl.', ['Two hands hold a red bowl; mist swirls inside.'])).toBeUndefined()
  })
})

// PR #52 review M3: an extended cue's cut to EXTENDED_WORDS goes through the same (fail-open) check
describe('extended cues (capExtended)', () => {
  const LONGMAN = 'A tall man in an olive coat and a burgundy scarf with a heavy pack on his back and a long spear in his right hand and an old sword at his side slowly kneels.' // 35 words, the verb last
  it('a cut that keeps only the subject is no cue: capExtended gives undefined, and fit drops the extended cue', async () => {
    expect(await capExtended(LONGMAN, shortenDeterministic)).toBeUndefined()
    expect(await capExtended(LONGMAN, shortenSentences)).toBeUndefined()
    const shot: Described = { index: 0, startMs: 0, endMs: 4000, description: `Night. ${LONGMAN}`, sameAsPrev: false, tokens: 0, outputTokens: 0 }
    expect(await fit([shot], [], (t, n) => safeShorten(t, n, () => ''))).toEqual([])
  })
  it('a cut that keeps a verb, or a text within the cap, is unchanged', async () => {
    expect(await capExtended('Snow falls.', shortenDeterministic)).toEqual({ text: 'Snow falls.', wordCount: 2 })
    const long = `${'Snow falls on the hills, '.repeat(6).trim()}`
    expect((await capExtended(long, shortenDeterministic))?.wordCount).toBeLessThanOrEqual(25)
    expect((await capExtended(LONGMAN, shortenDeterministic, 'de'))?.text).toBe('A man in an olive coat and a burgundy scarf with a pack on his back and a spear in his right hand.') // German: no verb check
  })
})
describe('sweep finds (PR #52 review re-run)', () => {
  it('a comma between leading adjectives does not end a clause: "A dark." is only a subject', () => {
    expect(readsAsSentences('A dark, complex airship floats over a misty city, viewed through a circular window, its lights glowing faintly.', 'A dark.')).toBe('no verb')
  })
})
