import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NEUTRAL_TEXT, neutralSpans, sentences, textSpans, withoutSpans } from '../src/textClause'
import { checkVerified, newVerifyReport, verifyReply } from '../src/steps/04b-verify'
import { parseDescription, type Converse, type RawReply } from '../src/steps/04-describe'
import { fit, introducesNew, textClauses } from '../src/steps/05-fit'
import { withoutSaidText } from '../src/steps/06-voice'
import { applyEdits } from '../src/steps/05b-edit'
import type { FitCue } from '../src/steps/05-fit'
import { describeSystemPrompt, ON_SCREEN_TEXT_RULE } from '../src/prompts'
import { verifySystemPrompt } from '../src/verifyPrompt'
import { plotEvents } from '../src/plotEvent'

/**
 * DESC-031 (docs/decisions/0013-legible-text.md): on-screen text is quoted only when fully legible. Held-out Gate C (Tears of Steel
 * 6:30–8:30, run g10) shot 4: describe wrote a quote of handwritten text that was partly hidden, and misread a word; verify skipped
 * the text-only draft. The strings below are made up for the tests; the clip's own text is never put in a prompt.
 */
const opts = { maxWords: 25, names: [] as string[] }
const de = { ...opts, language: 'de' as const }
const MODEL = 'qwen.qwen3-vl-235b-a22b'
const frames = [new Uint8Array([1, 2, 3])]
const json = (text: string, removed: string[] = []) => JSON.stringify({ text, removed })
const reply = (text: string) => ({ output: { message: { role: 'assistant' as const, content: [{ text }] } }, usage: { inputTokens: 2400, outputTokens: 40, totalTokens: 2440 }, stopReason: 'end_turn' as const })
const raw = (text: string): RawReply => ({ text, usage: { inputTokens: 2200, outputTokens: 13 }, stopReason: 'end_turn' })
const shot = (index: number, language: 'en' | 'de' = 'en') => ({ index, language, maxWords: 25, names: [] as string[] })

describe('describe prompt: quote on-screen text only when every word is legible', () => {
  const en = describeSystemPrompt({ maxWords: 12, knownNames: [], language: 'en' })
  it('asks for a quote only when every word is clearly legible, and for the kind of text otherwise', () => {
    for (const s of ['only when every word is clearly legible', 'quote it verbatim after "Words appear:"', 'hidden, cut off or blurred', 'do not quote any of it', 'say what kind of text appears instead', 'Never invent or guess text.'])
      expect(en).toContain(s)
    expect(en).toContain('always this label, never "headline:" or "a sign reads"') // decision 0008 unchanged
  })
  it('carries no quotable example sentence from the evaluation clip', () => {
    for (const w of ['CELIA', 'COLA', 'LOVE', 'HAND', 'pink', 'Pink', 'robot']) expect(en).not.toMatch(new RegExp(`\\b${w}\\b`))
    const example = /\(e\.g\. "([^"]+)"\)/.exec(ON_SCREEN_TEXT_RULE)![1]!
    expect(textSpans(example)).toEqual([]) // the example is not itself a quote, nor the neutral sentence
    expect(neutralSpans(example)).toEqual([])
    expect(en).toContain(`- ${ON_SCREEN_TEXT_RULE}`)
  })
})

describe('verify prompt: a text clause is kept verbatim or becomes the neutral sentence', () => {
  it('names the two allowed outcomes and forbids a corrected quote, per language', () => {
    const en = verifySystemPrompt('en', 10)
    for (const s of ['every quoted word is fully legible in the frames and exactly right', 'exactly as written', 'hidden, cut off, blurred or misread', 'replace the whole clause with exactly "Words appear."', 'Never write a corrected quote', 'never add on-screen text'])
      expect(en).toContain(s)
    expect(verifySystemPrompt('de', 10)).toContain('replace the whole clause with exactly "Text erscheint."')
    expect(en).toContain('"Text erscheint:"') // the German label is still named
  })
})

