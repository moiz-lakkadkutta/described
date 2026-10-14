import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildVerifyRequest, cachedVerify, checkVerified, newVerifyReport, parseVerifyReply, verifyCacheKey, verifyEnabled, verifyReply, writeVerifyReport, VERIFY_MAX_TOKENS } from '../src/steps/04b-verify'
import { buildDescribeRequest, type Converse, type RawReply } from '../src/steps/04-describe'
import { verifySystemPrompt, verifyUserText, VERIFY_PROMPT_VERSION } from '../src/verifyPrompt'
import { metered } from '../src/cost'

const MODEL = 'qwen.qwen3-vl-235b-a22b'
const frames = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]
const json = (text: string, removed: string[] = []) => JSON.stringify({ text, removed })
const reply = (text: string, stopReason: 'end_turn' | 'max_tokens' = 'end_turn') => ({ output: { message: { role: 'assistant' as const, content: [{ text }] } }, usage: { inputTokens: 2400, outputTokens: 40, totalTokens: 2440 }, stopReason })
const raw = (text: string): RawReply => ({ text, usage: { inputTokens: 2200, outputTokens: 13 }, stopReason: 'end_turn' })
const tmp = () => mkdtemp(join(tmpdir(), 'verify-'))

// The descriptions blind raters failed on sintel-90-210 (Gate C run g9, 2026-10-14), as Qwen3-VL wrote them.
const G9 = {
  walksLeft: 'Words appear: SINTEL. A figure walks left across snow, holding a staff, beneath icy peaks.',
  tattoo: 'The woman with red hair and a grey tank top blinks slowly in dim light, a tattoo visible on her shoulder.',
  opensEyes: 'Red-haired woman opens eyes.',
  mist: 'Two hands hold a red bowl; mist swirls inside, revealing a faint, shifting face beneath the surface.',
  bat: 'Woman kneels beside wounded bat on cobblestones.',
  staff: 'Bearded man holds ornate staff; red-haired woman watches.',
  pink: 'Pink-haired woman in gray tank top stands near stone wall.',
  offers: 'Woman offers bowl to man.',
  nearby: 'Red-haired woman smiles; dragon roars nearby.',
  book: 'Red-haired girl reads book.',
  sleeve: 'The woman in the grey tank top grabs a dark sleeve, then holds a red apple, standing in a sunlit courtyard.',
  city: 'Dense city under hazy sky, central pyramid structure.',
}

describe('verify prompt', () => {
  it('names every detail class the raters failed, asks for JSON, sentences and no new facts', () => {
    const p = verifySystemPrompt('en')
    for (const s of ['colours', 'on the body', 'a bat or a small dragon', 'a staff or a sword', 'left or right', 'open or closed', 'who holds, gives', '"nearby"', 'mist swirling',
      'Delete every detail that is not clearly visible', 'Prefer deleting to guessing', 'Never add a fact', 'exactly as written', 'never a list of nouns', 'no more words than the draft', '{"text":', 'Reply in English.'])
      expect(p).toContain(s)
    expect(verifySystemPrompt('de')).toContain('Reply in German.')
    expect(verifyUserText('A "SINTEL" sign.')).toBe('These are frames from one shot, in time order. Draft description: "A \\"SINTEL\\" sign." Check it against the frames.')
  })
})

describe('buildVerifyRequest', () => {
  it('sends the same image blocks as describe, then the draft; temperature 0', () => {
    const r = buildVerifyRequest('sys', frames, MODEL, G9.bat)
    const d = buildDescribeRequest('d', frames, MODEL)
    const content = r.messages![0]!.content!
    expect(content.slice(0, -1)).toEqual(d.messages![0]!.content!.slice(0, -1))
    expect(content).toHaveLength(frames.length + 1)
    expect(content.at(-1)).toEqual({ text: verifyUserText(G9.bat) })
    expect(r.system).toEqual([{ text: 'sys' }])
    expect(r.modelId).toBe(MODEL)
    expect(r.inferenceConfig).toEqual({ maxTokens: VERIFY_MAX_TOKENS, temperature: 0 })
  })
})

