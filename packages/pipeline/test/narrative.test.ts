import { readFileSync } from 'node:fs'
import type { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime'
import { applyEdits, editBudgets, editScene, EDIT_WPS, mustStillSay, type EditGuard } from '../src/steps/05b-edit'
import { carriedLook, charRefs, excusedByCarry, faithfulText, pronounProblems, referentWindow, unsourcedContinuity, type NarrativeView } from '../src/narrative'
import { checkVerified } from '../src/steps/04b-verify'
import { editReadsAsSentences, readsAsSentences } from '../src/sentenceGuard'
import { STEPS } from '../src/steps'
import { loadGlossary, type Glossary } from '../src/glossary'
import { isTextCue } from '../src/steps/05b-edit'
import { rateFactor } from '../src/voiceProfile'
import type { EditConverse } from '../src/prompts'
import type { FitCue } from '../src/steps/05-fit'
import type { Described } from '../src/steps/04-describe'
import type { Scene } from '../src/steps/04c-scenes'

// The narrative pass (decision 0017): its own guards on top of 05b's, the request, and the reply. Pairs from the spike
// (docs/spikes/narrative-pass-sintel.md, DeepSeek v3.2 on full-length Sintel) where they exist.

const SINTEL = loadGlossary('sintel')
type Reply = Awaited<ReturnType<EditConverse>>
const textReply = (text: string): EditConverse => async () => ({ output: { message: { role: 'assistant', content: [{ text }] } }, usage: { inputTokens: 100, outputTokens: 10 } }) as unknown as Reply
const json = (cues: { cue: number; text: string }[]) => textReply(JSON.stringify({ cues }))
const noShorten = () => ''

/** A run of cues, one per shot, 3 s apart; the shot description is the cue's text unless given. */
function title(texts: readonly string[], o: { startMs?: number; gapMs?: number; descriptions?: readonly (string | undefined)[]; scenes?: (shots: number[]) => Scene[] } = {}) {
  const start = o.startMs ?? 180_000, gap = o.gapMs ?? 3000
  const cues: FitCue[] = texts.map((t, i) => ({ startMs: start + i * gap, endMs: start + i * gap + 2000, text: t, extended: false, wordCount: t.split(/\s+/).length, shotIndex: i, limitMs: start + i * gap + gap - 100 }))
  const shots: Described[] = texts.map((t, i) => ({ index: i, startMs: start + i * gap, endMs: start + (i + 1) * gap, description: o.descriptions?.[i] ?? t, sameAsPrev: false, tokens: 0, outputTokens: 0 }))
  const ids = texts.map((_, i) => i)
  const scenes = o.scenes ? o.scenes(ids) : [{ id: 0, shots: ids, startMs: start, endMs: start + texts.length * gap, setting: 'the town', settingName: 'the town', returning: false, evidence: [] }]
  return { cues, shots, scenes }
}
const roomy = (cues: readonly FitCue[]) => cues.map((c) => c.wordCount + 20)
function edit(t: ReturnType<typeof title>, i: number, text: string, o: { glossary?: Glossary; scenes?: Scene[] | null; current?: FitCue[] } = {}) {
  const guard: EditGuard = { glossary: o.glossary ?? SINTEL, spoken: [], scenes: o.scenes === null ? undefined : (o.scenes ?? t.scenes), narrative: true, current: o.current ?? t.cues }
  return applyEdits(t.cues, t.shots, [{ cue: i, text }], roomy(t.cues), [i, i + 1], 'en', guard)
}
const reasons = (r: ReturnType<typeof edit>) => r.rejected.map((x) => x.reason)

const WOMAN = 'A young woman with short red hair runs across a rooftop.'
const DRAGON = 'A small tan dragon with a bleeding wing lies on a stone roof.'

describe('pronoun licence', () => {
  it('a new "she" is licensed by a woman in the previous cue of the same scene, within 20 s (spike cue 24)', () => {
    const t = title([WOMAN, 'A young woman with short red hair climbs a rooftop.'])
    expect(edit(t, 1, 'Then she climbs a rooftop.').applied).toEqual([{ i: 1, from: t.cues[1]!.text, to: 'Then she climbs a rooftop.' }])
  })
  it('two cues back is still near; three is not', () => {
    const t = title([WOMAN, DRAGON, 'A young woman with short red hair climbs a rooftop.', DRAGON, 'A young woman with short red hair smiles.'])
    expect(edit(t, 2, 'She climbs a rooftop.').applied).toHaveLength(1) // the woman is two cues back
    const far = title([WOMAN, DRAGON, DRAGON, 'A young woman with short red hair climbs a rooftop.'])
    expect(reasons(edit(far, 3, 'She climbs a rooftop.'))).toEqual(['pronoun "she" with no referent in the last 2 cues (20 s, same scene)'])
  })
  it('not across 20 s, and not across a scene change', () => {
    const late = title([WOMAN, 'A young woman with short red hair climbs a rooftop.'], { gapMs: 21_000 })
    expect(reasons(edit(late, 1, 'She climbs a rooftop.'))).toEqual(['pronoun "she" with no referent in the last 2 cues (20 s, same scene)'])
    const cut = title([WOMAN, 'A young woman with short red hair climbs a rooftop.'], { scenes: () => [
      { id: 0, shots: [0], startMs: 0, endMs: 183_000, setting: 'the town', settingName: 'the town', returning: false, evidence: [] },
      { id: 1, shots: [1], startMs: 183_000, endMs: 186_000, setting: 'the desert', settingName: 'the desert', returning: false, evidence: [] }] })
    expect(reasons(edit(cut, 1, 'She climbs a rooftop.'))).toEqual(['pronoun "she" with no referent in the last 2 cues (20 s, same scene)'])
  })
  it('the spike\'s rejected pair: "She walks…" after "A person walks uphill…" (no woman nearby)', () => {
    const t = title(['A person walks uphill through the snow.', 'A young woman with short red hair walks across the snowy mountains.'])
    expect(reasons(edit(t, 1, 'She walks across the snowy mountains.'))).toEqual(['pronoun "she" with no referent in the last 2 cues (20 s, same scene)'])
  })
  it('licensed earlier in the same cue', () => {
    const t = title([DRAGON, 'A young woman with short red hair kneels and reaches toward the dragon.'])
    expect(edit(t, 1, 'A young woman with short red hair kneels, and she reaches toward the dragon.').applied).toHaveLength(1)
  })
  it('a pronoun never licenses itself: hyphens and apostrophes do not shift the words before it (review of #80)', () => {
    const t = title(['A small tan dragon sleeps.', 'A red-haired dragon lunges and dodges.'])
    expect(reasons(edit(t, 1, 'A red-haired dragon lunges and she dodges.'))).toEqual(['pronoun "she" with no referent in the last 2 cues (20 s, same scene)'])
    const apos = title(['A small tan dragon sleeps.', "The dragon's wing twitches and the dragon's eye opens."])
    expect(reasons(edit(apos, 1, "The dragon's wing twitches and she opens the dragon's eye."))[0]).toMatch(/^pronoun "she" with no referent/)
    const ok = title([DRAGON, 'A red-haired woman kneels and reaches toward the dragon.'])
    expect(edit(ok, 1, 'A red-haired woman kneels, and she reaches toward the dragon.').applied).toHaveLength(1) // a noun before it does
    // 25 s apart: no referent in the window, so only the name before "her" can license it (the look carries within the scene)
    const named = title(['The red-haired young woman, Sintel, walks under a full moon.', 'The red-haired young woman, Sintel, holds a staff under a full moon.'], { startMs: 480_000, gapMs: 25_000 })
    expect(edit(named, 1, 'Sintel holds her staff under a full moon.').applied).toHaveLength(1) // a name before it does too (Sintel dry run from fit, cue 71)
  })
  it('two singular women in one cue nearby make "she" ambiguous (review of #80)', () => {
    const t = title(['A woman and an old woman talk.', 'A woman walks away.'])
    expect(reasons(edit(t, 1, 'She walks away.'))).toEqual(['pronoun "she" could mean more than one person'])
    const other = title(['A woman watches as another woman runs.', 'A woman walks away.'])
    expect(reasons(edit(other, 1, 'She walks away.'))).toEqual(['pronoun "she" could mean more than one person'])
    const same = title(['A young woman runs.', 'The woman stops.', 'A woman walks away.'])
    expect(edit(same, 2, 'She walks away.').applied).toHaveLength(1) // one per cue: the same woman again
  })
  it('one candidate only: two women nearby, or two glossary men, make "she"/"he" ambiguous', () => {
    const t = title(['Two women run across a rooftop.', 'A woman climbs a rooftop.'])
    expect(reasons(edit(t, 1, 'She climbs a rooftop.'))).toEqual(['pronoun "she" could mean more than one person'])
    const men = title(['An old man with a grey beard and a bald, heavy-set man with a drooping black moustache stand.', 'A bald, heavy-set man with a drooping black moustache raises a fist.'])
    expect(reasons(edit(men, 1, 'He raises a fist.'))).toEqual(['pronoun "he" could mean more than one person'])
  })
  it('the cue\'s own shots must show someone of that kind ("she" never on a shot of the dragon alone)', () => {
    const t = title([WOMAN, 'A small tan dragon flies over the rooftop.'])
    expect(reasons(edit(t, 1, 'She flies over the rooftop.'))).toEqual(['pronoun "she": no one of that kind in this cue\'s shots'])
  })
  it('a new "it" stands for a word the rewrite dropped that the last cues said (spike cue 50); else rejected (spike cue 77)', () => {
    const t = title(['The dragon soars through pink clouds toward a ruined town.', 'The dragon flies toward a reaching hand.'], { startMs: 340_000 })
    expect(edit(t, 1, 'It flies toward a reaching hand.').applied).toHaveLength(1)
    const cave = title(['A young woman with short red hair walks into the dark.', 'A vast cave with glowing crystals on its floor.'], { startMs: 500_000 })
    expect(reasons(edit(cave, 1, 'It is a vast cave with glowing crystals on its floor.'))).toEqual(['pronoun "it" with no referent in the last 2 cues (20 s, same scene)'])
  })
  it('a pronoun the old text already had needs no licence', () => {
    const t = title([DRAGON, 'She smiles slightly at the dragon.'])
    expect(pronounProblems(view(t), 1, 'She smiles slightly at the dragon.', 'She smiles slightly at the small dragon.', [t.shots[1]!.description])).toEqual([])
  })
  it('the referent window is the last two action cues as heard, nearest first', () => {
    const t = title([WOMAN, DRAGON, 'A young woman with short red hair smiles.'])
    expect(referentWindow(view(t, (k) => (k === 1 ? 'It lies on a stone roof.' : t.cues[k]!.text)), 2)).toEqual(['It lies on a stone roof.', WOMAN])
  })
})

const view = (t: ReturnType<typeof title>, heard = (k: number) => t.cues[k]!.text, glossary = SINTEL): NarrativeView => ({ cues: t.cues, heard, scenes: t.scenes, glossary, isTextCue })

describe('carried look', () => {
  it('look words count as given once said earlier in the scene, while the rewrite still refers to her (spike cues 26, 27, 44)', () => {
    const t = title([WOMAN, 'A young woman with short red hair looks down at a ruined town.', DRAGON, 'A small tan dragon with a bleeding wing lies on a stone roof.'])
    expect(edit(t, 1, 'She looks down at a ruined town.').applied).toHaveLength(1)
    expect(edit(t, 3, 'The small tan dragon lies on a stone roof.').applied).toHaveLength(1) // "bleeding wing" was said in cue 2
  })
  it('"red-haired" (one word to the keeps-facts guard) and a name the scene has said carry too (dry run, cues 93 and 114)', () => {
    const t = title(['The red-haired young woman, Sintel, runs through a dark cave.', 'The red-haired young woman, Sintel, grips her staff in a dark cave.', 'The red-haired young woman, Sintel, stands on a rocky slope.'], { startMs: 600_000 })
    expect(edit(t, 1, 'Sintel grips her staff in the dark cave.').applied).toHaveLength(1)
    expect(edit(t, 2, 'She stands on a rocky slope.').applied).toHaveLength(1)
    const first = title(['A small tan dragon sleeps.', 'The red-haired young woman, Sintel, stands on a rocky slope.'], { startMs: 600_000 })
    expect(reasons(edit(first, 1, 'Sintel stands on a rocky slope.'))).toEqual(['drops a fact: red-haired, woman']) // the scene never said them
  })
  it('never dropped at the scene\'s first mention (spike cue 33: "drops a fact: red, hair")', () => {
    const t = title([DRAGON, 'A young woman with short red hair kneels beside a glowing pink crystal.'])
    expect(reasons(edit(t, 1, 'The young woman kneels beside a glowing pink crystal.'))).toEqual(['drops a fact: red, hair'])
  })
  it('not when the rewrite no longer refers to the character', () => {
    const carried = carriedLook(view(title([WOMAN, 'A young woman with short red hair smiles.'])), 1)
    expect([...carried.keys()].sort()).toEqual(['hair', 'red', 'short', 'woman'])
    expect(excusedByCarry(['red', 'hair'], 'A cat smiles.', carried)).toEqual(new Set())
    expect(excusedByCarry(['red', 'hair'], 'She smiles.', carried)).toEqual(new Set(['red', 'hair']))
  })
  it('a place word in a look never carries (the baby dragon\'s "dark cave")', () => {
    const t = title(['A small pale dragon curled up asleep in the dark cave, its wings folded.', 'A small pale dragon sleeps in the cave.'], { startMs: 520_000 })
    expect([...carriedLook(view(t), 1).keys()]).not.toContain('cave')
    expect(charRefs(SINTEL).find((c) => c.name === 'the baby dragon in the lair')!.look.has('cave')).toBe(false)
  })
  it('without scenes.json the carry reaches back only as far as the referent window (last 2 cues, 20 s), not the whole title', () => {
    const t = title([WOMAN, DRAGON, DRAGON, DRAGON, 'A young woman with short red hair smiles.'])
    expect([...carriedLook(view(t), 4).keys()]).toContain('red') // one scene: cue 0 counts
    const none: NarrativeView = { ...view(t), scenes: undefined }
    expect([...carriedLook(none, 4).keys()]).not.toContain('red') // no scenes: only cues 2 and 3
    const near = title([DRAGON, WOMAN, 'A young woman with short red hair smiles.'])
    expect([...carriedLook({ ...view(near), scenes: undefined }, 2).keys()]).toContain('red')
    const late = title([WOMAN, 'A young woman with short red hair smiles.'], { gapMs: 25_000 })
    expect([...carriedLook({ ...view(late), scenes: undefined }, 1).keys()]).toEqual([])
  })
  it('mustStillSay leaves out the carried look, so the request and the guard ask for the same thing', () => {
    const t = title([WOMAN, 'A young woman with short red hair smiles.'])
    expect(mustStillSay(t.cues, 1, (k) => t.cues[k]!.text, t.scenes, SINTEL)).toEqual(['smiles'])
    const first = title([DRAGON, 'A young woman with short red hair smiles.'])
    expect(mustStillSay(first.cues, 1, (k) => first.cues[k]!.text, first.scenes, SINTEL)).toEqual(['woman', 'red', 'hair', 'smiles'])
  })
})

describe('a sentence-opening place phrase is not a list (editReadsAsSentences)', () => {
  it('"Back in the town, a chicken runs…" and "On a misty green hillside, a warrior… stands." (dry run, cues 36 and 62)', () => {
    expect(editReadsAsSentences('A chicken runs through a sunlit alley.', 'Back in the town, a chicken runs through a sunlit alley.', ['A chicken runs through a sunlit alley.'])).toBeUndefined()
    expect(editReadsAsSentences('A warrior stands on a hillside.', 'On a misty green hillside, a warrior stands.', ['A warrior stands on a hillside.'])).toBeUndefined()
    expect(editReadsAsSentences('A man holds a staff.', 'In the tent, the man, a staff, a bowl.', ['A man holds a staff.'])).toMatch(/new list comma after "man"/) // only the opening comma
    expect(editReadsAsSentences('A dragon flies.', 'Scaled creature, horns, bloodied wing, stares.', ['A dragon flies.'])).toMatch(/new list comma/)
    expect(editReadsAsSentences('A chicken runs.', 'Back, a chicken runs.', ['A chicken runs.'])).toMatch(/new list comma after "back"/) // one word is no phrase
    expect(editReadsAsSentences('A dragon sleeps.', 'In the cave; a dragon sleeps.', ['A dragon sleeps.'])).toMatch(/new list comma after "cave"/) // a semicolon never closes one
    expect(editReadsAsSentences('A man waits.', 'Back home, a man waits.', ['A man waits.'])).toMatch(/new list comma/) // "back" only as back in / on / at
  })
})

describe('free and source-only words', () => {
  it('"now" and "here" are free (spike cue 46)', () => {
    const t = title(['A young woman with short red hair runs across a stone fortress.', 'A woman stands on a rocky ledge.'])
    expect(edit(t, 1, 'Now she stands on a rocky ledge.').applied).toHaveLength(1)
    expect(edit(t, 1, 'Here she stands on a rocky ledge.').applied).toHaveLength(1)
    expect(faithfulText('Now she stands here.')).toBe('stands')
  })
  it('"still", "again", "meanwhile", "later", "night falls" trace to this cue\'s own shots, never to the previous cue', () => {
    const t = title(['The small tan dragon lies still on a stone roof.', 'A small tan dragon lies on a stone roof, bleeding.'])
    expect(reasons(edit(t, 1, 'The dragon still lies on the stone roof, bleeding.'))).toEqual(['not in this cue\'s shot descriptions: still'])
    const own = title(['The small tan dragon lies on a stone roof.', 'A small tan dragon lies on a stone roof.'], { descriptions: [undefined, 'A small tan dragon still lies on a stone roof.'] })
    expect(edit(own, 1, 'The dragon still lies on the stone roof.').applied).toHaveLength(1)
    expect(unsourcedContinuity('Night falls. Meanwhile she runs again, later.', ['She runs.'], 'She runs.')).toEqual(['night', 'meanwhile', 'again', 'later'])
  })
})

describe('the place-again guard on article-only changes (spike false alarm, Sintel cave cues 77, 84, 95, 99)', () => {
  // full-length sintel's cave scene as published after #71; the spike rejected these four as "says the scene's place again"
  const fx = JSON.parse(readFileSync(new URL('./fixtures/sintel-cave.json', import.meta.url), 'utf8')) as { offset: number; cues: FitCue[]; described: Described[]; scenes: Scene[] }
  const at = (n: number) => n - fx.offset
  const proposals: Record<number, string> = {
    95: 'The huge dark grey dragon rests in the cave.',
    99: 'The red-haired young woman, Sintel, stands in the cave, facing the huge dark grey dragon’s head, her hands open before her.',
    84: 'The red-haired woman touches glowing crystals on a cave wall. She turns, wielding a blade. A dark grey dragon lunges. She dodges.',
    77: 'The vast cave with glowing crystals on its floor.',
  }
  it('an edit that keeps the place the old text already said is never "says the scene\'s place again"', () => {
    for (const [n, text] of Object.entries(proposals)) {
      const i = at(Number(n))
      const r = applyEdits(fx.cues, fx.described, [{ cue: i, text }], fx.cues.map((c) => c.wordCount + 10), [i, i + 1], 'en', { glossary: SINTEL, spoken: [], scenes: fx.scenes, narrative: true, current: fx.cues })
      expect(r.rejected.map((x) => x.reason)).not.toContain('says the scene\'s place again')
    }
    // the article-only and look-dropping ones pass outright
    const ok = (n: number) => applyEdits(fx.cues, fx.described, [{ cue: at(n), text: proposals[n]! }], fx.cues.map((c) => c.wordCount + 10), [at(n), at(n) + 1], 'en', { glossary: SINTEL, spoken: [], scenes: fx.scenes, narrative: true, current: fx.cues })
    expect(ok(95).applied).toHaveLength(1)
    expect(ok(84).applied).toHaveLength(1)
  })
  it('an edit that adds the place to a cue that did not say it, once the scene said it, is still rejected', () => {
    const i = at(94) // "Sintel stares wide-eyed."
    const r = applyEdits(fx.cues, fx.described, [{ cue: i, text: 'In the cave, Sintel stares wide-eyed.' }], fx.cues.map((c) => c.wordCount + 10), [i, i + 1], 'en', { glossary: SINTEL, spoken: [], scenes: fx.scenes, narrative: true, current: fx.cues })
    expect(r.rejected.map((x) => x.reason)).toEqual(['says the scene\'s place again'])
  })
})

describe('names after the rewrite (unnamedIn and reveal times, decision 0012)', () => {
  it('a rewrite that names Scales inside an unnamedIn window, or Sintel before 457.8 s, is rejected, and no final cue says it', async () => {
    const t = title(['The dragon soars through pink clouds toward a ruined town.', 'The dragon flies toward a reaching hand.', 'A young woman with short red hair looks up.'], { startMs: 320_000 })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await editScene(t.cues, t.shots, [], 'en', json([{ cue: 1, text: 'Scales flies toward a reaching hand.' }, { cue: 2, text: 'Sintel looks up.' }]), undefined, noShorten, { scenes: t.scenes, glossary: SINTEL })
    warn.mockRestore()
    expect(r.rejected.map((x) => [x.i, x.reason.replace(/:.*/, '')])).toEqual([[1, 'name not revealed, not shown in its shots, withheld here, or in no glossary or dialogue'], [2, 'name not revealed, not shown in its shots, withheld here, or in no glossary or dialogue']])
    expect(r.cues.map((c) => c.text).join(' ')).not.toMatch(/Scales|Sintel/)
  })
  it('the grounding pass still replaces a withheld name in the final text, whoever wrote it', async () => {
    const t = title(['The dragon soars toward a ruined town.', 'Scales flies toward a reaching hand.'], { startMs: 320_000 })
    const r = await editScene(t.cues, t.shots, [], 'en', json([]), undefined, noShorten, { scenes: t.scenes, glossary: SINTEL })
    expect(r.cues[1]!.text).not.toContain('Scales')
    expect(r.applied.find((a) => a.i === 1)).toMatchObject({ by: 'name' })
  })
})

describe('a work dir without scenes.json (made before 04c-scenes) is one scene', () => {
  it('the pass runs in blocks, licenses a pronoun across cues, and applies no place rule', async () => {
    const t = title([WOMAN, 'A young woman with short red hair climbs a rooftop.'])
    const r = await editScene(t.cues, t.shots, [], 'en', json([{ cue: 1, text: 'Then she climbs a rooftop.' }]), undefined, noShorten, { glossary: SINTEL })
    expect(r.cues[1]!.text).toBe('Then she climbs a rooftop.')
    expect(r.evidence.every((e) => e.setting.scene === undefined)).toBe(true)
    expect(edit(t, 1, 'She climbs a rooftop.', { scenes: null }).applied).toHaveLength(1)
  })
})

describe('the deletion-only checks do not judge a narrative rewrite (decision 0017)', () => {
  it('verify\'s no-new-word check and fit\'s shortener sentence check would reject an accepted rewrite; they run before edit, on the sources', () => {
    const t = title([WOMAN, 'A young woman with short red hair climbs a rooftop.'])
    const to = 'Then she climbs a rooftop.'
    expect(edit(t, 1, to).applied).toHaveLength(1)
    expect(checkVerified(t.cues[1]!.text, { text: to, removed: [] }, { maxWords: 20, names: [], language: 'en' }).applied).toBe(false) // "new words: then, she"
    expect(readsAsSentences(t.cues[1]!.text, to, 'en')).toBeTruthy() // content words out of order
    expect(STEPS.indexOf('describe')).toBeLessThan(STEPS.indexOf('edit')) // 04b verify runs inside describe
    expect(STEPS.indexOf('fit')).toBeLessThan(STEPS.indexOf('edit'))
    expect(STEPS.indexOf('edit')).toBeLessThan(STEPS.indexOf('voice')) // polishCue and shortenKeepingAction run on the rewrite
  })
})

describe('the request', () => {
  it('per cue: text, sources, mustStillSay (minus the carried look), maxWords, mayName, newScene; heardJustBefore; people without roles', async () => {
    const t = title([WOMAN, 'A young woman with short red hair climbs a rooftop.'], { startMs: 470_000 })
    const seen: ConverseCommandInput[] = []
    await editScene(t.cues, t.shots, [], 'en', async (i) => { seen.push(i); return json([])(i) }, undefined, noShorten, { scenes: t.scenes, glossary: SINTEL })
    const body = (seen[0]!.messages![0]!.content![0] as { text: string }).text
    const input = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1))
    expect(input.cues[0]).toMatchObject({ cue: 0, at: '7:50', newScene: { place: 'the town' }, sources: [WOMAN], mayName: ['Sintel', 'Scales'] })
    expect(input.cues[1]).toMatchObject({ cue: 1, mustStillSay: ['climbs'], maxWords: expect.any(Number) })
    expect(input.cues[1].newScene).toBeUndefined()
    expect(input.people.find((p: { name?: string }) => p.name === 'Sintel')).toEqual({ look: SINTEL.characters[0]!.look, short: 'the red-haired young woman', name: 'Sintel' })
    for (const c of SINTEL.characters) expect(body).not.toContain(c.role)
    expect(body).not.toMatch(/synopsis/i)
  })
  it('budgets at the voice\'s rate: Ruth generative gets fewer words than Joanna neural in the same pause', () => {
    const t = title(['A woman runs.'], { gapMs: 8000 })
    const [joanna] = editBudgets(t.cues), [ruth] = editBudgets(t.cues, EDIT_WPS * rateFactor('Ruth', 'generative'))
    expect(joanna).toBe(17)
    expect(ruth).toBe(15) // 7.9 s × 1.93 words/s
  })
})
