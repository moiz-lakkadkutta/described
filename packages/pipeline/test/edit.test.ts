import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime'
import { applyEdits, dialogueTurns, EDIT_CHUNK_CUES, editBudgets, editCues, editScene, replyEdits, stems, unfaithfulWords } from '../src/steps/05b-edit'
import { editRequest, EDIT_TOOL_SCHEMA, type EditConverse } from '../src/prompts'
import type { FitCue } from '../src/steps/05-fit'
import type { Described } from '../src/steps/04-describe'
import type { Word } from '../src/steps/03-speech'
import { bedrockUsd, metered } from '../src/cost'

// sintel-90-150-r2 (2026-10-09): 15 shots, 9 voiced cues as heard on the device; shot 5 ("Red-haired girl watches man stir pot over fire.") was dropped by fit.
const fx = (f: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', `sintel-90-150-r2.${f}.json`), 'utf8'))
const shots = fx('described') as Described[]
const r2cues = fx('cues') as FitCue[]
const words = fx('words') as Word[]
const BROTH = 5 // cues.json index of "Old man pours broth." (shot 7)

/** A recorded reply: the forced emit_edits tool call with these edits. */
type Reply = Awaited<ReturnType<EditConverse>>
const toolReply = (edits: unknown, usage = { inputTokens: 1000, outputTokens: 50 }): EditConverse => async () => ({ output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 't1', name: 'emit_edits', input: { edits } } }] } }, usage }) as unknown as Reply
const textReply = (text: string): EditConverse => async () => ({ output: { message: { role: 'assistant', content: [{ text }] } }, usage: { inputTokens: 1000, outputTokens: 10 } }) as unknown as Reply
const timing = (cs: readonly FitCue[]) => cs.map(({ startMs, endMs, limitMs, extended, shotIndex }) => ({ startMs, endMs, limitMs, extended, shotIndex }))
/** r2 cues with the broth cue's gap widened so a fold has room (on r2 itself that gap is 1.65 s: 4 words). */
const roomy = r2cues.map((c, i) => (i === BROTH ? { ...c, limitMs: 38300 } : c))

