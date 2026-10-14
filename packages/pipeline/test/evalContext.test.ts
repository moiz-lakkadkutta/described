import { readFileSync } from 'node:fs'
import { assign, evaluateContext, mentions, reportMarkdown, statesWhere, whereStems, wordsFromVtt, type AnnotatedScene, type EvalCue } from '../src/evalContext'
import { loadGlossary } from '../src/glossary'
import { spokenNames } from '../src/steps/05b-edit'

const published = JSON.parse(readFileSync(new URL('../../../docs/eval/published-cues-2026-10-14.json', import.meta.url), 'utf8')) as Array<EvalCue & { slug: string }>
const annotations = JSON.parse(readFileSync(new URL('../../../docs/eval/scene-annotations.json', import.meta.url), 'utf8')) as Record<string, AnnotatedScene[]>
const cuesOf = (slug: string) => published.filter((c) => c.slug === slug)

describe('evaluateContext (DESC-029)', () => {
  it('finds person phrases and gives each to the character whose look it shares', () => {
    expect(mentions('Bearded man holds staff. Red-haired woman watches.')).toEqual(['bearded man', 'red-haired woman'])
    expect(mentions('Two figures lie on platform.')).toEqual([]) // plural: not one character
    expect(mentions('A man in a dark jacket gestures.')).toEqual(['man in a dark jacket'])
    expect(mentions('Words appear: THE MAN. Ship deck. Figure kneels.')).toEqual(['figure'])
    const sintel = loadGlossary('sintel-90-150-r2'), ed = loadGlossary('elephants-dream-0-60')
    expect(assign('bearded man', sintel)).toBe('Shaman')
    expect(assign('red-haired girl', sintel)).toBe('Sintel')
    expect(assign('lone figure', sintel)).toBe('Sintel') // her look has "a small lone figure"
    expect(assign('bald man', ed)).toBe('Proog')
    expect(assign('man', ed)).toBeUndefined() // two men, nothing to tell them apart
  })
  it('a cue states the place with the setting\'s name words, a where-noun, or a setting statement', () => {
    const g = loadGlossary('sintel-90-150-r2')
    expect(statesWhere('Tent glows.', 'the tent', g)).toBe(true)
    expect(statesWhere('A faint fire glows in a stone pit.', 'the tent', g)).toBe(false)
    expect(statesWhere('Snowy mountains. A lone figure walks left.', 'the snowy mountains', g)).toBe(true)
    expect(whereStems('Cables around glowing panels. Two figures lie on platform.', 'the white chamber', loadGlossary('elephants-dream-0-60'))).toEqual(['cabl', 'panel'])
  })
  it('reports invented and premature names, and names voiced with their evidence', () => {
    const ed = loadGlossary('elephants-dream-0-60')
    const spoken = spokenNames(wordsFromVtt(readFileSync(new URL('./fixtures/sdh/elephants-dream-0-60.captions.vtt', import.meta.url), 'utf8')), 'en')
    expect(spoken.map((s) => s.name)).toEqual(['Emo'])
    const r = evaluateContext({ cues: [{ startMs: 10_000, text: 'Emo runs.' }, { startMs: 40_000, text: 'Emo crawls toward Jack. Proog waits.' }], glossary: ed, spoken, scenes: [] })
    expect(r.prematureNames).toEqual([{ atS: 10, name: 'Emo' }, { atS: 40, name: 'Proog' }])
    expect(r.inventedNames).toEqual([{ atS: 40, name: 'Jack' }])
    expect(r.namesUsed).toEqual([{ atS: 40, name: 'Emo', source: 'glossary' }])
  })
  it('baseline on the published cues of 2026-10-14 (docs/eval/character-scene-baseline.md)', () => {
    const run = (slug: string) => evaluateContext({ cues: cuesOf(slug), glossary: loadGlossary(slug), scenes: annotations[slug]! })
    const sintel = run('sintel-90-150-r2')
    expect(sintel.descriptors).toEqual({ Sintel: ['lone figure', 'figure', 'red-haired girl'], Shaman: ['bearded man', 'old man'] })
    expect([sintel.firstCueStatesPlace, sintel.changesSignalled, sintel.repeatedSettings]).toEqual([{ yes: 1, of: 2 }, { yes: 0, of: 1 }, 0]) // the tent is never established at its start
    const cam = run('caminandes-35-95')
    expect(cam.descriptors.Koro).toEqual(['tan llama', 'brown llama', 'llama'])
    expect(cam.unassigned).toEqual(['orange fox', 'fox']) // the llama, given a second identity
    for (const slug of Object.keys(annotations).filter((k) => k !== '_note')) expect(run(slug).inventedNames, slug).toEqual([])
    expect(reportMarkdown('sintel-90-150-r2', sintel)).toContain('| Scenes whose first cue states the place | 1 of 2 |')
  })
})
