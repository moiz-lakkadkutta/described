import { inOrder, originalVerbs, readsAsSentences } from '../src/sentenceGuard'
import { fit, safeShorten } from '../src/steps/05-fit'
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
    expect(originalVerbs('Flames rise from the roof.')).toEqual([]) // a sentence's first word is its subject; "rise" is not an -s form (a limit)
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
  it('rejects a shortening that keeps none of the original\'s verbs', () => {
    expect(readsAsSentences(SHOT0, 'Snowy mountains.')).toBe('no verb')
    expect(readsAsSentences(CREATURE, 'A scaled creature with horns.')).toBe('no verb')
    expect(readsAsSentences(CREATURE, 'Scaled creature. Hand reaches.')).toBe('verbless sentence: "Scaled creature."')
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
  it('a deterministic shortening that drops every verb is rejected too: the text comes back unshortened and fit moves on', async () => {
    expect(await safeShorten(SHOT0, 2, () => 'Mountains.')).toBe(SHOT0)
    expect(await safeShorten(SHOT0, 6, () => 'Snowy mountains.')).toBe(SHOT0) // deterministic at 6 is "Snowy mountains." too
    expect(await safeShorten(SHOT0, 7, () => 'Snowy mountains.')).toBe('Snowy mountains. A lone figure walks left.')
  })
  it('fit: shot 14 is not voiced as a fragment in a 3-word gap', async () => {
    const shot: Described = { index: 14, startMs: 60000, endMs: 63000, description: CITY, sameAsPrev: false, tokens: 0, outputTokens: 0 }
    const cues = await fit([shot], [{ startMs: 61119, endMs: 62829 + 300 }], (t, n) => safeShorten(t, n, () => 'City, central pyramid.'))
    expect(cues.map((c) => c.text)).not.toContain('City, central pyramid.')
  })
})
