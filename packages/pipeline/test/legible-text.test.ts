import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collapseNeutral, NEUTRAL_TEXT, neutralSpans, sentences, textSpans, withoutSpans } from '../src/textClause'
import { readsAsSentences } from '../src/sentenceGuard'
import { checkVerified, newVerifyReport, verifyReply } from '../src/steps/04b-verify'
import { parseDescription, type Converse, type RawReply } from '../src/steps/04-describe'
import { fit, introducesNew, safeShorten, textClauses } from '../src/steps/05-fit'
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
    for (const s of ['only when every word is clearly legible', 'quote it verbatim after "Words appear:"', 'hidden, cut off or blurred', 'do not quote any of it', 'say in your own words only what kind of text it is and what it is on', 'Never invent or guess text.'])
      expect(en).toContain(s)
    expect(en).toContain('always this label, never "headline:" or "a sign reads"') // decision 0008 unchanged
  })
  it('carries no quotable example sentence from the evaluation clip', () => {
    for (const w of ['CELIA', 'COLA', 'LOVE', 'HAND', 'pink', 'Pink', 'robot']) expect(en).not.toMatch(new RegExp(`\\b${w}\\b`))
    // review M1: no example sentence the model could copy; the only quoted strings are the label and the two forms it replaces (0008)
    const quoted = [...ON_SCREEN_TEXT_RULE.matchAll(/"([^"]*)"/g)].map((m) => m[1]!)
    expect(quoted).toEqual(['Words appear:', 'headline:', 'a sign reads'])
    for (const q of quoted) expect(q, q).not.toMatch(/[.!?]$/)
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

describe('checkVerified: review round 1 (PR #56)', () => {
  const NOTE = 'A man reads a note: "MEET ME". He leaves.'
  it('M2: an unlabelled clause may keep its carrier action when its quote becomes the neutral sentence', () => {
    expect(checkVerified(NOTE, { text: 'A man reads a note. Words appear. He leaves.', removed: [] }, opts)).toEqual({ text: 'A man reads a note. Words appear. He leaves.', applied: true, textRemoved: ['A man reads a note: "MEET ME".'] })
    expect(checkVerified(NOTE, { text: 'Words appear. He leaves.', removed: [] }, opts)).toMatchObject({ applied: true }) // dropping the carrier is a deletion
    expect(checkVerified(NOTE, { text: 'A man reads a note. Words appear.', removed: [] }, opts)).toMatchObject({ applied: true })
    expect(checkVerified('A soldier grabs the rifle as a sign reads "EXIT".', { text: 'A soldier grabs the rifle as a sign reads. Words appear.', removed: [] }, opts)).toMatchObject({ applied: true })
    expect(checkVerified('Hand holds crumpled newspaper headline: ROBOTICIST CREATES KILLER ROBOTS', { text: 'Hand holds crumpled newspaper. Words appear.', removed: [] }, opts)).toMatchObject({ applied: true })
  })
  it('M2: new words beside a kept carrier are still rejected; only the words before the quote are the carrier', () => {
    expect(checkVerified(NOTE, { text: 'A man reads a red note. Words appear. He leaves.', removed: [] }, opts)).toMatchObject({ applied: false, reason: 'new words: red' })
    expect(checkVerified(NOTE, { text: 'A man reads a note. Words appear. He leaves quickly.', removed: [] }, opts)).toMatchObject({ applied: false, reason: 'new words: quickly' })
    expect(checkVerified(NOTE, { text: 'A man reads a note. Words appear: "MEET ME". He leaves.', removed: [] }, opts)).toMatchObject({ applied: false, reason: 'on-screen text changed' })
    expect(checkVerified(NOTE, { text: 'A man reads a note: "MEET MEN". He leaves.', removed: [] }, opts)).toMatchObject({ applied: false, reason: 'on-screen text changed' })
    // a kept quote's carrier is not free: the words before a kept clause are its own, not description words
    expect(checkVerified('A dog barks. A sign reads "EXIT".', { text: 'A sign barks. A sign reads "EXIT".', removed: [] }, opts)).toMatchObject({ applied: false, reason: 'new words: sign' })
  })
  it('L1: the neutral sentence stays where the clause was among the description sentences', () => {
    const MIXED = 'A woman waves. Words appear: "GATE 4". A bus leaves.'
    for (const text of ['Words appear. A woman waves. A bus leaves.', 'A woman waves. A bus leaves. Words appear.'])
      expect(checkVerified(MIXED, { text, removed: [] }, opts), text).toEqual({ text: MIXED, applied: false, reason: 'on-screen text changed' })
    expect(checkVerified(MIXED, { text: 'A woman waves. A bus leaves. Words appear: "GATE 4".', removed: [] }, opts)).toMatchObject({ applied: false, reason: 'on-screen text changed' }) // a kept quote may not move either
    expect(checkVerified(NOTE, { text: 'Words appear. A man reads a note. He leaves.', removed: [] }, opts)).toMatchObject({ applied: false, reason: 'on-screen text changed' })
    expect(checkVerified(MIXED, { text: 'A woman waves. Words appear.', removed: [] }, opts)).toMatchObject({ applied: true }) // deletions around it are fine
  })
  it('L2: adjacent neutral sentences collapse into one', () => {
    expect(checkVerified('Words appear: "A". Words appear: "B".', { text: 'Words appear. Words appear.', removed: [] }, opts)).toEqual({ text: 'Words appear.', applied: true, textRemoved: ['Words appear: "A".', 'Words appear: "B".'] })
    expect(checkVerified('Words appear: "A". Words appear: "B". A man runs.', { text: 'Words appear. Words appear. A man runs.', removed: [] }, opts)).toMatchObject({ text: 'Words appear. A man runs.', applied: true })
    expect(checkVerified('Text erscheint: "A". Text erscheint: "B".', { text: 'Text erscheint. Text erscheint.', removed: [] }, de)).toMatchObject({ text: 'Text erscheint.', applied: true })
    expect(checkVerified('A woman waves. Words appear: "GATE 4". A bus leaves.', { text: 'A woman waves. Words appear. Words appear. A bus leaves.', removed: [] }, opts)).toMatchObject({ text: 'A woman waves. Words appear. A bus leaves.', applied: true })
    expect(checkVerified('Words appear: "A". Words appear: "B".', { text: 'Words appear. Words appear: "B".', removed: [] }, opts)).toMatchObject({ applied: true, textRemoved: ['Words appear: "A".'] })
    expect(checkVerified('Words appear: "A". A man runs. Words appear: "B".', { text: 'Words appear. A man runs. Words appear.', removed: [] }, opts)).toMatchObject({ applied: true, textRemoved: ['Words appear: "A".', 'Words appear: "B".'] })
    expect(collapseNeutral('Words appear. A man runs. Words appear.')).toBe('Words appear. A man runs. Words appear.') // not adjacent
    expect(parseDescription('Words appear. Words appear.', '').description).toBe('Words appear.')
  })
  it('L3: a shortening may drop the neutral sentence whole but never cut it ("Text." from "Text erscheint.")', async () => {
    expect(readsAsSentences('Ein Mann winkt langsam. Text erscheint.', 'Ein Mann winkt. Text.', 'de')).toMatch(/Text erscheint/)
    expect(readsAsSentences('Text erscheint.', 'Text.', 'de')).toMatch(/Text erscheint/)
    expect(readsAsSentences('A man waves slowly. Words appear.', 'A man waves. Words.', 'en')).toBeDefined()
    expect(readsAsSentences('Ein Mann winkt langsam. Text erscheint.', 'Ein Mann winkt. Text erscheint.', 'de')).toBeUndefined()
    expect(readsAsSentences('Ein Mann winkt langsam. Text erscheint.', 'Ein Mann winkt.', 'de')).toBeUndefined()
    expect(await safeShorten('Ein alter Mann winkt langsam. Text erscheint.', 5, () => 'Ein Mann winkt. Text.', 'de')).not.toMatch(/Text\.$/)
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