describe('edit (scene-level context pass)', () => {
  it('folds a dropped fact into the next voiced cue within budget', async () => {
    const folded = 'The man stirs a pot over the fire, then pours broth.' // shot 5 (dropped) + shot 7's cue
    expect(editBudgets(roomy)[BROTH]).toBe(11)
    const r = await editScene(roomy, shots, words, 'en', toolReply([{ cue: BROTH, text: folded }]))
    expect(r.cues[BROTH]).toMatchObject({ text: folded, wordCount: 11, shotIndex: 7, startMs: 33170 })
    expect(r.applied).toEqual([{ i: BROTH, from: 'Old man pours broth.', to: folded }])
    expect(r.rejected).toEqual([])
    expect(r.cues.filter((_, i) => i !== BROTH).map((c) => c.text)).toEqual(r2cues.filter((_, i) => i !== BROTH).map((c) => c.text))
  })

  it('rejects an edit that exceeds the cue word budget', async () => {
    const r = await editScene(r2cues, shots, words, 'en', toolReply([{ cue: BROTH, text: 'The man stirs a pot over the fire, then pours broth.' }]), undefined, (t) => t)
    expect(editBudgets(r2cues)[BROTH]).toBe(4)
    expect(r.cues[BROTH]!.text).toBe('Old man pours broth.')
    expect(r.rejected).toEqual([{ i: BROTH, text: 'The man stirs a pot over the fire, then pours broth.', reason: 'over budget (11 > 4 words)' }])
  })

  // Probe round 5 (Nova Lite): the fold came back as the two descriptions glued together, 17 words into an 11-word room.
  it('shortens an over-budget edit once and keeps it only when it then fits and passes the guards', async () => {
    const glued = 'A red-haired girl watches a man stir a pot over a fire. The old man pours broth.'
    const asked: [string, number, string][] = []
    const shorten = (t: string, n: number, keep: string) => { asked.push([t, n, keep]); return 'The man stirs a pot over the fire, then pours broth.' }
    const r = await editScene(roomy, shots, words, 'en', toolReply([{ cue: BROTH, text: glued }]), undefined, shorten)
    expect(asked).toEqual([[glued, 11, 'Old man pours broth.']])
    expect(r.cues[BROTH]!.text).toBe('The man stirs a pot over the fire, then pours broth.')
    expect(r.applied).toEqual([{ i: BROTH, from: 'Old man pours broth.', to: 'The man stirs a pot over the fire, then pours broth.' }])
    // the shortening lost the cue's own fact → the original stays
    const r2 = await editScene(roomy, shots, words, 'en', toolReply([{ cue: BROTH, text: glued }]), undefined, () => 'A red-haired girl watches a man stir a pot.')
    expect(r2.cues[BROTH]!.text).toBe('Old man pours broth.')
    expect(r2.rejected.map((x) => x.reason)).toEqual(['drops a fact: pours, broth (after shortening)'])
    // still too long → the original stays
    const r3 = await editScene(roomy, shots, words, 'en', toolReply([{ cue: BROTH, text: glued }]), undefined, () => 'A red-haired girl watches a man stir a pot over a fire, then pours broth.')
    expect(r3.cues[BROTH]!.text).toBe('Old man pours broth.')
    expect(r3.rejected.map((x) => x.reason)).toEqual(['over budget (15 > 11 words) (after shortening)'])
  })

  it('rejects an edit that introduces a word not in any shot description', () => {
    const r = applyEdits(r2cues, shots, [
      { cue: BROTH, text: 'The man pours wine into a cup.' }, // wine, cup: nowhere
      { cue: 4, text: 'Bearded man holds staff; the girl accepts a bowl.' }, // girl: shot 5, accepts/bowl: shot 8 — both after this cue's shot 4 ("never before")
      { cue: 6, text: 'The fire glows in the tent.' }, // shot 9 "Tent interior. Fire glows." — allowed
      { cue: 8, text: 'Darkness. A veiled face rises.' }, // shot 11 was dropped two cues earlier (under cue 7): a dropped fact goes into the next cue only
      { cue: 7, text: 'The bearded man speaks in the same tent.' }, // "tent" from the previous cue's text ("Tent glows.") — continuity, allowed
    ], r2cues.map(() => 25)) // budgets out of the way: this test is about words
    expect(r.rejected.map((x) => [x.i, x.reason])).toEqual([[BROTH, 'not in any shot description: wine, cup'], [4, 'not in any shot description: girl, accepts, bowl'], [8, 'not in any shot description: veiled, face, rises']])
    expect(r.cues[BROTH]!.text).toBe('Old man pours broth.')
    expect(r.cues[4]!.text).toBe('Bearded man holds staff.')
    expect(r.cues[6]!.text).toBe('The fire glows in the tent.')
    expect(r.cues[7]!.text).toBe('The bearded man speaks in the same tent.')
  })

  it('keeps every fact of the original unless the previous cue already said it or it is a droppable adjective', () => {
    const r = applyEdits(roomy, shots, [
      { cue: 1, text: 'A figure walks, falls.' }, // "Logo fades." is gone — Nova Lite did this in 2 of 3 probe replies
      { cue: 2, text: 'Darkness. A fire glows in a stone pit.' }, // "faint" is a droppable adjective
      { cue: BROTH, text: 'The man stirs a pot over the fire, then pours broth.' }, // "old" is droppable
    ], roomy.map(() => 25))
    expect(r.rejected).toEqual([{ i: 1, text: 'A figure walks, falls.', reason: 'drops a fact: logo, fades' }])
    expect(r.applied.map((a) => a.i)).toEqual([2, BROTH])
    // "Snowy mountains." was cue 0's; cue 1 may lose it
    expect(applyEdits(roomy, shots, [{ cue: 1, text: 'A figure walks, falls. Logo fades.' }]).applied).toHaveLength(1)
  })

  it('allows inflections of a described word through a simple stem, never a new word', () => {
    expect(unfaithfulWords('The man stirs the pot, then pours broth.', ['Red-haired girl watches man stir pot over fire.', 'Old man pours broth.'])).toEqual([])
    expect(unfaithfulWords('Sparks drifting. The figure falling.', ['Faint red sparks drift downward.', 'A figure walks, falls.'])).toEqual([])
    expect(unfaithfulWords('A red-haired woman rises.', ['Red-haired woman opens eyes.'])).toEqual(['rises'])
    expect(stems('stirring')).toContain('stir')
    expect(stems('rising')).toContain('rise')
    expect(stems('falling')).toContain('fall')
    expect(stems('red')).not.toContain('r')
    expect(stems('bowls')).toContain('bowl')
  })

  it('falls back to the original cues on an invalid reply', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const send of [textReply('Sorry, I cannot help with that.'), textReply('{"cues":[]}'), toolReply({ not: 'a list' })] as EditConverse[]) {
      const r = await editScene(r2cues, shots, words, 'en', send)
      expect(r.cues).toEqual(r2cues)
      expect(r.applied).toEqual([])
    }
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
    expect(replyEdits('```json\n{"edits":[{"cue":"5","text":"x"}]}\n```')).toEqual([{ cue: 5, text: 'x' }])
    expect(replyEdits({ edits: [] })).toEqual([])
  })

  it('asks once more for JSON text when the forced tool call fails, then keeps the originals', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const modes: string[] = []
    const send: EditConverse = async (i) => { modes.push(i.toolConfig ? 'tool' : 'json'); if (i.toolConfig) throw new Error('Model produced invalid sequence as part of ToolUse'); return textReply('{"edits":[{"cue":5,"text":"The man stirs a pot over the fire, then pours broth."}]}')(i) }
    const r = await editScene(roomy, shots, words, 'en', send)
    expect(modes).toEqual(['tool', 'json'])
    expect(r.cues[BROTH]!.text).toBe('The man stirs a pot over the fire, then pours broth.')
    const r2 = await editScene(roomy, shots, words, 'en', async () => { throw new Error('ServiceUnavailableException') })
    expect(r2.cues).toEqual(roomy)
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })

  it('rethrows when the job was aborted instead of keeping the originals', async () => {
    const ac = new AbortController(); ac.abort(new Error('time is up'))
    await expect(editScene(r2cues, shots, words, 'en', async () => { throw ac.signal.reason }, ac.signal)).rejects.toThrow('time is up')
  })

  it('never changes cue timing or count', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await editScene(roomy, shots, words, 'en', toolReply([
      { cue: 42, text: 'A dragon lands.' }, { cue: -1, text: 'Darkness.' }, { cue: 1.5, text: 'Darkness.' },
      { cue: 3, text: 'The fire burns.' }, { cue: 3, text: 'Fire.' }, // second edit of one cue ignored
      { cue: 0, text: 'Snowy mountains.\nA lone figure walks left.' }, { cue: 2, text: '' },
      { cue: BROTH, text: 'The man stirs a pot over the fire, then pours broth.' },
    ]))
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
    expect(r.rejected.map((x) => [x.i, x.reason])).toEqual([[0, 'Words appear clause changed'], [1, 'Words appear clause added']])
    // cue 1 may lose "Snowy mountains" (cue 0 said it) but nothing else
    expect(applyEdits(cues, shots, [{ cue: 0, text: ok }, { cue: 1, text: 'The figure walks, then falls. Logo fades.' }]).cues.map((c) => c.text)).toEqual([ok, 'The figure walks, then falls. Logo fades.'])
  })

  it('budgets a placed cue by its room at EDIT_WPS, never below its own length, and an extended cue at 25', () => {
    // cue 0: next placed cue starts 5604 → room 5454 ms → 11 words; cue 2 (9 words): room 3913 ms → 8 → stays 9; cue 3 "Fire burns." (2 words): room 1449 ms → 3; cue 4 (4 words): room 1700 ms → 3 → stays 4
    expect(editBudgets(r2cues)).toEqual([11, 11, 9, 3, 4, 4, 2, 4, 4])
    expect(editBudgets([{ startMs: 0, endMs: 100, text: 'Words appear: Berlin.', extended: true, wordCount: 3, shotIndex: 0 }])).toEqual([25])
  })

  it('meters the call per model like other steps', async () => {
    process.env.EDIT_MODEL_ID = 'amazon.nova-lite-v1:0'
    const { costUsd } = await metered(() => editScene(r2cues, shots, words, 'en', toolReply([], { inputTokens: 2000, outputTokens: 100 })))
    expect(costUsd).toBeCloseTo(bedrockUsd('amazon.nova-lite-v1:0', { inputTokens: 2000, outputTokens: 100 }))
    delete process.env.EDIT_MODEL_ID
  })

  it('sends one timeline of voiced cues (as heard, with the room left) and dropped shots, plus the dialogue, and forces the emit_edits tool', () => {
    const budgets = editBudgets(roomy)
    const req = editRequest({ language: 'en', shots, cues: roomy.map((c, i) => ({ ...c, i, budget: budgets[i]! })), dialogue: dialogueTurns(words, 0, 60000) })
    const body = (req.messages![0]!.content![0] as { text: string }).text
    const input = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1))
    // Dropped shots go under the cue that may absorb them, by shot order (cue 5 for shot 7 starts 45 ms into shot 8, so time order would put shot 8 before it):
    // shots 5 and 6 under cue 5 (shot 7), shot 8 under cue 6 (shot 9), 10 and 11 under cue 7 (shot 12), 13 under cue 8
    expect(input.cues.map((c: { cue: number; missedJustBefore?: string[] }) => [c.cue, c.missedJustBefore?.length ?? 0])).toEqual([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 2], [6, 1], [7, 2], [8, 1]])
    expect(input.cues[BROTH]).toEqual({ cue: 5, start: 33.2, missedJustBefore: ['Red-haired girl watches man stir pot over fire.', shots[6]!.description], text: 'Old man pours broth.', words: 4, wordsYouMayAdd: 7 })
    expect(JSON.stringify(input)).not.toContain('Bearded man holds ornate staff') // a voiced shot's full description is not shown (the models restore it)
    expect(input.dialogue[0]).toMatchObject({ start: 16.92, speaker: 'spk_0', text: expect.stringContaining('This blade has a dark past.') })
    expect(req.toolConfig).toEqual({ tools: [{ toolSpec: { name: 'emit_edits', description: expect.any(String), inputSchema: { json: EDIT_TOOL_SCHEMA } } }], toolChoice: { tool: { name: 'emit_edits' } } })
    expect(req.inferenceConfig).toMatchObject({ temperature: 0 })
  })

  it('works in windows of EDIT_CHUNK_CUES and tells the next window what the viewer just heard', async () => {
    const many: FitCue[] = Array.from({ length: EDIT_CHUNK_CUES + 5 }, (_, i) => ({ startMs: i * 3000, endMs: i * 3000 + 1000, text: 'Fire burns.', extended: false, wordCount: 2, shotIndex: i, limitMs: i * 3000 + 2500 }))
    const manyShots: Described[] = many.map((c) => ({ index: c.shotIndex, startMs: c.startMs, endMs: c.startMs + 3000, description: 'Dark room. Fire burns.', sameAsPrev: false, tokens: 0, outputTokens: 0 }))
    const seen: ConverseCommandInput[] = []
    const send: EditConverse = async (i) => { seen.push(i); return toolReply([{ cue: EDIT_CHUNK_CUES - 1, text: 'The fire burns.' }])(i) }
    const r = await editScene(many, manyShots, [], 'en', send)
    expect(seen).toHaveLength(2)
    expect((seen[1]!.messages![0]!.content![0] as { text: string }).text).toContain('"heardJustBefore":"The fire burns."')
    expect(r.applied).toEqual([{ i: EDIT_CHUNK_CUES - 1, from: 'Fire burns.', to: 'The fire burns.' }])
    expect(r.rejected).toEqual([{ i: EDIT_CHUNK_CUES - 1, text: 'The fire burns.', reason: 'cue outside this window' }]) // the second window named a cue of the first
    expect(r.cues).toHaveLength(many.length)
  })

  describe('editCues step', () => {
    const work = async () => {
      const dir = await mkdtemp(join(tmpdir(), 'edit-'))
      await writeFile(join(dir, 'cues.json'), JSON.stringify(roomy)); await writeFile(join(dir, 'described.json'), JSON.stringify(shots)); await writeFile(join(dir, 'words.json'), JSON.stringify(words))
      return dir
    }
    const ctx = (dir: string) => ({ slug: 'x', source: '', language: 'en' as const, voice: 'Joanna', work: dir })
    it('writes the revised cues.json in place and edit.json for the evaluation', async () => {
      const dir = await work()
      vi.spyOn(console, 'log').mockImplementation(() => {})
      await editCues(ctx(dir), toolReply([{ cue: BROTH, text: 'The man stirs a pot, then pours broth.' }]))
      const cues = JSON.parse(await readFile(join(dir, 'cues.json'), 'utf8')) as FitCue[]
      expect(cues[BROTH]!.text).toBe('The man stirs a pot, then pours broth.')
      expect(timing(cues)).toEqual(timing(roomy))
      expect(JSON.parse(await readFile(join(dir, 'edit.json'), 'utf8'))).toMatchObject({ applied: [{ i: BROTH }], rejected: [], usage: { inputTokens: 1000, outputTokens: 50 } })
      vi.restoreAllMocks()
    })
    it('skips the call with DESCRIBE_EDIT=0 so an evaluation can compare', async () => {
      const dir = await work()
      process.env.DESCRIBE_EDIT = '0'
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const send = vi.fn(toolReply([{ cue: BROTH, text: 'The man stirs a pot, then pours broth.' }]))
      await editCues(ctx(dir), send)
      delete process.env.DESCRIBE_EDIT
      expect(send).not.toHaveBeenCalled()
      expect(JSON.parse(await readFile(join(dir, 'cues.json'), 'utf8'))).toEqual(roomy)
      expect(JSON.parse(await readFile(join(dir, 'edit.json'), 'utf8'))).toMatchObject({ skipped: true })
      vi.restoreAllMocks()
    })
  })
})