describe('parseVerifyReply', () => {
  it('reads the first JSON object, with or without a fence or prose around it', () => {
    expect(parseVerifyReply(json('Woman kneels.', ['bat']))).toEqual({ text: 'Woman kneels.', removed: ['bat'] })
    expect(parseVerifyReply('```json\n{"text": "Woman kneels."}\n```')).toEqual({ text: 'Woman kneels.', removed: [] })
    expect(parseVerifyReply('Here: {"text":"A {b}","removed":[]} done')).toEqual({ text: 'A {b}', removed: [] })
  })
  it('is undefined for anything else', () => {
    for (const r of ['', 'Woman kneels.', '{"text": 3}', '{"removed": []}', '{"text": "a"']) expect(parseVerifyReply(r)).toBeUndefined()
  })
})

describe('checkVerified', () => {
  it('accepts deletions and the allowed general words on the real g9 failures', () => {
    const ok: [string, string][] = [
      [G9.walksLeft, 'Words appear: SINTEL. A figure walks across snow, holding an object, beneath icy peaks.'],
      [G9.tattoo, 'The woman with red hair and a grey tank top is in dim light, a tattoo visible.'],
      [G9.opensEyes, 'There is a red-haired woman.'],
      [G9.mist, 'Two hands hold a red bowl with a face on the surface.'],
      [G9.bat, 'Woman kneels beside wounded creature on cobblestones.'],
      [G9.staff, 'Bearded man holds ornate weapon; red-haired woman watches.'],
      [G9.pink, 'Woman in gray tank top near stone wall.'],
      [G9.nearby, 'Red-haired woman smiles; dragon roars.'],
      [G9.book, 'There is a red-haired girl with a creature.'],
      [G9.sleeve, 'The woman in the grey tank top holds a red apple in a sunlit courtyard.'],
      [G9.city, 'There is a dense city under a hazy sky, with a central pyramid.'],
    ]
    for (const [draft, text] of ok) expect(checkVerified(draft, { text, removed: [] }), text).toEqual({ text, applied: true })
  })
  it('accepts an unchanged draft as applied with no change', () => {
    expect(checkVerified(G9.bat, { text: G9.bat, removed: [] })).toEqual({ text: G9.bat, applied: true })
  })
  it('rejects a reply that swaps in a new specific word, and keeps the draft', () => {
    const bad: [string, string, RegExp][] = [
      [G9.walksLeft, 'Words appear: SINTEL. A figure walks right across snow, holding a sword.', /new words: right, sword/],
      [G9.tattoo, 'The woman with red hair and a grey tank top sits in dim light, a tattoo on her chest.', /new words: sits, chest/],
      [G9.opensEyes, 'Red-haired woman looks down.', /new words: looks, down/],
      [G9.bat, 'Woman kneels beside wounded dragon on cobblestones.', /new words: dragon/],
      [G9.pink, 'Red-haired woman in gray tank top crouches near stone wall.', /new words: red-haired, crouches/],
      [G9.offers, 'Woman keeps bowl.', /new words: keeps/],
      [G9.nearby, 'Red-haired woman smiles; elsewhere, a dragon roars.', /new words: elsewhere/],
      [G9.book, 'Sintel holds small dragon.', /new words: sintel, holds, small, dragon/], // a name the draft did not have is a new word
    ]
    for (const [draft, text, reason] of bad) {
      const r = checkVerified(draft, { text, removed: [] })
      expect(r.applied, text).toBe(false)
      expect(r.text).toBe(draft)
      expect(r.reason).toMatch(reason)
    }
  })
  it('rejects a reply that changes, drops or adds on-screen text', () => {
    expect(checkVerified(G9.walksLeft, { text: 'A figure walks across snow beneath icy peaks.', removed: [] })).toMatchObject({ applied: false, reason: 'on-screen text changed' })
    expect(checkVerified(G9.walksLeft, { text: 'Words appear: SINTEL! A figure walks across snow.', removed: [] })).toMatchObject({ applied: false, reason: 'on-screen text changed' })
    expect(checkVerified(G9.bat, { text: 'Words appear: BAT. Woman kneels.', removed: [] })).toMatchObject({ applied: false, reason: 'on-screen text changed' })
  })
  it('rejects an empty reply, a SAME reply and a longer one', () => {
    for (const text of ['', '  ', '""', 'SAME']) expect(checkVerified(G9.bat, { text, removed: [] })).toMatchObject({ applied: false, text: G9.bat, reason: 'empty' })
    expect(checkVerified(G9.offers, { text: 'There is a woman with a bowl and there is a man.', removed: [] })).toMatchObject({ applied: false, reason: 'longer than the draft' })
    expect(checkVerified(G9.book, { text: 'Red-haired girl reads book, creature.', removed: [] })).toMatchObject({ applied: false, reason: 'more content words than the draft' })
  })
  it('matches inflections through the stem, as the edit pass does', () => {
    expect(checkVerified('Man pours broth.', { text: 'Man pouring broth.', removed: [] }).applied).toBe(true)
  })
})

