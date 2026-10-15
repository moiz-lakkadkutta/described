import { readFileSync } from 'node:fs'
import type { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime'
import { applyEdits, cueEvidence, editBudgets, editScene, editWindows, EDIT_CHUNK_CUES, spokenNames, unfaithfulWords, type EditGuard } from '../src/steps/05b-edit'
import type { EditConverse } from '../src/prompts'
import { fallbackScenes, finishScenes, type Scene } from '../src/steps/04c-scenes'
import { EMPTY_GLOSSARY, loadGlossary } from '../src/glossary'
import type { FitCue } from '../src/steps/05-fit'
import type { Described } from '../src/steps/04-describe'
import type { Word } from '../src/steps/03-speech'

type Reply = Awaited<ReturnType<EditConverse>>
const toolReply = (edits: unknown): EditConverse => async () => ({ output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 't', name: 'emit_edits', input: { edits } } }] } }, usage: { inputTokens: 500, outputTokens: 20 } }) as unknown as Reply
const fixture = <T>(f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')) as T
const noShorten = () => ''

// Elephants Dream (elephants-dream-0-60): "Emo," at 25.07 s (c3), "Emo." at 26.39 s (c4); Proog is never named in the segment.
const ED = loadGlossary('elephants-dream-0-60')
const at = (start: number, text: string, speaker: string): Word => ({ start, end: start + 0.4, text, speaker })
const edWords = [at(21.0, 'safe.', 'spk_0'), at(25.07, 'Emo,', 'spk_0'), at(26.39, 'Emo.', 'spk_1'), at(29.06, "What's", 'spk_1'), at(29.5, 'that.', 'spk_1')]
const sh = (index: number, startMs: number, endMs: number, description: string): Described => ({ index, startMs, endMs, description, sameAsPrev: false, tokens: 0, outputTokens: 0 })
const edShots = [sh(0, 32_000, 38_000, 'Cables around glowing panels. Two figures lie on platform.'), sh(1, 38_000, 44_000, 'The bald man in the coat stands, then steps forward as the other figure crawls.'), sh(2, 44_000, 50_000, 'Thin young man blinks, turns head.')]
const cue = (shotIndex: number, startMs: number, text: string, extra: Partial<FitCue> = {}): FitCue => ({ startMs, endMs: startMs + 2000, text, extended: false, wordCount: text.split(/\s+/).length, shotIndex, limitMs: startMs + 5500, ...extra })
const edCues = [cue(0, 32_900, 'Cables around glowing panels. Two figures lie on platform.'), cue(1, 38_600, 'The bald man in the coat stands, then steps forward as the other figure crawls.'), cue(2, 44_700, 'Thin young man blinks, turns head.')]
const edScenes: Scene[] = [{ id: 0, shots: [0, 1, 2], startMs: 32_000, endMs: 50_000, setting: 'the white chamber', settingName: 'the white chamber', returning: false, evidence: [{ word: 'chamber', source: 'glossary', setting: 'the white chamber' }] }]
const guard: EditGuard = { glossary: ED, spoken: spokenNames(edWords, 'en'), scenes: edScenes }

describe('edit pass with scenes and a glossary (DESC-029)', () => {
  it('spokenNames: each name with the first time the dialogue allows it', () => {
    expect(spokenNames(edWords, 'en')).toEqual([{ name: 'Emo', at: 26.79 }])
  })
  it('edits one scene at a time; without scenes, blocks of 30 cues as before', () => {
    const r2 = fixture<FitCue[]>('sintel-90-150-r2.cues.fit.json'), shots = fixture<Described[]>('sintel-90-150-r2.described.json')
    const g = loadGlossary('sintel-90-150-r2')
    const scenes = finishScenes(fallbackScenes(shots, g), shots, g)
    const w = editWindows(r2, scenes)
    expect(w.map(([a, b]) => r2.slice(a, b).map((c) => c.shotIndex))).toEqual([r2.filter((c) => c.shotIndex <= 1).map((c) => c.shotIndex), r2.filter((c) => c.shotIndex >= 2).map((c) => c.shotIndex)])
    expect(editWindows(r2)).toEqual([[0, r2.length]])
    const many = Array.from({ length: 65 }, (_, k) => cue(0, k * 1000, 'A man walks.'))
    expect(editWindows(many, [{ ...edScenes[0]!, shots: [0] }])).toEqual([[0, EDIT_CHUNK_CUES], [EDIT_CHUNK_CUES, 2 * EDIT_CHUNK_CUES], [2 * EDIT_CHUNK_CUES, 65]])
  })
  it('sends the scene opening, the people (looks and short form; names only once revealed; never roles) and each cue\'s mayName; one call per scene', async () => {
    const sent: ConverseCommandInput[] = []
    await editScene(edCues, edShots, edWords, 'en', async (i) => { sent.push(i); return toolReply([])(i) }, undefined, noShorten, { scenes: edScenes, glossary: ED })
    expect(sent).toHaveLength(1)
    const input = JSON.parse((sent[0]!.messages![0]!.content![0] as { text: string }).text.replace(/^Input:\n/, '').replace(/\n\nReply with the JSON object only\.$/, ''))
    expect(input.cues[0].newScene).toEqual({ place: 'the white chamber' }) // the scene's first cue; not returning
    expect(input.cues[1].newScene).toBeUndefined()
    expect(input.people).toEqual([{ look: 'a bald old man with a long nose, in a long brown coat and a red tie', short: expect.any(String) }, { look: expect.stringContaining('thin young man'), short: expect.any(String), name: 'Emo' }])
    for (const c of ED.characters) expect(JSON.stringify(sent[0])).not.toContain(c.role) // never the role (0012)
    expect(input.cues.map((c: { mayName?: string[] }) => c.mayName)).toEqual([['Emo'], ['Emo'], ['Emo']])
    expect((sent[0]!.system![0] as { text: string }).text).toMatch(/"Back in …" only when it is returning/)
  })
  it('the guard accepts a revealed name on a shot that shows that person, and the look; rejects a premature, unbound or invented name', () => {
    const budgets = editBudgets(edCues).map((b) => b + 10)
    const edit = (i: number, text: string) => applyEdits(edCues, edShots, [{ cue: i, text }], budgets, [0, 3], 'en', guard)
    expect(edit(2, 'Emo blinks, turns his head.').rejected).toEqual([{ i: 2, text: 'Emo blinks, turns his head.', reason: 'not in any shot description: his' }]) // "his" is still a fact to trace
    expect(edit(2, 'Emo blinks, turns head.').applied).toHaveLength(1) // shot 2 shows the thin young man
    expect(edit(2, 'The thin young man in a pale green shirt blinks, turns head.').applied).toHaveLength(1) // his look: shot 2 shows him
    const noDialogue = (i: number, text: string) => applyEdits(edCues, edShots, [{ cue: i, text }], budgets, [0, 3], 'en', { ...guard, spoken: [] })
    expect(noDialogue(1, 'The bald man in the coat stands, then steps forward as the other figure, Emo, crawls.').rejected[0]!.reason).toMatch(/^name not revealed, not shown in its shots/) // shot 1 never shows him by look
    expect(edit(1, 'The bald man in the coat stands, then steps forward as the other figure, Emo, crawls.').rejected.map((r) => r.reason)).toEqual(['not a sentence: new list comma after "figure"']) // the dialogue has said "Emo" by then: no name rejection (only #52's sentence guard)
    expect(edit(1, 'The bald man in the coat stands, then steps forward as the thin young man crawls.').rejected[0]!.reason).toMatch(/not in any shot description: thin, young/) // nor his look
    expect(edit(1, 'Proog stands, then steps forward as the other figure crawls.').rejected[0]!.reason).toMatch(/: Proog$/)
    expect(edit(2, 'Thin young man blinks, turns head toward Jack.').rejected[0]!.reason).toMatch(/: Jack$/)
    const early = [cue(0, 10_000, 'Thin young man blinks, turns head.')]
    expect(applyEdits(early, edShots.slice(2).map((x) => ({ ...x, index: 0 })), [{ cue: 0, text: 'Emo blinks, turns head.' }], [20], [0, 1], 'en', guard).rejected[0]!.reason).toMatch(/Emo/)
    for (const c of ED.characters) expect(edit(2, `Thin young man blinks, turns head, ${c.role.split(' ').slice(-2).join(' ')}.`).applied).toHaveLength(0) // a role is never words in a cue
  })
  it('a proper noun a missed shot\'s description says is grounded there (folded into the next cue)', () => {
    const shots = [sh(0, 0, 3000, 'A man waits.'), sh(1, 3000, 6000, 'Words appear: CAMP. A man walks past the Eiffel Tower.'), sh(2, 6000, 9000, 'A man sits.')]
    const cues = [cue(0, 100, 'A man waits.'), cue(2, 6100, 'A man sits.')]
    const g: EditGuard = { glossary: EMPTY_GLOSSARY, spoken: [] }
    const r = applyEdits(cues, shots, [{ cue: 1, text: 'A man walks past the Eiffel Tower, then sits.' }], [20, 20], [0, 2], 'en', g)
    expect(r.rejected).toEqual([])
    expect(applyEdits(cues, shots, [{ cue: 1, text: 'A man walks past the Louvre, then sits.' }], [20, 20], [0, 2], 'en', g).rejected[0]!.reason).toMatch(/: Louvre$/)
  })
  it('Tears of Steel probe: on the sniper\'s shot, Thom, the bridge and the sniper\'s look on him are all rejected', () => {
    const tos = loadGlossary('tears-of-steel-40-100')
    const shots = fixture<Described[]>('tears-of-steel-40-100.described.json'), fitCues = fixture<FitCue[]>('tears-of-steel-40-100.cues.fit.json')
    const scenes = finishScenes(fallbackScenes(shots, tos), shots, tos)
    const g: EditGuard = { glossary: tos, spoken: [], scenes }
    const i = fitCues.findIndex((c) => c.shotIndex === 11) // "Man in dark jacket aims rifle from balcony."
    const budgets = fitCues.map(() => 30)
    const reason = (text: string) => applyEdits(fitCues, shots, [{ cue: i, text }], budgets, [0, fitCues.length], 'en', g).rejected[0]?.reason
    expect(reason('Thom argues in a dark padded jacket beside the canal bridge.')).toMatch(/^name not revealed, not shown in its shots.*: Thom$/)
    expect(reason('Thom aims rifle from balcony.')).toMatch(/: Thom$/)
    expect(reason('Man in dark jacket aims rifle beside the canal bridge.')).toMatch(/not in any shot description:.*canal, bridge/) // another scene's place
    expect(reason('The man in a dark padded jacket aims a scoped rifle from the balcony.')).toBeUndefined() // the sniper's own look, on his shot
  })
  it('the guard rejects an edit that says the scene\'s place again once a cue has said it', () => {
    const budgets = editBudgets(edCues).map((b) => b + 10)
    const stated = [cue(0, 32_900, 'The white chamber. Two figures lie on platform.'), edCues[1]!, edCues[2]!]
    expect(applyEdits(stated, edShots, [{ cue: 2, text: 'In the white chamber, man blinks, turns head.' }], budgets, [0, 3], 'en', guard).rejected[0]!.reason).toBe('says the scene\'s place again')
  })
  it('unfaithfulWords: a look only where the shots show that person, a place only in its scene, a name only once revealed, never a role', () => {
    const gate = (atMs: number, shots: string[] = ['Thin young man blinks.'], extra: string[] = []) => ({ glossary: ED, atMs, spoken: guard.spoken, shots, extra })
    expect(unfaithfulWords('The thin young man in a pale green shirt blinks.', ['Thin young man blinks.'], gate(10_000))).toEqual([])
    expect(unfaithfulWords('The man in a pale green shirt blinks.', ['Man blinks.'], gate(10_000, ['Man blinks.']))).toEqual(['pale', 'green', 'shirt']) // no shot shows which man
    expect(unfaithfulWords('Emo blinks.', ['Thin young man blinks.'], gate(10_000))).toEqual(['emo'])
    expect(unfaithfulWords('Emo blinks.', ['Thin young man blinks.'], gate(30_000))).toEqual([])
    expect(unfaithfulWords('Proog points.', ['Man points.'], gate(50_000, ['Man points.']))).toEqual(['proog'])
    expect(unfaithfulWords('The white chamber hums.', ['Man hums.'], gate(50_000, ['Man hums.']))).toEqual(['white', 'chamber']) // no scene given
    expect(unfaithfulWords('The white chamber hums.', ['Man hums.'], gate(50_000, ['Man hums.'], ['the white chamber']))).toEqual([])
    expect(unfaithfulWords('The thin young man, leading, blinks.', ['Thin young man blinks.'], gate(30_000))).toEqual(['leading']) // a role word
    expect(unfaithfulWords('The thin young man blinks.', ['Man blinks.'])).toEqual(['thin', 'young']) // without a gate, as before
  })
  it('grounding pass: a glossary name used before it is revealed becomes the look; every cue records its evidence', async () => {
    const early = [cue(0, 10_000, 'Proog stands on the platform.'), cue(1, 30_000, 'The thin young man, Emo, crawls on the platform.'), cue(2, 40_000, 'Emo stands on the platform.')]
    const shots = [sh(0, 9000, 12_000, 'Proog stands on the platform.'), sh(1, 29_000, 32_000, 'The thin young man, Emo, crawls on the platform.'), sh(2, 39_000, 42_000, 'Emo stands on the platform.')]
    const scenes: Scene[] = [{ ...edScenes[0]!, shots: [0, 1, 2], startMs: 9000, endMs: 42_000 }]
    const r = await editScene(early, shots, edWords, 'en', toolReply([]), undefined, noShorten, { scenes, glossary: ED })
    // Proog: not revealed, becomes the short reference. Emo at 40 s: revealed, and the describer wrote the name in shot 2 itself: kept.
    expect(r.cues.map((c) => c.text)).toEqual(['The bald old man stands on the platform.', 'The thin young man, Emo, crawls on the platform.', 'Emo stands on the platform.'])
    expect(r.applied).toEqual([{ i: 0, from: 'Proog stands on the platform.', to: 'The bald old man stands on the platform.', by: 'name' }])
    // A name fit or edit put on a shot that neither names nor shows him (and no dialogue): the short reference.
    const added = await editScene([cue(0, 40_000, 'Emo stands on the platform.')], [sh(0, 39_000, 42_000, 'A man stands on the platform.')], [], 'en', toolReply([]), undefined, noShorten, { scenes: [{ ...edScenes[0]!, shots: [0] }], glossary: ED })
    expect(added.cues[0]!.text).toBe('The thin young man stands on the platform.')
    const keeps = await editScene([cue(0, 40_000, 'The old man pulls Emo.')], [sh(0, 39_000, 42_000, 'The old man pulls Emo.')], [], 'en', toolReply([]), undefined, noShorten, { scenes: [{ ...edScenes[0]!, shots: [0] }], glossary: ED })
    expect(keeps.cues[0]!.text).toBe('The old man pulls Emo.')
    expect(r.evidence[1]).toEqual({ i: 1, names: [{ name: 'Emo', source: 'glossary', revealedAtS: 25.1, evidence: expect.stringContaining('c3') }], setting: { scene: 0, words: [{ word: 'platform', source: 'description', shot: 0 }] } })
    expect(cueEvidence(0, cue(0, 40_000, 'A man named Jack waits.'), shots, guard)).toMatchObject({ unbacked: ['Jack'] })
  })
  it('without scenes or a glossary the request carries no scene opening and no people; mayName is empty', async () => {
    const sent: ConverseCommandInput[] = []
    await editScene(edCues, edShots, [], 'en', async (i) => { sent.push(i); return toolReply([])(i) }, undefined, noShorten)
    const text = (sent[0]!.messages![0]!.content![0] as { text: string }).text
    expect(text).not.toMatch(/"newScene"|"people"/)
    expect(text).toContain('"mayName":[]')
  })
  it('an empty glossary and no scenes leave the pass as it was (no name changes, no evidence of scenes)', async () => {
    const r = await editScene(edCues, edShots, [], 'en', toolReply([]), undefined, noShorten)
    expect(r.cues).toEqual(edCues)
    expect(r.evidence.every((e) => e.setting.scene === undefined)).toBe(true)
    expect(EMPTY_GLOSSARY.characters).toEqual([])
  })
})
