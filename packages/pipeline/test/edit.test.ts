import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime'
import { applyEdits, cleanShortening, dialogueTurns, EDIT_CHUNK_CUES, editBudgets, editCues, editScene, factWords, FIT_CUES_FILE, isTextCue, replyEdits, stem, unfaithfulWords } from '../src/steps/05b-edit'
import { editRequest, EDIT_TOOL_SCHEMA, shortenEditRequest, type EditConverse } from '../src/prompts'
import type { FitCue } from '../src/steps/05-fit'
import type { Described } from '../src/steps/04-describe'
import type { Word } from '../src/steps/03-speech'
import { bedrockUsd, metered } from '../src/cost'

// sintel-90-150-r2 (2026-10-09): 15 shots; cues.fit = the merged fit's output (DESC-017, deterministic shortener), 10 voiced cues;
// cues = the 9 cues heard on the device before DESC-017. Shot 5 ("Red-haired girl watches man stir pot over fire.") is dropped in both.
const fx = (f: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', `sintel-90-150-r2.${f}.json`), 'utf8'))
const shots = fx('described') as Described[]
const r2cues = fx('cues') as FitCue[]
const fitCues = fx('cues.fit') as FitCue[]
const words = fx('words') as Word[]
const BROTH = 5 // index of "Old man pours broth." (shot 7) in both cue lists

type Reply = Awaited<ReturnType<EditConverse>>
/** A recorded reply: the forced emit_edits tool call with these edits. */
const toolReply = (edits: unknown, usage = { inputTokens: 1000, outputTokens: 50 }): EditConverse => async () => ({ output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 't1', name: 'emit_edits', input: { edits } } }] } }, usage }) as unknown as Reply
const textReply = (text: string): EditConverse => async () => ({ output: { message: { role: 'assistant', content: [{ text }] } }, usage: { inputTokens: 1000, outputTokens: 10 } }) as unknown as Reply
const timing = (cs: readonly FitCue[]) => cs.map(({ startMs, endMs, limitMs, extended, shotIndex }) => ({ startMs, endMs, limitMs, extended, shotIndex }))
const noShorten = (t: string) => t
/** r2 cues with the broth cue's gap widened so a fold has room (on r2 itself that gap is 1.65 s: 4 words). */
const roomy = r2cues.map((c, i) => (i === BROTH ? { ...c, limitMs: 38300 } : c))
const FOLD = 'The man stirs a pot over the fire, then pours broth.' // shot 5 (dropped) + shot 7's cue

/**
 * DESC-017's split: fit's cues for r2 as 06-voice's golden replay shapes shots 0 and 1 (test/sintel-r2.test.ts) — the on-screen text
 * "Words appear: SINTEL." is its own extended cue 400 ms before the action cue of the same shot — followed by the merged fit's cues.
 */
const split: FitCue[] = [
  { startMs: 0, endMs: 100, text: 'Words appear: SINTEL.', extended: true, wordCount: 3, shotIndex: 0 },
  { startMs: 400, endMs: 3400, text: 'Snowy mountains. A lone figure walks left.', extended: false, wordCount: 7, shotIndex: 0, limitMs: 16720 },
  { startMs: 5604, endMs: 8000, text: 'A figure walks, falls. Logo fades.', extended: false, wordCount: 6, shotIndex: 1, limitMs: 16720 },
  ...fitCues.slice(2),
]
const SPLIT_BROTH = 6 // "Old man pours broth." in `split`