describe('cachedVerify', () => {
  it('keys on model, prompt, frames and draft', () => {
    const k = verifyCacheKey(MODEL, 'sys', frames, 'A.')
    expect(k).toMatch(/^[0-9a-f]{64}$/)
    expect(verifyCacheKey(MODEL, 'sys', frames, 'A.')).toBe(k)
    for (const other of [verifyCacheKey('m2', 'sys', frames, 'A.'), verifyCacheKey(MODEL, 'sys2', frames, 'A.'), verifyCacheKey(MODEL, 'sys', [frames[0]!], 'A.'), verifyCacheKey(MODEL, 'sys', frames, 'B.')]) expect(other).not.toBe(k)
  })
  it('calls Bedrock once on a miss (metered), then serves the stored reply at zero cost; never caches max_tokens', async () => {
    const work = await tmp()
    const send = vi.fn<Converse>(async () => reply(json('Woman kneels.')))
    const miss = await metered(() => cachedVerify(work, MODEL, 'sys', frames, 'Woman kneels beside bat.', send))
    expect(miss.value).toMatchObject({ text: json('Woman kneels.'), usage: { inputTokens: 2400, outputTokens: 40 } })
    expect(miss.costUsd).toBeCloseTo((2400 * 0.53 + 40 * 2.66) / 1e6, 9)
    expect(await readdir(join(work, 'cache/verify'))).toEqual([`${verifyCacheKey(MODEL, 'sys', frames, 'Woman kneels beside bat.')}.json`])
    const hit = await metered(() => cachedVerify(work, MODEL, 'sys', frames, 'Woman kneels beside bat.', send))
    expect(hit.value).toMatchObject({ cached: true, usage: { inputTokens: 0, outputTokens: 0 } })
    expect(hit.costUsd).toBe(0)
    expect(send).toHaveBeenCalledTimes(1)
    const cut = vi.fn<Converse>(async () => reply('{"text": "Woman', 'max_tokens'))
    for (let i = 0; i < 2; i++) await cachedVerify(work, MODEL, 'sys', frames, 'Other.', cut)
    expect(cut).toHaveBeenCalledTimes(2)
  })
})