describe('neutral sentence: not a text clause anywhere downstream', () => {
  it('textClause: no span, its own sentence, never the label', () => {
    for (const t of [NEUTRAL_TEXT.en, NEUTRAL_TEXT.de, 'A robot arm moves. Words appear.', 'Words appear. Snow falls.']) {
      expect(textSpans(t), t).toEqual([])
      expect(textClauses(t), t).toBeUndefined()
      expect(introducesNew(t), t).toBe(false)
    }
    expect(sentences('A robot arm moves. Words appear. A man looks up.')).toEqual(['A robot arm moves.', 'Words appear.', 'A man looks up.'])
    expect(neutralSpans('A robot arm moves. Words appear. Text erscheint.').map((s) => s.start)).toEqual([19, 33])
    expect(neutralSpans('Handwritten words appear on a sign.')).toEqual([]) // only the whole fixed sentence
    expect(neutralSpans('A man reads. Words appear on the wall.')).toEqual([])
    expect(withoutSpans('A man looks up. Words appear.', neutralSpans('A man looks up. Words appear.'))).toBe('A man looks up.')
  })
  it('describe: parseDescription keeps it (only a bare trailing "Words appear:" label is dropped)', () => {
    expect(parseDescription('Words appear.', '')).toEqual({ description: 'Words appear.', sameAsPrev: false })
    expect(parseDescription('A robot arm moves. Words appear.', '').description).toBe('A robot arm moves. Words appear.')
  })
  it('fit: placed and voiced as a plain cue, not split into a text pause', async () => {
    const shorten = (t: string) => t
    const cues = await fit([{ index: 0, startMs: 1000, endMs: 4000, description: 'Words appear.', sameAsPrev: false, tokens: 0, outputTokens: 0 }], [{ startMs: 1000, endMs: 4000 }], shorten)
    expect(cues).toMatchObject([{ text: 'Words appear.', extended: false, wordCount: 2 }])
    const mixed = await fit([{ index: 0, startMs: 1000, endMs: 6000, description: 'A robot arm moves. Words appear.', sameAsPrev: false, tokens: 0, outputTokens: 0 }], [{ startMs: 1000, endMs: 6000 }], shorten)
    expect(mixed.map((c) => c.text)).toEqual(['A robot arm moves. Words appear.'])
  })
  it('voice: withoutSaidText leaves it alone (it is not a quote that can be "already said")', () => {
    expect(withoutSaidText('A man stands. Words appear.', ['', 'Words appear.', 'words appear'])).toBe('A man stands. Words appear.')
  })
  it('plot events: none', () => {
    expect(plotEvents('Words appear.', '')).toEqual([])
  })
  it('edit: turning it into a quote is an added text clause and is rejected; a plain edit around it is not', () => {
    const cues: FitCue[] = [{ startMs: 0, endMs: 2000, text: 'A man stands. Words appear.', extended: false, wordCount: 5, shotIndex: 0, limitMs: 6000 }]
    const shots = [{ index: 0, startMs: 0, endMs: 3000, description: 'A man stands. Words appear.', sameAsPrev: false, tokens: 0, outputTokens: 0 }]
    expect(applyEdits(cues, shots, [{ cue: 0, text: 'A man stands. Words appear: "EXIT".' }], [12]).rejected).toMatchObject([{ reason: 'on-screen text clause added' }])
    expect(applyEdits(cues, shots, [{ cue: 0, text: 'The man stands. Words appear.' }], [12]).applied).toHaveLength(1)
  })
})