describe('edit (scene-level context pass)', () => {
  it('folds a dropped fact into the next voiced cue within budget', async () => {
    expect(editBudgets(roomy)[BROTH]).toBe(11)
    const r = await editScene(roomy, shots, words, 'en', toolReply([{ cue: BROTH, text: FOLD }]), undefined, noShorten)
    expect(r.cues[BROTH]).toMatchObject({ text: FOLD, wordCount: 11, shotIndex: 7, startMs: 33170 })
    expect(r.applied).toEqual([{ i: BROTH, from: 'Old man pours broth.', to: FOLD }])
    expect(r.rejected).toEqual([])
    expect(r.cues.filter((_, i) => i !== BROTH).map((c) => c.text)).toEqual(r2cues.filter((_, i) => i !== BROTH).map((c) => c.text))
  })

  it('rejects an edit that exceeds the cue word budget', async () => {
    const r = await editScene(r2cues, shots, words, 'en', toolReply([{ cue: BROTH, text: FOLD }]), undefined, noShorten)
    expect(editBudgets(r2cues)[BROTH]).toBe(4)
    expect(r.cues[BROTH]!.text).toBe('Old man pours broth.')
    expect(r.rejected).toEqual([{ i: BROTH, text: FOLD, reason: 'over budget (11 > 4 words)' }])
  })

  // Probe round 5 (Nova Lite): the fold came back as the two descriptions glued together, 17 words into an 11-word room.
  it('shortens an over-budget edit once and keeps it only when it then fits and passes the guards', async () => {
    const glued = 'A red-haired girl watches a man stir a pot over a fire. The old man pours broth.'
    const asked: [string, number, string][] = []
    const shorten = (t: string, n: number, keep: string) => { asked.push([t, n, keep]); return { text: FOLD, usage: { inputTokens: 300, outputTokens: 20 } } }
    const r = await editScene(roomy, shots, words, 'en', toolReply([{ cue: BROTH, text: glued }]), undefined, shorten)
    expect(asked).toEqual([[glued, 11, 'Old man pours broth.']])
    expect(r.cues[BROTH]!.text).toBe(FOLD)
    expect(r.applied).toEqual([{ i: BROTH, from: 'Old man pours broth.', to: FOLD }])
    expect(r.usage).toEqual({ inputTokens: 1300, outputTokens: 70 }) // the shortening call's usage counts too
    expect(r.shorteningCalls).toBe(1)
    // the shortening lost the cue's own fact → the original stays
    const r2 = await editScene(roomy, shots, words, 'en', toolReply([{ cue: BROTH, text: glued }]), undefined, () => 'A red-haired girl watches a man stir a pot.')
    expect(r2.cues[BROTH]!.text).toBe('Old man pours broth.')
    expect(r2.rejected.map((x) => x.reason)).toEqual(['drops a fact: pours, broth (after shortening)'])
    // still too long → the original stays
    const r3 = await editScene(roomy, shots, words, 'en', toolReply([{ cue: BROTH, text: glued }]), undefined, () => 'A red-haired girl watches a man stir a pot over a fire, then pours broth.')
    expect(r3.cues[BROTH]!.text).toBe('Old man pours broth.')
    expect(r3.rejected.map((x) => x.reason)).toEqual(['over budget (15 > 11 words) (after shortening)'])
  })

  // sintel-90-210 (2026-10-10): the edit only added articles ("The red-haired woman looks down, then darkness swallows the scene.",
  // 10 > 9 words) and Nova Lite's whole shortening reply was "(9 words)" — 3 of 5 rejections in edit.json were that annotation.
  it('a shortening reply that is only a word count is treated as invalid, not as text', async () => {
    const glued = 'A red-haired girl watches a man stir a pot over a fire. The old man pours broth.'
    for (const reply of ['(11 words)', '11 words', ' (11 words) ', '[11 words]', 'Word count: 11', '""', '']) {
      const r = await editScene(roomy, shots, words, 'en', toolReply([{ cue: BROTH, text: glued }]), undefined, () => reply)
      expect(r.cues[BROTH]!.text).toBe('Old man pours broth.')
      expect(r.applied).toEqual([])
      expect(r.rejected).toEqual([{ i: BROTH, text: glued, reason: 'over budget (17 > 11 words)' }]) // the edit's own rejection, no "not in any shot description: 11, words"
    }
  })

  it('strips a word-count annotation around a shortened line', async () => {
    for (const reply of [`${FOLD} (11 words)`, `(11 words) ${FOLD}`, `"${FOLD}" — 11 words`, `${FOLD}\n11 words`, `${FOLD} [11 words]`, `${FOLD} (Word count: 11)`]) {
      expect(cleanShortening(reply)).toBe(FOLD)
      const r = await editScene(roomy, shots, words, 'en', toolReply([{ cue: BROTH, text: 'A red-haired girl watches a man stir a pot over a fire. The old man pours broth.' }]), undefined, () => reply)
      expect(r.applied).toEqual([{ i: BROTH, from: 'Old man pours broth.', to: FOLD }])
    }
    expect(cleanShortening('Two men walk 11 words apart.')).toBe('Two men walk 11 words apart.') // only a leading or trailing annotation
    expect(cleanShortening('(9 words)')).toBe('')
    // whole words only
    expect(cleanShortening('9 wordsmiths gather at the forge.')).toBe('9 wordsmiths gather at the forge.')
    expect(cleanShortening('A man raises a sword 2')).toBe('A man raises a sword 2')
    expect(cleanShortening('Swordsmen 3 words apart.')).toBe('Swordsmen 3 words apart.')
  })

  it('strips wrapping quotes only as a matching pair, or when no on-screen text clause runs to the end of the line', () => {
    expect(cleanShortening('“Old man pours broth.”')).toBe('Old man pours broth.')
    expect(cleanShortening('"Old man pours broth." (4 words)')).toBe('Old man pours broth.')
    expect(cleanShortening('«Der alte Mann gießt Brühe ein.»')).toBe('Der alte Mann gießt Brühe ein.')
    expect(cleanShortening('"Snow falls. Words appear: "SINTEL""')).toBe('Snow falls. Words appear: "SINTEL"')
    // the closing quote belongs to the clause
    expect(cleanShortening('Words appear: “The End.”')).toBe('Words appear: “The End.”')
    expect(cleanShortening('Snow falls. Words appear: "SINTEL"')).toBe('Snow falls. Words appear: "SINTEL"')
    expect(cleanShortening('Snow falls. Words appear: "SINTEL". 5 words')).toBe('Snow falls. Words appear: "SINTEL".')
    expect(cleanShortening('Snow falls."')).toBe('Snow falls.') // a stray quote with no clause at the end
    const cues: FitCue[] = [{ startMs: 0, endMs: 3000, text: 'Snow falls. Words appear: “The End.”', extended: false, wordCount: 6, shotIndex: 0, limitMs: 9000 }]
    const end: Described[] = [{ index: 0, startMs: 0, endMs: 4000, description: 'Snow falls on the hills. Words appear: “The End.”', sameAsPrev: false, tokens: 0, outputTokens: 0 }]
    expect(applyEdits(cues, end, [{ cue: 0, text: cleanShortening('Snow falls on hills. Words appear: “The End.”') }], [9]).applied).toHaveLength(1)
  })

  it('names the facts the cue must keep — in the edit input and first in the shortening request', async () => {
    expect(factWords('Old man pours broth.', 'Bearded man holds staff.')).toEqual(['pours', 'broth']) // "old" droppable, "man" said by the previous cue
    expect(factWords('Old man pours broth.', '')).toEqual(['man', 'pours', 'broth'])
    const seen: ConverseCommandInput[] = []
    const asked: string[][] = []
    const glued = 'A red-haired girl watches a man stir a pot over a fire. The old man pours broth.'
    await editScene(roomy, shots, words, 'en', async (i) => { seen.push(i); return toolReply([{ cue: BROTH, text: glued }])(i) }, undefined, (t, n, keep, must) => { asked.push(must); return t })
    const body = (seen[0]!.messages![0]!.content![0] as { text: string }).text
    const input = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1))
    expect(input.cues[BROTH].mustStillSay).toEqual(['pours', 'broth'])
    expect((seen[0]!.system![0] as { text: string }).text).toContain('mustStillSay')
    expect(asked).toEqual([['pours', 'broth']])
    const req = shortenEditRequest(glued, 11, 'Old man pours broth.', ['pours', 'broth'], 'en')
    const sys = (req.system![0] as { text: string }).text
    expect(sys.indexOf('pours, broth')).toBeGreaterThanOrEqual(0)
    expect(sys.indexOf('pours, broth')).toBeLessThan(sys.indexOf('11 words'))
    expect(sys).not.toContain('(count them)')
    expect(sys).toMatch(/never a word count/i)
  })

  it('checks words before the budget, so an edit that would fail anyway costs no shortening call', async () => {
    const shorten = vi.fn(noShorten)
    const r = await editScene(r2cues, shots, words, 'en', toolReply([{ cue: BROTH, text: 'The old man pours wine into a cup for the girl.' }]), undefined, shorten)
    expect(shorten).not.toHaveBeenCalled()
    expect(r.rejected.map((x) => x.reason)).toEqual(['not in any shot description: wine, into, cup'])
  })

  it('rejects an edit that introduces a word not in any shot description', () => {
    const r = applyEdits(r2cues, shots, [
      { cue: BROTH, text: 'The man pours wine into a cup.' }, // wine, cup: nowhere; "into" is spatial, so it must trace too
      { cue: 4, text: 'Bearded man holds staff; the girl accepts a bowl.' }, // girl: shot 5, accepts/bowl: shot 8 — both after this cue's shot 4 ("never before")
      { cue: 6, text: 'The fire glows in the tent.' }, // shot 9 "Tent interior. Fire glows." — allowed
      { cue: 8, text: 'Darkness. A veiled face rises.' }, // shot 11 was dropped two cues earlier (under cue 7): a dropped fact goes into the next cue only
      { cue: 7, text: 'The bearded man speaks in the tent.' }, // "tent" from the previous cue's text ("Tent glows.") — continuity, allowed
    ], r2cues.map(() => 25)) // budgets out of the way: this test is about words
    expect(r.rejected.map((x) => [x.i, x.reason])).toEqual([[BROTH, 'not in any shot description: wine, into, cup'], [4, 'not in any shot description: girl, accepts, bowl'], [8, 'not in any shot description: veiled, face, rises']])
    expect(r.cues[BROTH]!.text).toBe('Old man pours broth.')
    expect(r.cues[4]!.text).toBe('Bearded man holds staff.')
    expect(r.cues[6]!.text).toBe('The fire glows in the tent.')
    expect(r.cues[7]!.text).toBe('The bearded man speaks in the tent.')
  })

  it('makes negations, quantifiers, again/same/still, gendered pronouns and spatial words trace to the allowed text', () => {
    const big = r2cues.map(() => 25)
    const r = applyEdits(r2cues, shots, [
      { cue: BROTH, text: 'The man does not pour broth.' },
      { cue: 4, text: 'Another man holds the staff again.' },
      { cue: 7, text: 'The bearded man speaks in the same tent.' },
      { cue: 6, text: 'The tent glows behind him.' },
      { cue: 3, text: 'Fire still burns.' },
    ], big)
    expect(r.rejected.map((x) => [x.i, x.reason])).toEqual([
      [BROTH, 'not in any shot description: not'], [4, 'not in any shot description: another, again'], [7, 'not in any shot description: same'],
      [6, 'not in any shot description: behind, him'], [3, 'not in any shot description: still'],
    ])
    expect(applyEdits(r2cues, shots, [{ cue: 2, text: 'Darkness. A faint fire glows in the stone pit.' }], big).applied).toHaveLength(1) // articles and "in" are free
  })

  it('matches inflections through one Porter stem per word and nothing else', () => {
    expect(unfaithfulWords('The man stirs the pot, then pours broth.', ['Red-haired girl watches man stir pot over fire.', 'Old man pours broth.'])).toEqual([])
    expect(unfaithfulWords('Sparks drifting. The figure falling.', ['Faint red sparks drift downward.', 'A figure walks, falls.'])).toEqual([])
    expect(unfaithfulWords('A red-haired woman rises.', ['Red-haired woman opens eyes.'])).toEqual(['rises'])
    for (const [a, b] of [['walks', 'walk'], ['walking', 'walk'], ['stirring', 'stir'], ['rising', 'rise'], ['fired', 'fire'], ['bowls', 'bowl']]) expect(stem(a!)).toBe(stem(b!))
    for (const [a, b] of [['stars', 'stares'], ['fir', 'fired'], ['scar', 'scared'], ['car', 'caring']]) expect(stem(a!)).not.toBe(stem(b!))
  })

  it('keeps every fact of the original unless the previous cue already said it or it is a droppable adjective', () => {
    const r = applyEdits(roomy, shots, [
      { cue: 1, text: 'A figure walks, falls.' }, // "Logo fades." is gone — Nova Lite did this in 2 of 3 probe replies
      { cue: 2, text: 'Darkness. A fire glows in a stone pit.' }, // "faint" is a droppable adjective
      { cue: BROTH, text: FOLD }, // "old" is droppable
    ], roomy.map(() => 25))
    expect(r.rejected).toEqual([{ i: 1, text: 'A figure walks, falls.', reason: 'drops a fact: logo, fades' }])
    expect(r.applied.map((a) => a.i)).toEqual([2, BROTH])
    // "Snowy mountains." was cue 0's; cue 1 may lose it
    expect(applyEdits(roomy, shots, [{ cue: 1, text: 'A figure walks, falls. Logo fades.' }]).applied).toHaveLength(1)
  })

  it('falls back to the original cues on an invalid reply', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const send of [textReply('Sorry, I cannot help with that.'), textReply('{"cues":[]}'), toolReply({ not: 'a list' })] as EditConverse[]) {
      const r = await editScene(r2cues, shots, words, 'en', send, undefined, noShorten)
      expect(r.cues).toEqual(r2cues)
      expect(r.applied).toEqual([])
    }
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
    expect(replyEdits('```json\n{"edits":[{"cue":"5","text":"x"}]}\n```')).toEqual([{ cue: 5, text: 'x' }])
    expect(replyEdits('Here are the edits: {"edits":[{"cue":5,"text":"x"}]} Let me know!')).toEqual([{ cue: 5, text: 'x' }]) // prose around the object (JSON mode)
    expect(replyEdits({ edits: [] })).toEqual([])
  })

  it('asks once more for JSON text when the forced tool call fails, then keeps the originals', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const modes: string[] = []
    const send: EditConverse = async (i) => { modes.push(i.toolConfig ? 'tool' : 'json'); if (i.toolConfig) throw new Error('Model produced invalid sequence as part of ToolUse'); return textReply(`{"edits":[{"cue":5,"text":"${FOLD}"}]}`)(i) }
    const r = await editScene(roomy, shots, words, 'en', send, undefined, noShorten)
    expect(modes).toEqual(['tool', 'json'])
    expect(r.cues[BROTH]!.text).toBe(FOLD)
    const r2 = await editScene(roomy, shots, words, 'en', async () => { throw new Error('ServiceUnavailableException') }, undefined, noShorten)
    expect(r2.cues).toEqual(roomy)
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })

  it('rethrows when the job was aborted instead of keeping the originals', async () => {
    const ac = new AbortController(); ac.abort(new Error('time is up'))
    await expect(editScene(r2cues, shots, words, 'en', async () => { throw ac.signal.reason }, ac.signal, noShorten)).rejects.toThrow('time is up')
  })

  it('never changes cue timing or count', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await editScene(roomy, shots, words, 'en', toolReply([
      { cue: 42, text: 'A dragon lands.' }, { cue: -1, text: 'Darkness.' }, { cue: 1.5, text: 'Darkness.' },
      { cue: 3, text: 'The fire burns.' }, { cue: 3, text: 'Fire.' }, // second edit of one cue ignored
      { cue: 0, text: 'Snowy mountains.\nA lone figure walks left.' }, { cue: 2, text: '' },
      { cue: BROTH, text: FOLD },
    ]), undefined, noShorten)
    expect(r.cues).toHaveLength(roomy.length)
    expect(timing(r.cues)).toEqual(timing(roomy))
    expect(r.applied.map((a) => a.i)).toEqual([3, BROTH])
    expect(r.rejected.map((x) => [x.i, x.reason])).toEqual([[42, 'unknown cue'], [-1, 'unknown cue'], [1.5, 'unknown cue'], [3, 'cue edited twice'], [0, 'empty or multi-line'], [2, 'empty or multi-line']])
    warn.mockRestore()
  })

  it('keeps a Words appear clause verbatim', () => {
    const cues: FitCue[] = [
      { startMs: 0, endMs: 5000, text: 'Snowy mountains. A lone figure walks left, carrying a spear. Words appear: SINTEL.', extended: false, wordCount: 13, shotIndex: 0, limitMs: 16720 },
      { startMs: 5604, endMs: 10668, text: 'Snowy mountains. A figure walks, falls. Logo fades.', extended: false, wordCount: 8, shotIndex: 1, limitMs: 16720 },
    ]
    const ok = 'Snowy mountains. A lone figure carrying a spear walks left. Words appear: SINTEL.'
    const r = applyEdits(cues, shots, [
      { cue: 0, text: 'Snowy mountains. A lone figure walks left, carrying a spear. Words appear: Sintel.' },
      { cue: 1, text: 'The figure walks, falls. Logo fades. Words appear: SINTEL.' },
    ])
    expect(r.rejected.map((x) => [x.i, x.reason])).toEqual([[0, 'on-screen text clause changed'], [1, 'on-screen text clause added']])
    // cue 1 may lose "Snowy mountains" (cue 0 said it) but nothing else
    expect(applyEdits(cues, shots, [{ cue: 0, text: ok }, { cue: 1, text: 'The figure walks, then falls. Logo fades.' }]).cues.map((c) => c.text)).toEqual([ok, 'The figure walks, then falls. Logo fades.'])
  })

  it('reads on-screen text clauses with the shared parser: German labels, quotes and abbreviations', () => {
    const de: Described[] = [{ index: 0, startMs: 0, endMs: 4000, description: 'Eine Straße. Text erscheint: „Berlin, 1989“.', sameAsPrev: false, tokens: 0, outputTokens: 0 }]
    const deCue: FitCue[] = [{ startMs: 0, endMs: 3000, text: 'Eine Straße. Text erscheint: „Berlin, 1989“.', extended: false, wordCount: 6, shotIndex: 0, limitMs: 9000 }]
    expect(applyEdits(deCue, de, [{ cue: 0, text: 'Die Straße. Text erscheint: „Berlin, 1989“.' }]).applied).toHaveLength(1)
    expect(applyEdits(deCue, de, [{ cue: 0, text: 'Die Straße. Text erscheint: „Berlin 1989“.' }]).rejected.map((x) => x.reason)).toEqual(['on-screen text clause changed'])
    const who: Described[] = [{ index: 0, startMs: 0, endMs: 4000, description: 'A blue box. Words appear: Dr. Who. A man waves.', sameAsPrev: false, tokens: 0, outputTokens: 0 }]
    const whoCue: FitCue[] = [{ startMs: 0, endMs: 3000, text: 'A blue box. Words appear: Dr. Who. A man waves.', extended: false, wordCount: 10, shotIndex: 0, limitMs: 9000 }]
    expect(applyEdits(whoCue, who, [{ cue: 0, text: 'A blue box. Words appear: Dr. Who. The man waves.' }]).applied).toHaveLength(1)
    expect(applyEdits(whoCue, who, [{ cue: 0, text: 'A blue box. Words appear: Dr Who. The man waves.' }]).rejected.map((x) => x.reason)).toEqual(['on-screen text clause changed'])
  })

  describe("DESC-017's split on-screen text cues", () => {
    it('are frozen: budget is their own length, any edit is rejected, and they are listed as fixed', async () => {
      expect(split.map(isTextCue)).toEqual([true, ...split.slice(1).map(() => false)])
      expect(editBudgets(split)[0]).toBe(3)
      const r = await editScene(split, shots, words, 'en', toolReply([{ cue: 0, text: 'Words appear: SINTEL.' }, { cue: 0, text: 'Words appear: Sintel.' }, { cue: 1, text: 'A lone figure walks left. Words appear: SINTEL.' }]), undefined, noShorten)
      expect(r.cues[0]!.text).toBe('Words appear: SINTEL.')
      expect(r.rejected.map((x) => [x.i, x.reason])).toEqual([[0, 'cue edited twice'], [1, 'on-screen text clause added']])
      const seen: ConverseCommandInput[] = []
      await editScene(split, shots, words, 'en', async (i) => { seen.push(i); return toolReply([])(i) }, undefined, noShorten)
      const body = (seen[0]!.messages![0]!.content![0] as { text: string }).text
      const input = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1))
      expect(input.cues[0]).toEqual({ cue: 0, start: 0, text: 'Words appear: SINTEL.', onScreenText: true, fixed: true })
      expect(input.cues[1]).toMatchObject({ cue: 1, words: 7, wordsYouMayAdd: expect.any(Number) })
      expect(input.cues[1].missedJustBefore).toBeUndefined()
    })
    it('a dropped fact can only land in the action cue, whose context skips the text cue', async () => {
      // the merged fit voices shot 8 at 37.24 s, so even a widened gap leaves this cue 8 words (M4: the next cue of any kind caps it)
      const roomySplit = split.map((c, i) => (i === SPLIT_BROTH ? { ...c, limitMs: 38300 } : c))
      expect(editBudgets(roomySplit)[SPLIT_BROTH]).toBe(8)
      const fold8 = 'The man stirs a pot, then pours broth.'
      const seen: ConverseCommandInput[] = []
      const r = await editScene(roomySplit, shots, words, 'en', async (i) => { seen.push(i); return toolReply([{ cue: SPLIT_BROTH, text: fold8 }, { cue: 0, text: 'Words appear: SINTEL. The man stirs a pot.' }])(i) }, undefined, noShorten)
      const body = (seen[0]!.messages![0]!.content![0] as { text: string }).text
      const input = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1))
      expect(input.cues[SPLIT_BROTH].missedJustBefore).toEqual([shots[5]!.description, shots[6]!.description])
      expect(r.cues[SPLIT_BROTH]!.text).toBe(fold8)
      expect(r.rejected).toEqual([{ i: 0, text: 'Words appear: SINTEL. The man stirs a pot.', reason: 'on-screen text cue' }])
      // the action cue of the split shot keeps continuity with the cue before the text cue, not with the text cue
      const r2 = await editScene(split, shots, words, 'en', toolReply([{ cue: 2, text: 'The figure walks, falls. Logo fades.' }]), undefined, noShorten)
      expect(r2.applied).toHaveLength(1)
      expect(timing(r2.cues)).toEqual(timing(split))
    })
  })

  it('budgets a placed cue by its room at EDIT_WPS up to the next cue of any kind, never below its own length; an extended cue keeps its length', () => {
    // r2 cue 0: next cue starts 5604 → room 5454 ms → 11 words; cue 2 (9 words): room 3913 ms → 8 → stays 9; cue 3 "Fire burns." (2 words): room 1449 ms → 3; cue 4 (4 words): room 1700 ms → 3 → stays 4
    expect(editBudgets(r2cues)).toEqual([11, 11, 9, 3, 4, 4, 2, 4, 4])
    expect(editBudgets([{ startMs: 0, endMs: 100, text: 'Words appear: Berlin.', extended: true, wordCount: 3, shotIndex: 0 }])).toEqual([3])
    // a text pause 2 s into a placed cue's gap caps it: (2000 − 150) ms → 4 words
    expect(editBudgets([{ startMs: 0, endMs: 1000, text: 'A door.', extended: false, wordCount: 2, shotIndex: 0, limitMs: 9000 }, { startMs: 2000, endMs: 2100, text: 'Words appear: EXIT.', extended: true, wordCount: 3, shotIndex: 1 }])).toEqual([4, 3])
  })

  it('meters the call per model like other steps', async () => {
    const before = process.env.EDIT_MODEL_ID
    process.env.EDIT_MODEL_ID = 'amazon.nova-lite-v1:0'
    try {
      const { costUsd } = await metered(() => editScene(r2cues, shots, words, 'en', toolReply([], { inputTokens: 2000, outputTokens: 100 }), undefined, noShorten))
      expect(costUsd).toBeCloseTo(bedrockUsd('amazon.nova-lite-v1:0', { inputTokens: 2000, outputTokens: 100 }))
    } finally { if (before === undefined) delete process.env.EDIT_MODEL_ID; else process.env.EDIT_MODEL_ID = before }
  })

  it('sends the cues as heard (with the room left and the shots dropped just before each) plus the dialogue, and forces the emit_edits tool', async () => {
    const seen: ConverseCommandInput[] = []
    await editScene(roomy, shots, words, 'en', async (i) => { seen.push(i); return toolReply([])(i) }, undefined, noShorten)
    const req = seen[0]!
    const body = (req.messages![0]!.content![0] as { text: string }).text
    const input = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1))
    // by shot order (cue 5 for shot 7 starts 45 ms into shot 8): shots 5 and 6 under cue 5, shot 8 under cue 6 (shot 9), 10 and 11 under cue 7 (shot 12), 13 under cue 8
    expect(input.cues.map((c: { cue: number; missedJustBefore?: string[] }) => [c.cue, c.missedJustBefore?.length ?? 0])).toEqual([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 2], [6, 1], [7, 2], [8, 1]])
    expect(input.cues[BROTH]).toEqual({ cue: 5, start: 33.2, missedJustBefore: ['Red-haired girl watches man stir pot over fire.', shots[6]!.description], text: 'Old man pours broth.', mustStillSay: ['pours', 'broth'], words: 4, wordsYouMayAdd: 7 })
    expect(JSON.stringify(input)).not.toContain('Bearded man holds ornate staff') // a voiced shot's full description is not shown (the models restore it)
    expect(input.dialogue[0]).toMatchObject({ start: 16.92, speaker: 'spk_0', text: expect.stringContaining('This blade has a dark past.') })
    expect(req.toolConfig).toEqual({ tools: [{ toolSpec: { name: 'emit_edits', description: expect.any(String), inputSchema: { json: EDIT_TOOL_SCHEMA } } }], toolChoice: { tool: { name: 'emit_edits' } } })
    expect(req.inferenceConfig).toMatchObject({ temperature: 0 })
    expect(editRequest({ language: 'en', cues: [], dialogue: [] }, 'json').toolConfig).toBeUndefined()
  })

  it('works in windows of EDIT_CHUNK_CUES and tells the next window what the viewer just heard', async () => {
    const many: FitCue[] = Array.from({ length: EDIT_CHUNK_CUES + 5 }, (_, i) => ({ startMs: i * 3000, endMs: i * 3000 + 1000, text: 'Fire burns.', extended: false, wordCount: 2, shotIndex: i, limitMs: i * 3000 + 2500 }))
    const manyShots: Described[] = many.map((c) => ({ index: c.shotIndex, startMs: c.startMs, endMs: c.startMs + 3000, description: 'Dark room. Fire burns.', sameAsPrev: false, tokens: 0, outputTokens: 0 }))
    const seen: ConverseCommandInput[] = []
    const send: EditConverse = async (i) => { seen.push(i); return toolReply([{ cue: EDIT_CHUNK_CUES - 1, text: 'The fire burns.' }])(i) }
    const r = await editScene(many, manyShots, [], 'en', send, undefined, noShorten)
    expect(seen).toHaveLength(2)
    expect((seen[1]!.messages![0]!.content![0] as { text: string }).text).toContain('"heardJustBefore":"The fire burns."')
    expect(r.applied).toEqual([{ i: EDIT_CHUNK_CUES - 1, from: 'Fire burns.', to: 'The fire burns.' }])
    expect(r.rejected).toEqual([{ i: EDIT_CHUNK_CUES - 1, text: 'The fire burns.', reason: 'cue outside this window' }]) // the second window named a cue of the first
    expect(r.cues).toHaveLength(many.length)
  })

  describe('editCues step', () => {
    const work = async (cues: FitCue[] = roomy) => {
      const dir = await mkdtemp(join(tmpdir(), 'edit-'))
      const json = JSON.stringify(cues)
      await writeFile(join(dir, 'cues.json'), json); await writeFile(join(dir, FIT_CUES_FILE), json)
      await writeFile(join(dir, 'described.json'), JSON.stringify(shots)); await writeFile(join(dir, 'words.json'), JSON.stringify(words))
      return dir
    }
    const ctx = (dir: string) => ({ slug: 'x', source: '', language: 'en' as const, voice: 'Joanna', work: dir })
    const read = async (dir: string, f = 'cues.json') => JSON.parse(await readFile(join(dir, f), 'utf8')) as FitCue[]
    const withEnv = async (key: string, value: string | undefined, fn: () => Promise<void>) => {
      const before = process.env[key]
      if (value === undefined) delete process.env[key]; else process.env[key] = value
      try { await fn() } finally { if (before === undefined) delete process.env[key]; else process.env[key] = before }
    }
    beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}) })
    afterEach(() => { vi.restoreAllMocks() })
    const short = 'The man stirs a pot, then pours broth.'

    it('writes the revised cues.json in place and edit.json for the evaluation', async () => {
      const dir = await work()
      await editCues(ctx(dir), toolReply([{ cue: BROTH, text: short }]))
      const cues = await read(dir)
      expect(cues[BROTH]!.text).toBe(short)
      expect(timing(cues)).toEqual(timing(roomy))
      expect(await read(dir, FIT_CUES_FILE)).toEqual(roomy) // fit's copy is never touched
      expect(JSON.parse(await readFile(join(dir, 'edit.json'), 'utf8'))).toMatchObject({ applied: [{ i: BROTH }], rejected: [], usage: { inputTokens: 1000, outputTokens: 50 }, shorteningCalls: 0 })
    })
    it('is idempotent: running it again starts from cues.fit.json and sends the same input', async () => {
      const dir = await work()
      const seen: string[] = []
      const send: EditConverse = async (i) => { seen.push((i.messages![0]!.content![0] as { text: string }).text); return toolReply([{ cue: BROTH, text: short }])(i) }
      await editCues(ctx(dir), send)
      const first = await read(dir)
      await editCues(ctx(dir), send)
      expect(await read(dir)).toEqual(first)
      expect(seen[1]).toBe(seen[0]) // the second run never saw the first run's edits
    })
    it('restores fit\'s cues exactly with DESCRIBE_EDIT=0, also after an edited run, without a call', async () => {
      const dir = await work()
      await editCues(ctx(dir), toolReply([{ cue: BROTH, text: short }]))
      expect((await read(dir))[BROTH]!.text).toBe(short)
      const send = vi.fn(toolReply([{ cue: BROTH, text: short }]))
      await withEnv('DESCRIBE_EDIT', '0', () => editCues(ctx(dir), send))
      expect(send).not.toHaveBeenCalled()
      expect(await read(dir)).toEqual(roomy)
      expect(JSON.parse(await readFile(join(dir, 'edit.json'), 'utf8'))).toMatchObject({ skipped: true })
    })
    it('edits cues.json in place, with a warning, when an older work dir has no cues.fit.json', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'edit-'))
      await writeFile(join(dir, 'cues.json'), JSON.stringify(roomy)); await writeFile(join(dir, 'described.json'), JSON.stringify(shots)); await writeFile(join(dir, 'words.json'), JSON.stringify(words))
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await editCues(ctx(dir), toolReply([{ cue: BROTH, text: short }]))
      expect((await read(dir))[BROTH]!.text).toBe(short)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('not idempotent'))
    })
  })
})
