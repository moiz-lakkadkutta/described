import { readFileSync } from 'node:fs'
import type { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime'
import { applyEdits, cueEvidence, editBudgets, editScene, editWindows, EDIT_CHUNK_CUES, spokenNames, unfaithfulWords, type EditGuard } from '../src/steps/05b-edit'
import { editRequest, sceneRules, type EditConverse } from '../src/prompts'
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
const edShots = [sh(0, 32_000, 38_000, 'Cables around glowing panels. Two figures lie on platform.'), sh(1, 38_000, 44_000, 'The bald man in the coat stands, then steps forward as the other figure crawls.'), sh(2, 44_000, 50_000, 'Man blinks, turns head.')]
const cue = (shotIndex: number, startMs: number, text: string, extra: Partial<FitCue> = {}): FitCue => ({ startMs, endMs: startMs + 2000, text, extended: false, wordCount: text.split(/\s+/).length, shotIndex, limitMs: startMs + 5500, ...extra })
const edCues = [cue(0, 32_900, 'Cables around glowing panels. Two figures lie on platform.'), cue(1, 38_600, 'The bald man in the coat stands, then steps forward as the other figure crawls.'), cue(2, 44_700, 'Man blinks, turns head.')]
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
  it('sends the scene, the people (names only once revealed) and each cue\'s mayName; one call per scene', async () => {
    const sent: ConverseCommandInput[] = []
    await editScene(edCues, edShots, edWords, 'en', async (i) => { sent.push(i); return toolReply([])(i) }, undefined, noShorten, { scenes: edScenes, glossary: ED })
    expect(sent).toHaveLength(1)
    const input = JSON.parse((sent[0]!.messages![0]!.content![0] as { text: string }).text.replace(/^Input:\n/, '').replace(/\n\nUse the emit_edits tool[\s\S]*$/, ''))
    expect(input.scene).toEqual({ setting: 'the white chamber', looks: expect.stringContaining('cables'), returning: false, placeAlreadySaid: false })
    expect(input.people).toEqual([{ look: 'a bald old man with a long nose, in a long brown coat and a red tie' }, { look: expect.stringContaining('thin young man'), name: 'Emo', role: expect.any(String), namedFrom: 25.1 }])
    expect(input.cues.map((c: { mayName?: string[] }) => c.mayName)).toEqual([['Emo'], ['Emo'], ['Emo']])
    expect((sent[0]!.system![0] as { text: string }).text).toMatch(/8\. These cues are one scene, set in "the white chamber"[\s\S]*9\. People:[\s\S]*10\. Voice: guide the listener/)
  })
  it('the guard accepts a revealed name and the glossary look; rejects a name before it is revealed and an invented one', () => {
    const budgets = editBudgets(edCues).map((b) => b + 10)
    const ok = applyEdits(edCues, edShots, [{ cue: 2, text: 'Emo blinks, turns his head.' }], budgets, [0, 3], 'en', guard)
    expect(ok.rejected).toEqual([{ i: 2, text: 'Emo blinks, turns his head.', reason: 'not in any shot description: his' }]) // "his" is still a fact to trace
    expect(applyEdits(edCues, edShots, [{ cue: 2, text: 'Emo blinks, turns head.' }], budgets, [0, 3], 'en', guard).applied).toHaveLength(1)
    expect(applyEdits(edCues, edShots, [{ cue: 2, text: 'The thin young man blinks, turns head.' }], budgets, [0, 3], 'en', guard).applied).toHaveLength(1) // the glossary look
    expect(applyEdits(edCues, edShots, [{ cue: 1, text: 'Proog stands, then steps forward as the other figure crawls.' }], budgets, [0, 3], 'en', guard).rejected[0]!.reason).toBe('name not revealed or in no glossary or dialogue: Proog')
    expect(applyEdits(edCues, edShots, [{ cue: 2, text: 'Man blinks, turns head toward Jack.' }], budgets, [0, 3], 'en', guard).rejected[0]!.reason).toMatch(/^name not revealed or in no glossary or dialogue: Jack/)
    const early = [cue(0, 10_000, 'Man blinks, turns head.')]
    expect(applyEdits(early, edShots.slice(2).map((s) => ({ ...s, index: 0 })), [{ cue: 0, text: 'Emo blinks, turns head.' }], [20], [0, 1], 'en', guard).rejected[0]!.reason).toBe('name not revealed or in no glossary or dialogue: Emo')
  })
  it('the guard rejects an edit that says the scene\'s place again once a cue has said it', () => {
    const budgets = editBudgets(edCues).map((b) => b + 10)
    const stated = [cue(0, 32_900, 'The white chamber. Two figures lie on platform.'), edCues[1]!, edCues[2]!]
    expect(applyEdits(stated, edShots, [{ cue: 2, text: 'In the white chamber, man blinks, turns head.' }], budgets, [0, 3], 'en', guard).rejected[0]!.reason).toBe('says the scene\'s place again')
  })
  it('unfaithfulWords: glossary looks and places count as evidence, names only once revealed', () => {
    const gate = (atMs: number) => ({ glossary: ED, atMs, spoken: guard.spoken })
    expect(unfaithfulWords('The thin young man blinks.', ['Man blinks.'], gate(10_000))).toEqual([])
    expect(unfaithfulWords('Emo blinks.', ['Man blinks.'], gate(10_000))).toEqual(['emo'])
    expect(unfaithfulWords('Emo blinks.', ['Man blinks.'], gate(30_000))).toEqual([])
    expect(unfaithfulWords('Proog points.', ['Man points.'], gate(50_000))).toEqual(['proog'])
    expect(unfaithfulWords('The white chamber hums.', ['Man hums.'], gate(50_000))).toEqual([])
    expect(unfaithfulWords('The thin young man blinks.', ['Man blinks.'])).toEqual(['thin', 'young']) // without a gate, as before
  })
  it('grounding pass: a glossary name used before it is revealed becomes the look; every cue records its evidence', async () => {
    const early = [cue(0, 10_000, 'Proog stands on the platform.'), cue(1, 30_000, 'Emo crawls on the platform.')]
    const shots = [sh(0, 9000, 12_000, 'Proog stands on the platform.'), sh(1, 29_000, 32_000, 'Emo crawls on the platform.')]
    const scenes: Scene[] = [{ ...edScenes[0]!, shots: [0, 1], startMs: 9000, endMs: 32_000 }]
    const r = await editScene(early, shots, edWords, 'en', toolReply([]), undefined, noShorten, { scenes, glossary: ED })
    expect(r.cues.map((c) => c.text)).toEqual(['The bald old man stands on the platform.', 'Emo crawls on the platform.'])
    expect(r.applied).toEqual([{ i: 0, from: 'Proog stands on the platform.', to: 'The bald old man stands on the platform.', by: 'name' }])
    expect(r.evidence).toEqual([
      { i: 0, names: [], setting: { scene: 0, words: [{ word: 'platform', source: 'description', shot: 0 }] } },
      { i: 1, names: [{ name: 'Emo', source: 'glossary', revealedAtS: 25.1, evidence: expect.stringContaining('c3') }], setting: { scene: 0, words: [{ word: 'platform', source: 'description', shot: 0 }] } },
    ])
    expect(cueEvidence(0, cue(0, 40_000, 'A man named Jack waits.'), shots, guard)).toMatchObject({ unbacked: ['Jack'] })
  })
  it('without scenes or a glossary the request carries no scene, people or mayName, and no rules 8–10', () => {
    const req = editRequest({ language: 'en', cues: [{ i: 0, startMs: 0, text: 'A man walks.', wordCount: 3, budget: 3, extended: false, onScreenText: false, missed: [] }], dialogue: [] })
    const sys = (req.system![0] as { text: string }).text
    expect(sys).not.toMatch(/\n8\. |\n9\. |Voice:/)
    expect((req.messages![0]!.content![0] as { text: string }).text).not.toMatch(/"scene"|"people"|mayName/)
    expect(sceneRules(undefined, undefined)).toEqual([])
    expect(sceneRules({ setting: 'the lab', returning: true, placeAlreadySaid: false }, undefined).join('\n')).toContain('may open "Back in the lab"')
    expect(sceneRules({ setting: 'the lab', returning: false, placeAlreadySaid: true }, [])[0]).toContain('Do not say the place again.')
  })
  it('an empty glossary and no scenes leave the pass as it was (no name changes, no evidence of scenes)', async () => {
    const r = await editScene(edCues, edShots, [], 'en', toolReply([]), undefined, noShorten)
    expect(r.cues).toEqual(edCues)
    expect(r.evidence.every((e) => e.setting.scene === undefined)).toBe(true)
    expect(EMPTY_GLOSSARY.characters).toEqual([])
  })
})