describe('checkVerified: a text clause is kept verbatim or replaced by the neutral sentence, nothing else', () => {
  const TEXT_ONLY = 'Words appear: QUIET PLEASE NOW'
  const MIXED = 'A woman waves. Words appear: "GATE 4". A bus leaves.'
  it('accepts the neutral sentence in place of a quoted clause, alone or among description', () => {
    expect(checkVerified(TEXT_ONLY, { text: 'Words appear.', removed: [TEXT_ONLY] }, opts)).toEqual({ text: 'Words appear.', applied: true, textRemoved: [TEXT_ONLY] })
    expect(checkVerified(MIXED, { text: 'A woman waves. Words appear. A bus leaves.', removed: [] }, opts)).toEqual({ text: 'A woman waves. Words appear. A bus leaves.', applied: true, textRemoved: ['Words appear: "GATE 4".'] })
    // with a description deletion at the same time
    expect(checkVerified(MIXED, { text: 'Words appear. A bus leaves.', removed: [] }, opts)).toMatchObject({ applied: true, textRemoved: ['Words appear: "GATE 4".'] })
    // an unlabelled clause and its trailing modifier go as a whole
    expect(checkVerified('A sign reads "EXIT" in red.', { text: 'Words appear.', removed: [] }, opts)).toMatchObject({ applied: true, textRemoved: ['A sign reads "EXIT" in red.'] })
    expect(checkVerified('Ein Mann winkt. Text erscheint: "AUSGANG".', { text: 'Ein Mann winkt. Text erscheint.', removed: [] }, de)).toMatchObject({ applied: true })
  })
  it('accepts a clause kept verbatim, and records nothing removed', () => {
    expect(checkVerified(TEXT_ONLY, { text: TEXT_ONLY, removed: [] }, opts)).toEqual({ text: TEXT_ONLY, applied: true })
  })
  it('rejects a corrected quote: a model correction of a misread is itself a guess', () => {
    for (const text of ['Words appear: QUIET PLEASE', 'Words appear: QUIET PLEASE NOW!', 'Words appear: "QUIET PLEASE NOW"', 'Words appear: QUITE PLEASE NOW'])
      expect(checkVerified(TEXT_ONLY, { text, removed: [] }, opts), text).toEqual({ text: TEXT_ONLY, applied: false, reason: 'on-screen text changed' })
  })
  it('rejects every other change to the text clauses', () => {
    const bad: [string, string][] = [
      [TEXT_ONLY, 'Text erscheint.'], // the other language's sentence
      [TEXT_ONLY, 'Words appear'], // not the fixed sentence
      [TEXT_ONLY, 'Words appear on a screen.'],
      [MIXED, 'A woman waves. A bus leaves.'], // dropped, not replaced
      [MIXED, 'A woman waves. Words appear. Words appear. A bus leaves.'], // one clause, two sentences
      ['A man runs.', 'A man runs. Words appear.'], // added
      ['A man runs. Words appear.', 'A man runs. Words appear: "STOP".'], // a neutral sentence never becomes a quote
      ['Words appear: "A". Words appear: "B".', 'Words appear: "B". Words appear.'], // order
    ]
    for (const [draft, text] of bad) expect(checkVerified(draft, { text, removed: [] }, opts), `${draft} → ${text}`).toEqual({ text: draft, applied: false, reason: 'on-screen text changed' })
    expect(checkVerified('Text erscheint: "AUSGANG".', { text: 'Words appear.', removed: [] }, de)).toMatchObject({ applied: false, reason: 'on-screen text changed' })
  })
  it('rejects description words put in place of the clause (the clause\'s words are not the draft\'s description)', () => {
    expect(checkVerified(TEXT_ONLY, { text: 'Words appear. A robot arm covers them.', removed: [] }, opts)).toMatchObject({ applied: false, reason: 'new words: robot, arm, covers, them' })
    expect(checkVerified('Words appear: "TEARS" in metallic silver.', { text: 'Words appear. In metallic silver.', removed: [] }, opts)).toMatchObject({ applied: false, reason: 'new words: in, metallic, silver' })
    expect(checkVerified('A man waits. Words appear: "QUIET".', { text: 'A quiet man waits. Words appear.', removed: [] }, opts)).toMatchObject({ applied: false, reason: 'new words: quiet' })
  })
})

describe('verifyReply: on-screen text drafts are checked, not skipped', () => {
  it('calls Bedrock for a text-only draft and records the replaced clause in verify.json', async () => {
    const send = vi.fn<Converse>(async () => reply(json('Words appear.', ['Words appear: QUIET PLEASE NOW'])))
    const report = newVerifyReport(MODEL)
    const r = await verifyReply(await mkdtemp(join(tmpdir(), 'legible-')), frames, raw('Words appear: QUIET PLEASE NOW'), send, report, shot(4))
    expect(send).toHaveBeenCalledTimes(1)
    expect(r.text).toBe('Words appear.')
    expect(report.shots).toEqual([{ index: 4, draft: 'Words appear: QUIET PLEASE NOW', text: 'Words appear.', removed: ['Words appear: QUIET PLEASE NOW'], applied: true, changed: true, cached: false, textRemoved: ['Words appear: QUIET PLEASE NOW'] }])
  })
  it('keeps the draft and records why when the reply corrects the quote', async () => {
    const send = vi.fn<Converse>(async () => reply(json('Words appear: QUIET PLEASE')))
    const report = newVerifyReport(MODEL)
    expect((await verifyReply(await mkdtemp(join(tmpdir(), 'legible-')), frames, raw('Words appear: QUIET PLEASE NOW'), send, report, shot(4))).text).toBe('Words appear: QUIET PLEASE NOW')
    expect(report.shots[0]).toMatchObject({ applied: false, reason: 'on-screen text changed', reply: 'Words appear: QUIET PLEASE' })
  })
  it('does not call Bedrock for a draft that is only the neutral sentence', async () => {
    const send = vi.fn<Converse>(async () => reply(json('x')))
    const report = newVerifyReport(MODEL)
    for (const t of ['Words appear.', 'Text erscheint.']) expect((await verifyReply(await mkdtemp(join(tmpdir(), 'legible-')), frames, raw(t), send, report, shot(0))).text).toBe(t)
    expect(send).not.toHaveBeenCalled()
  })
})
