import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { allowedNames, loadGlossary, nameEvidence, nameWithheld, neutralOf, peopleAndPlaces, withoutName, withoutWithheldNames, type Glossary } from '../src/glossary'
import { describeSystemPrompt } from '../src/prompts'
import { withoutWithheld, type FitCue } from '../src/steps/05-fit'
import { editScene } from '../src/steps/05b-edit'
import type { EditConverse } from '../src/prompts'
import type { Described } from '../src/steps/04-describe'

/**
 * Name windows (decision 0012 amendment "Name windows", 2026-10-15): a character's unnamedIn ranges, where the name is never used
 * whatever the look match, the describer or the dialogue. The fixture is the full-length `sintel` run of DESC-036
 * (packages/pipeline/work/sintel): the describer (Qwen3-VL, described.json) wrote "Scales" on the horned dragon's swoop (shots 72, 75)
 * and on the baby dragon at the end (shots 169, 170); verify kept it, fit and the edit pass passed it because the describer's own
 * name binds (nameEvidence), and four cues were published with it.
 */
interface Fixture { shots: Described[]; fitCues: FitCue[]; published: { startMs: number; shotIndex: number; text: string }[]; words: { start: number; end: number; text: string }[] }
const fx = JSON.parse(readFileSync(new URL('./fixtures/sintel-full.name-windows.json', import.meta.url), 'utf8')) as Fixture
const shots = fx.shots.map((s) => ({ ...s, tokens: 0, outputTokens: 0 }))
const SINTEL = loadGlossary('sintel')
const scales = SINTEL.characters.find((c) => c.name === 'Scales')!
const before: Glossary = { ...SINTEL, characters: SINTEL.characters.map(({ unnamedIn: _, ...c }) => c) } // the glossary of the DESC-036 run
const spoken = [{ name: 'Scales', at: 250.86 }] // Transcribe's first "Scales," (words.json), as spokenNames gives it
const shot = (i: number) => shots.find((s) => s.index === i)!
const fitCue = (shotIndex: number) => fx.fitCues.find((c) => c.shotIndex === shotIndex && !c.extended)!

/** The four published cues, and what they say once the name is withheld. */
const CASES = [
  { at: '5:22.3', shot: 72, startMs: 322_275, after: 'The dragon soars through pink clouds toward a ruined town where a young woman stands.' },
  { at: '5:29.6', shot: 75, startMs: 329_625, after: 'The dragon flies toward a reaching hand.' },
  { at: '12:10.8', shot: 169, startMs: 730_750, after: 'The dragon lies on the rocky ground, its wing bleeding, as Sintel walks farther away.' },
  { at: '12:18.1', shot: 170, startMs: 738_100, after: 'Back in the snowy mountains, the dragon lies still on the rocky ground as Sintel walks farther away into the hazy distance.' },
]

describe('sintel glossary: where Scales is never named', () => {
  it('withholds Scales over the swoop, in the cave and at the end, and nowhere he is on screen as the small tan dragon', () => {
    expect(scales.unnamedIn?.map((w) => [w.fromS, w.toS])).toEqual([[315, 331], [483.7, 684.4], [724, 745]])
    for (const c of CASES) expect(nameWithheld(scales, c.startMs), c.at).toBe(true)
    // the shots involved, whole: the swoop 71–75, the lair (shot 127, "The small tan dragon, Scales, walks across the cave floor."),
    // "Scales?" to the grey dragon (10:21.6), the ending 168–170
    for (const i of [71, 72, 73, 74, 75, 121, 123, 127, 168, 169, 170]) expect(nameWithheld(scales, shot(i).startMs, shot(i).endMs), `shot ${i}`).toBe(true)
    expect(nameWithheld(scales, 621_600)).toBe(true)
    // Scales himself: asleep beside her (4:02), on the beam (4:33, 4:43), before the swoop (5:12)
    for (const i of [62, 60, 69]) expect(nameWithheld(scales, shot(i).startMs, shot(i).endMs), `shot ${i}`).toBe(false)
    expect(nameWithheld(scales, 242_187)).toBe(false)
  })
})