describe('verifyReply', () => {
  const env = process.env.DESCRIBE_VERIFY
  afterEach(() => { if (env === undefined) delete process.env.DESCRIBE_VERIFY; else process.env.DESCRIBE_VERIFY = env })

  it('is on unless DESCRIBE_VERIFY=0', () => {
    delete process.env.DESCRIBE_VERIFY; expect(verifyEnabled()).toBe(true)
    process.env.DESCRIBE_VERIFY = '1'; expect(verifyEnabled()).toBe(true)
    process.env.DESCRIBE_VERIFY = '0'; expect(verifyEnabled()).toBe(false)
  })
  it('replaces the reply text with the checked one, adds the usage, and records the change', async () => {
    delete process.env.DESCRIBE_VERIFY
    const work = await tmp()
    const report = newVerifyReport(MODEL)
    const send = vi.fn<Converse>(async () => reply(json('Woman kneels beside wounded creature on cobblestones.', ['bat'])))
    const r = await verifyReply(work, 24, frames, raw(G9.bat), send, 'en', report, MODEL)
    expect(r).toMatchObject({ text: 'Woman kneels beside wounded creature on cobblestones.', usage: { inputTokens: 4600, outputTokens: 53 } })
    const req = send.mock.calls[0]![0]
    expect(req.system).toEqual([{ text: verifySystemPrompt('en') }])
    expect(req.messages![0]!.content!.at(-1)).toEqual({ text: verifyUserText(G9.bat) })
    expect(req.inferenceConfig).toMatchObject({ temperature: 0 })
    expect(report.shots).toEqual([{ index: 24, draft: G9.bat, text: 'Woman kneels beside wounded creature on cobblestones.', removed: ['bat'], applied: true, changed: true, cached: false }])
    expect(report.usage).toEqual({ inputTokens: 2400, outputTokens: 40 })
  })
  it('uses the reply to turn a noun-list draft into a sentence', async () => {
    const report = newVerifyReport(MODEL)
    const send = vi.fn<Converse>(async () => reply(json('There is a dense city under a hazy sky, with a central pyramid.')))
    expect((await verifyReply(await tmp(), 14, frames, raw(G9.city), send, 'en', report, MODEL)).text).toBe('There is a dense city under a hazy sky, with a central pyramid.')
  })
  it('keeps the draft and records why when a guard rejects the reply or it is unreadable', async () => {
    const report = newVerifyReport(MODEL)
    const work = await tmp()
    const bad = vi.fn<Converse>(async () => reply(json('Woman kneels beside wounded dragon on cobblestones.', ['bat'])))
    expect((await verifyReply(work, 24, frames, raw(G9.bat), bad, 'en', report, MODEL)).text).toBe(G9.bat)
    const prose = vi.fn<Converse>(async () => reply('The draft is correct.'))
    expect((await verifyReply(work, 7, frames, raw('Old man pours broth.'), prose, 'en', report, MODEL)).text).toBe('Old man pours broth.')
    expect(report.shots.map((s) => [s.index, s.applied, s.reason])).toEqual([[24, false, 'new words: dragon'], [7, false, 'unreadable reply']])
    expect(report.shots[0]).toMatchObject({ text: G9.bat, reply: 'Woman kneels beside wounded dragon on cobblestones.' })
  })
  it('does not call Bedrock for SAME, empty or on-screen-text-only drafts', async () => {
    const send = vi.fn<Converse>(async () => reply(json('x')))
    const report = newVerifyReport(MODEL)
    for (const t of ['SAME', '', 'Words appear: "SINTEL".']) expect((await verifyReply(await tmp(), 0, frames, raw(t), send, 'en', report, MODEL)).text).toBe(t)
    expect(send).not.toHaveBeenCalled()
    expect(report.shots).toEqual([])
  })
  it('a re-run is served from the cache: no second call, same text', async () => {
    const work = await tmp()
    const send = vi.fn<Converse>(async () => reply(json('Red-haired woman smiles; dragon roars.', ['nearby'])))
    const first = await verifyReply(work, 27, frames, raw(G9.nearby), send, 'en', newVerifyReport(MODEL), MODEL)
    const report = newVerifyReport(MODEL)
    const again = await verifyReply(work, 27, frames, raw(G9.nearby), send, 'en', report, MODEL)
    expect(again.text).toBe(first.text)
    expect(send).toHaveBeenCalledTimes(1)
    expect(report.shots[0]).toMatchObject({ cached: true, applied: true })
    expect(report.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
  })
  it('DESCRIBE_VERIFY=0: no call, the draft as it was, the report says off', async () => {
    process.env.DESCRIBE_VERIFY = '0'
    const send = vi.fn<Converse>(async () => reply(json('x')))
    const report = newVerifyReport(MODEL)
    const r = raw(G9.bat)
    expect(await verifyReply(await tmp(), 24, frames, r, send, 'en', report, MODEL)).toBe(r)
    expect(send).not.toHaveBeenCalled()
    expect(report.enabled).toBe(false)
  })
  it('writes verify.json with the prompt version, model, usage and each shot', async () => {
    const work = await tmp()
    const report = newVerifyReport(MODEL)
    await verifyReply(work, 9, frames, raw(G9.offers), vi.fn<Converse>(async () => reply(json('Woman keeps bowl.'))), 'en', report, MODEL)
    await writeVerifyReport(work, report)
    const file = JSON.parse(await readFile(join(work, 'verify.json'), 'utf8'))
    expect(file).toMatchObject({ enabled: true, model: MODEL, promptVersion: VERIFY_PROMPT_VERSION, usage: { inputTokens: 2400, outputTokens: 40 }, shots: [{ index: 9, applied: false, reason: 'new words: keeps' }] })
    expect(file.shots).toHaveLength(1)
  })
})