describe('the describe prompt (04-describe)', () => {
  it('does not offer the name for a shot in a range, even one the dialogue has said; it does outside', () => {
    const s72 = shot(72)
    const names = allowedNames(SINTEL, s72.startMs, ['Scales'], s72.endMs)
    expect(names).toEqual([]) // Sintel is not revealed until 7:37.8
    const people = peopleAndPlaces(SINTEL, s72.startMs, s72.endMs)
    expect(people).not.toContain('call them Scales')
    expect(people).toContain(`- ${scales.look} (not named in this shot: describe by what is visible, never by a name, even one the dialogue has said)`)
    const prompt = describeSystemPrompt({ maxWords: 15, knownNames: names, language: 'en', people })
    expect(prompt).toContain('Known names so far: none.')
    expect(prompt).not.toMatch(/call them Scales/)
    // a shot that only overlaps a range is in it (shot 70, 312.6–315.6 s, touches the swoop at 315 s)
    expect(allowedNames(SINTEL, shot(70).startMs, ['Scales'], shot(70).endMs)).toEqual([])
    // Scales on the beam (shot 62, 4:38.8): offered, bound to the look
    const s62 = shot(62)
    expect(allowedNames(SINTEL, s62.startMs, ['Scales'], s62.endMs)).toEqual(['Scales'])
    expect(peopleAndPlaces(SINTEL, s62.startMs, s62.endMs)).toContain('call them Scales (the first time: "the small tan dragon, Scales")')
  })
})

describe('binding override (nameEvidence)', () => {
  it('a name the describer wrote inside a range is withheld, not bound; outside it, the describer\'s name still binds', () => {
    for (const c of CASES) {
      const own = [shot(c.shot).description]
      expect(own[0], c.at).toMatch(/\bScales\b/) // the describer wrote it
      const was = nameEvidence(fitCue(c.shot).text, c.startMs, before, spoken, own)
      expect(was.names.map((n) => n.name), c.at).toContain('Scales') // why the run published it
      const now = nameEvidence(fitCue(c.shot).text, c.startMs, SINTEL, spoken, own)
      expect(now.withheld, c.at).toEqual(['Scales'])
      expect(now.names.map((n) => n.name), c.at).not.toContain('Scales')
      expect([...now.unbound, ...now.premature, ...now.invented], c.at).not.toContain('Scales')
    }
    const beam = nameEvidence(fitCue(62).text, fitCue(62).startMs, SINTEL, spoken, [shot(62).description])
    expect(beam.names.map((n) => n.name)).toEqual(['Scales'])
    expect(beam.withheld).toEqual([])
  })
  it('overrides the dialogue: "Scales?" said to the grey dragon (10:21.6) never names it', () => {
    const check = nameEvidence('Scales lies still in the cave.', 626_619, SINTEL, [{ name: 'Scales', at: 622.1 }], ['A huge dark grey dragon rests in the cave.'])
    expect(check.withheld).toEqual(['Scales'])
    expect(check.names).toEqual([])
  })
})

describe('withoutName, withheld: the neutral reference', () => {
  it('is "the" and the look\'s kind noun, and takes an appositive look phrase with the name', () => {
    expect(neutralOf(scales)).toBe('the dragon')
    for (const c of CASES) expect(withoutName(fitCue(c.shot).text, 'Scales', SINTEL, { withheld: true }), c.at).toBe(c.after)
    expect(withoutName('Sintel holds the small tan dragon, Scales.', 'Scales', SINTEL, { withheld: true })).toBe('Sintel holds the dragon.')
    expect(withoutName('The girl sees the dragon, Scales, and runs.', 'Scales', SINTEL, { withheld: true })).toBe('The girl sees the dragon and runs.')
    expect(withoutName('Words appear: "Scales". Scales sleeps.', 'Scales', SINTEL, { withheld: true })).toBe('Words appear: "Scales". The dragon sleeps.')
    // not withheld: the editor's short, as before
    expect(withoutName('Scales sleeps.', 'Scales', SINTEL)).toBe('The small tan dragon sleeps.')
  })
  it('takes a possessive with the name: Scales\', Scales\'s and Scales’s become "the dragon\'s" (review of #80)', () => {
    for (const p of ["Scales'", "Scales's", 'Scales’s']) {
      expect(withoutName(`The girl strokes ${p} wing.`, 'Scales', SINTEL, { withheld: true })).toBe("The girl strokes the dragon's wing.")
      expect(withoutName(`${p} wing bleeds.`, 'Scales', SINTEL, { withheld: true })).toBe("The dragon's wing bleeds.")
    }
    expect(withoutName("Scales' wing bleeds.", 'Scales', SINTEL)).toBe("The small tan dragon's wing bleeds.")
    expect(withoutName('Scales sleeps.', 'Scales', SINTEL, { withheld: true })).toBe('The dragon sleeps.') // no possessive: none added
  })
  it('withoutWithheldNames leaves a text outside every range alone', () => {
    expect(withoutWithheldNames(fitCue(62).text, SINTEL, fitCue(62).startMs)).toBe(fitCue(62).text)
  })
})

describe('the four published cues (full-length sintel, DESC-036)', () => {
  it('were published with Scales', () => {
    expect(fx.published.filter((p) => CASES.some((c) => c.startMs === p.startMs)).map((p) => p.text)).toEqual([
      'The small tan dragon, Scales, soars through pink clouds toward a ruined town where a young woman stands.',
      'The small tan dragon, Scales, flies toward a reaching hand.',
      'The small tan dragon, Scales, lies on the rocky ground, its wing bleeding, as Sintel walks farther away.',
      'Back in the snowy mountains, Scales lies still on the rocky ground as Sintel walks farther away into the hazy distance.',
    ])
  })
  it('fit: the name is gone, and no cue moves (the slot and estimated end stay)', () => {
    const out = withoutWithheld(fx.fitCues, shots, SINTEL)
    for (const c of CASES) {
      const k = fx.fitCues.findIndex((x) => x.startMs === c.startMs)
      expect(out[k]!.text, c.at).toBe(c.after)
      expect({ ...out[k]!, text: '', wordCount: 0 }).toEqual({ ...fx.fitCues[k]!, text: '', wordCount: 0 })
    }
    const others = out.filter((c) => !CASES.some((x) => x.startMs === c.startMs))
    expect(others).toEqual(fx.fitCues.filter((c) => !CASES.some((x) => x.startMs === c.startMs)))
    expect(out.find((c) => c.shotIndex === 62)!.text).toBe('The small tan dragon, Scales, perches on a wooden beam, watching birds fly across the sky.')
  })
  it('edit, final pass: from the run\'s own fit cues (names in them), the four are replaced and the edit guard rejects the name in a range', async () => {
    const shot70 = fx.fitCues.findIndex((c) => c.shotIndex === 70)
    const send: EditConverse = async () => ({ output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 't', name: 'emit_edits', input: { edits: [{ cue: shot70, text: 'A young woman with short red hair looks up as Scales flies past at sunset.' }] } } }] } }, usage: { inputTokens: 0, outputTokens: 0 } }) as unknown as Awaited<ReturnType<EditConverse>>
    const words = fx.words.map((w) => ({ ...w, speaker: 'spk_0' }))
    const r = await editScene(fx.fitCues, shots, words, 'en', send, undefined, () => '', { glossary: SINTEL })
    for (const c of CASES) expect(r.cues.find((x) => x.startMs === c.startMs)!.text, c.at).toBe(c.after)
    expect(r.applied.filter((a) => a.by === 'name').map((a) => a.to)).toEqual(CASES.map((c) => c.after))
    expect(r.rejected.find((x) => x.i === shot70)?.reason).toMatch(/withheld here.*Scales/)
    expect(r.cues.find((c) => c.shotIndex === 62)!.text).toMatch(/Scales/)
    expect(r.cues.filter((c) => /Scales/.test(c.text)).map((c) => c.shotIndex)).toEqual([62])
  })
})
