import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { OVERRUN_TOLERANCE_MS, clipDurationArgs, parseSpeechMs, silenceDetectArgs, cueSidecarFile, cueSsml, parseClipDurationMs, voice, withoutSaidText, type CueSidecar, type VoiceDeps } from '../src/steps/06-voice'
import { TAIL_SILENCE_MS, type FitCue } from '../src/steps/05-fit'
import type { Ctx } from '../src/steps/index'
import { metered, pollyUsd } from '../src/cost'

/**
 * Polly and ffprobe are injected: the fake Polly writes the cue text as the clip's bytes, and the fake ffprobe reads it back and
 * answers with the duration from DURATIONS (ms), so every number below is a fixture. No AWS call.
 */
const LONG = 'A tall woman slowly crosses the old bridge, holding a lantern.'
const SHORT = 'A woman crosses the bridge.' // shortenDeterministic(LONG, 5)
const MID = 'A woman crosses the bridge, holding a lantern.' // shortenDeterministic(LONG, 9)
const NIGHT = 'Night. A rooftop. A man waits by the chimney, watching the street.'
const NIGHT_SHORT = 'Night. A rooftop.' // shortenDeterministic(NIGHT, 4)
const SNOW = 'Snow falls on the hills, drifting past the cabin.'
const SNOW_SHORT = 'Snow falls on the hills.' // shortenDeterministic(SNOW, 3)
const STREET = 'Night. A man in a long dark coat walks slowly along the wet street, past the old bakery, the closed bank and the bright cinema, while snow falls on the quiet rooftops.' // 32 words
const STREET_SHORT = 'Night. A man in a dark coat walks along the street, past the bakery, the closed bank and the cinema, while snow falls on the quiet rooftops.' // shortenDeterministic(STREET, 28): 27 words
const STREET_CAPPED = 'Night. A man in a dark coat walks along the street, past the bakery, the closed bank and the cinema.' // capExtended(STREET_SHORT): 20 words
const DURATIONS: Record<string, number> = {
  'Smoke rises.': 1200, 'Snow falls.': 1100, 'She waits.': 1300, 'Words appear: North.': 1700,
  [LONG]: 4000, [SHORT]: 1900, [MID]: 3000, [NIGHT]: 5000, [NIGHT_SHORT]: 2500, [SNOW]: 6000, [SNOW_SHORT]: 2600,
  [STREET]: 11200, [STREET_SHORT]: 10400, [STREET_CAPPED]: 7800,
}

let work: string
const ctx = (): Ctx => ({ slug: 't', source: 's.mp4', language: 'en', voice: 'Joanna', work })
const cue = (startMs: number, text: string, limitMs?: number, extended = false): FitCue => ({ startMs, endMs: startMs + 1000, text, extended, wordCount: text.split(/\s+/).length, shotIndex: 0, ...(limitMs === undefined ? {} : { limitMs }) })
const writeCues = (cues: FitCue[]) => writeFile(`${work}/cues.json`, JSON.stringify(cues))
const readCues = async () => JSON.parse(await readFile(`${work}/cues.json`, 'utf8')) as FitCue[]
const fakes = () => {
  const synthesize = vi.fn(async (text: string) => new TextEncoder().encode(text))
  const measureMs = vi.fn(async (file: string) => { const t = await readFile(file, 'utf8'); const d = DURATIONS[t]; if (d === undefined) throw new Error(`no fixture duration for ${t}`); return d })
  return { synthesize, measureMs } satisfies VoiceDeps
}
const files = async () => (await readdir(work)).filter((f) => f.startsWith('cue_')).sort()

beforeEach(async () => { work = await mkdtemp(join(tmpdir(), 'voice-')) })
afterEach(async () => { await rm(work, { recursive: true, force: true }) })

describe('voice', () => {
  it('voice reuses a clip whose sidecar matches text, voice and language', async () => {
    await writeCues([cue(1000, 'Smoke rises.', 5000)])
    await writeFile(`${work}/cue_0.mp3`, 'Smoke rises.')
    await writeFile(`${work}/${cueSidecarFile(0)}`, JSON.stringify({ text: 'Smoke rises.', voice: 'Joanna', language: 'en', ssml: cueSsml('Smoke rises.'), durationMs: 1234 } satisfies CueSidecar))
    const f = fakes()
    const { costUsd } = await metered(() => voice(ctx(), f))
    expect(f.synthesize).not.toHaveBeenCalled()
    expect(f.measureMs).not.toHaveBeenCalled()
    expect(costUsd).toBe(0)
    expect((await readCues())[0]).toMatchObject({ startMs: 1000, endMs: 2234 })
  })
  it('voice re-synthesizes when the text changed', async () => {
    await writeCues([cue(1000, 'Smoke rises.', 5000)])
    await writeFile(`${work}/cue_0.mp3`, 'Snow falls.')
    await writeFile(`${work}/${cueSidecarFile(0)}`, JSON.stringify({ text: 'Snow falls.', voice: 'Joanna', language: 'en', durationMs: 1100 }))
    const f = fakes()
    await voice(ctx(), f)
    expect(f.synthesize).toHaveBeenCalledTimes(1)
    expect(f.synthesize).toHaveBeenCalledWith('Smoke rises.', 'Joanna', 'en')
    expect(JSON.parse(await readFile(`${work}/${cueSidecarFile(0)}`, 'utf8'))).toEqual({ text: 'Smoke rises.', voice: 'Joanna', language: 'en', ssml: cueSsml('Smoke rises.'), durationMs: 1200, speechMs: 1050 }) // speech: 1200 − TAIL_SILENCE_MS (measureMs injected)
    // A sidecar written with another SSML wrapper (or none, before the wrapper was recorded) is a different clip.
    await writeFile(`${work}/${cueSidecarFile(0)}`, JSON.stringify({ text: 'Smoke rises.', voice: 'Joanna', language: 'en', ssml: '<speak>Smoke rises.</speak>', durationMs: 1200 }))
    const h = fakes()
    await voice(ctx(), h)
    expect(h.synthesize).toHaveBeenCalledTimes(1)
    // A different voice or language is a different clip too.
    const g = fakes()
    await voice({ ...ctx(), voice: 'Matthew' }, g)
    expect(g.synthesize).toHaveBeenCalledWith('Smoke rises.', 'Matthew', 'en')
  })
  it('voice measures the clip and writes endMs = startMs + durationMs', async () => {
    await writeCues([cue(1000, 'Smoke rises.', 5000), cue(7000, 'Words appear: North.', undefined, true)])
    const f = fakes()
    await voice(ctx(), f)
    expect(f.measureMs).toHaveBeenCalledWith(`${work}/cue_0.mp3`)
    expect((await readCues()).map((c) => [c.startMs, c.endMs, c.extended, c.wordCount])).toEqual([[1000, 2200, false, 2], [7000, 8700, true, 3]])
    expect(await files()).toEqual(['cue_0.json', 'cue_0.mp3', 'cue_1.json', 'cue_1.mp3'])
  })
  it('accepts an overrun of up to 200 ms past limitMs', async () => {
    expect(OVERRUN_TOLERANCE_MS).toBe(200)
    await writeCues([cue(1000, 'Smoke rises.', 2000)]) // 1000 + 1200 = 2200 = limit + 200; the speech ends at 1000 + 1000 = the limit
    const f = { ...fakes(), measureSpeechMs: async () => 1000 }
    await voice(ctx(), f)
    expect(f.synthesize).toHaveBeenCalledTimes(1)
    expect((await readCues())[0]).toMatchObject({ text: 'Smoke rises.', endMs: 2200 })
  })
  it('an overrun past limitMs + 200 ms is shortened proportionally and re-synthesized once', async () => {
    // 10000 + 4000 = 14000 > 12000 + 200 → maxWords = max(3, floor(10 × 2000 / 4000)) = 5
    await writeCues([cue(10000, LONG, 12000)])
    const f = fakes()
    const { costUsd } = await metered(() => voice(ctx(), f))
    expect(f.synthesize.mock.calls.map((c) => c[0])).toEqual([LONG, SHORT])
    expect(await readCues()).toEqual([{ ...cue(10000, SHORT, 12000), endMs: 11900, wordCount: 5 }])
    // Both Polly calls are billed once each: the discarded first clip and the kept one.
    expect(costUsd).toBeCloseTo(pollyUsd(LONG.length + SHORT.length), 12)
  })
  it('a clip that would run into the next cue in the same gap is shortened', async () => {
    // One gap 0–10000; fit placed the next cue at 3500. LONG (4000 ms) from 1000 ends at 5000 > min(10000, 3500 − 150) + 200 = 3550
    // → maxWords = max(3, floor(10 × (3350 − 1000) / 4000)) = 5 → SHORT, 1000 + 1900 = 2900 ≤ 3550: kept, no overlap.
    await writeCues([cue(1000, LONG, 10000), cue(3500, 'Smoke rises.', 10000), cue(9000, 'Words appear: North.', undefined, true)])
    const f = fakes()
    await voice(ctx(), f)
    expect(f.synthesize.mock.calls.map((c) => c[0])).toEqual([LONG, SHORT, 'Smoke rises.', 'Words appear: North.'])
    expect((await readCues()).map((c) => [c.startMs, c.endMs, c.text, c.extended])).toEqual([[1000, 2900, SHORT, false], [3500, 4700, 'Smoke rises.', false], [9000, 10700, 'Words appear: North.', true]])
  })
  it('a second overrun becomes extended when the text introduces something new', async () => {
    // 10000 + 5000 > 12200 → maxWords = floor(12 × 2000 / 5000) = 4 → NIGHT_SHORT; 10000 + 2500 still > 12200
    await writeCues([cue(10000, NIGHT, 12000)])
    const f = fakes()
    await voice(ctx(), f)
    expect(f.synthesize).toHaveBeenCalledTimes(2)
    const [c] = await readCues()
    expect(c).toEqual({ startMs: 10000, endMs: 12500, text: NIGHT_SHORT, extended: true, wordCount: 3, shotIndex: 0 })
    expect(c).not.toHaveProperty('limitMs')
  })
  it('an overrun turned extended and capped re-voices once more and bills all three calls', async () => {
    // 10000 + 11200 > 20200 → maxWords = max(3, floor(32 × 10000 / 11200)) = 28 → STREET_SHORT (27 words); 10000 + 10400 still > 20200
    // and it introduces something new → extended, and capExtended cuts its 27 words to 20 (STREET_CAPPED): a third Polly call.
    await writeCues([cue(10000, STREET, 20000)])
    const f = fakes()
    const { costUsd } = await metered(() => voice(ctx(), f))
    expect(f.synthesize.mock.calls.map((c) => c[0])).toEqual([STREET, STREET_SHORT, STREET_CAPPED])
    expect(await readCues()).toEqual([{ startMs: 10000, endMs: 17800, text: STREET_CAPPED, extended: true, wordCount: 20, shotIndex: 0 }])
    expect(await files()).toEqual(['cue_0.json', 'cue_0.mp3'])
    expect(await readFile(`${work}/cue_0.mp3`, 'utf8')).toBe(STREET_CAPPED)
    expect(JSON.parse(await readFile(`${work}/${cueSidecarFile(0)}`, 'utf8'))).toMatchObject({ text: STREET_CAPPED, ssml: cueSsml(STREET_CAPPED), durationMs: 7800 })
    // Each of the three calls is billed exactly once: the two discarded clips and the kept one.
    expect(costUsd).toBeCloseTo(pollyUsd(STREET.length + STREET_SHORT.length + STREET_CAPPED.length), 12)
  })
  it('a second overrun is dropped otherwise', async () => {
    // middle cue: 20000 + 6000 > 22200 → maxWords = max(3, floor(9 × 2000 / 6000)) = 3 → SNOW_SHORT; 20000 + 2600 still > 22200 → dropped
    await writeCues([cue(1000, 'Smoke rises.', 5000), cue(20000, SNOW, 22000), cue(30000, 'She waits.', 34000)])
    const f = fakes()
    const { costUsd } = await metered(() => voice(ctx(), f))
    expect(f.synthesize.mock.calls.map((c) => c[0])).toEqual(['Smoke rises.', SNOW, SNOW_SHORT, 'She waits.'])
    expect((await readCues()).map((c) => [c.startMs, c.endMs, c.text])).toEqual([[1000, 2200, 'Smoke rises.'], [30000, 31300, 'She waits.']])
    // The kept clips follow cues.json indices: "She waits." moves from cue_2 to cue_1, and cue_2 is gone.
    expect(await files()).toEqual(['cue_0.json', 'cue_0.mp3', 'cue_1.json', 'cue_1.mp3'])
    expect(await readFile(`${work}/cue_1.mp3`, 'utf8')).toBe('She waits.')
    expect(JSON.parse(await readFile(`${work}/${cueSidecarFile(1)}`, 'utf8'))).toMatchObject({ text: 'She waits.', durationMs: 1300 })
    expect(costUsd).toBeCloseTo(pollyUsd(['Smoke rises.', SNOW, SNOW_SHORT, 'She waits.'].join('').length), 12)
  })
  it('a failed run still bills the Polly calls it made; a reused clip costs nothing', async () => {
    await writeCues([cue(1000, 'Smoke rises.', 5000), cue(7000, 'Snow falls.', 9000), cue(12000, 'She waits.', 15000)])
    await writeFile(`${work}/cue_0.mp3`, 'Smoke rises.')
    await writeFile(`${work}/${cueSidecarFile(0)}`, JSON.stringify({ text: 'Smoke rises.', voice: 'Joanna', language: 'en', ssml: cueSsml('Smoke rises.'), durationMs: 1200 } satisfies CueSidecar))
    const f = fakes()
    f.synthesize.mockImplementation(async (text: string) => { if (text === 'She waits.') throw new Error('throttled'); return new TextEncoder().encode(text) })
    await expect(metered(() => voice(ctx(), f))).rejects.toMatchObject({ message: 'throttled', costUsd: pollyUsd('Snow falls.'.length) })
  })
  it('stale cue files beyond cues.length are deleted', async () => {
    await writeCues([cue(1000, 'Smoke rises.', 5000), cue(7000, 'Snow falls.', 9000)])
    for (const f of ['cue_2.mp3', 'cue_2.json', 'cue_11.mp3', 'cue_5.json']) await writeFile(`${work}/${f}`, 'old')
    await writeFile(`${work}/cues.json.bak`, 'keep')
    await voice(ctx(), fakes())
    expect(await files()).toEqual(['cue_0.json', 'cue_0.mp3', 'cue_1.json', 'cue_1.mp3'])
    expect(await stat(`${work}/cues.json.bak`)).toBeTruthy()
  })
  it('a re-run reuses every clip, including a shortened one, and changes nothing', async () => {
    await writeCues([cue(10000, LONG, 12000), cue(20000, 'Snow falls.', 25000)])
    await voice(ctx(), fakes())
    const first = await readCues()
    const f = fakes()
    await voice(ctx(), f)
    expect(f.synthesize).not.toHaveBeenCalled()
    expect(await readCues()).toEqual(first)
  })
  it('wraps the text in SSML with a 150 ms lead-in and escapes XML', () => {
    expect(cueSsml('Fish & <chips>')).toBe('<speak><break time="150ms"/><prosody rate="100%">Fish &amp; &lt;chips&gt;</prosody></speak>')
  })
})

const hasFfprobe = await execa('ffprobe', ['-version']).then(() => true, () => false) // CI images may lack ffmpeg
describe('clip duration', () => {
  const mp3 = new URL('./fixtures/synthetic-cue-2500ms.mp3', import.meta.url).pathname
  // synthetic-cue-2500ms.mp3: `ffmpeg -f lavfi -i sine=frequency=440:duration=2.5 -ar 24000 -ac 1 -c:a libmp3lame -b:a 48k` (24 kHz mono, like Polly)
  it('reads format.duration from recorded ffprobe JSON in whole ms', () => {
    expect(clipDurationArgs('w/cue_0.mp3')).toEqual(['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', 'w/cue_0.mp3'])
    expect(parseClipDurationMs(readFileSync(new URL('./fixtures/synthetic-cue-2500ms.ffprobe.json', import.meta.url), 'utf8'))).toBe(2500)
    expect(parseClipDurationMs('{"format":{"duration":"1.23456"}}')).toBe(1235)
    expect(() => parseClipDurationMs('{"format":{}}')).toThrow(/duration/)
    expect(() => parseClipDurationMs('{"format":{"duration":"N/A"}}')).toThrow(/duration/)
  })
  it.skipIf(!hasFfprobe)('measures the synthetic MP3 with the real ffprobe', async () => {
    const { stdout } = await execa('ffprobe', clipDurationArgs(mp3))
    expect(parseClipDurationMs(stdout)).toBe(2500)
  })
  // Human decision 2026-10-10 (M4): r2 cue 0 ran past the next cue; the shortening could not keep the text beside the action.
  it('an overrun whose on-screen text does not fit beside the action keeps the action within its limit and the text as its own extended cue', async () => {
    const SHOT0 = 'Snowy mountains. A lone figure walks left, carrying a spear. Words appear: SINTEL.'
    await writeCues([{ ...cue(0, SHOT0, 16720), shotIndex: 0 }, { ...cue(2000, 'Smoke rises.', 16720), shotIndex: 1 }])
    const synthesize = vi.fn(async (text: string) => new TextEncoder().encode(text))
    const measureMs = vi.fn(async (file: string) => (await readFile(file, 'utf8')).split(/\s+/).length * 560)
    await voice(ctx(), { synthesize, measureMs })
    const out = await readCues()
    // no shots.json here: the text cue cannot lead (it may not start before the cue), so the action moves 400 ms later
    expect(out.map((c) => [c.startMs, c.extended, c.text, c.shotIndex])).toEqual([[0, true, 'Words appear: SINTEL.', 0], [400, false, 'Snowy mountains.', 0], [2000, false, 'Smoke rises.', 1]])
    expect(out[1]!.endMs).toBeLessThanOrEqual(2000 - 150 + OVERRUN_TOLERANCE_MS) // the action stays within its limit
    expect(out[0]).not.toHaveProperty('limitMs')
    expect(out[0]!.endMs).toBe(3 * 560) // the text cue's own clip
    // every clip sits in its cue's slot
    for (const [i, c] of out.entries()) {
      expect(await readFile(`${work}/cue_${i}.mp3`, 'utf8')).toBe(c.text)
      expect((JSON.parse(await readFile(`${work}/${cueSidecarFile(i)}`, 'utf8')) as CueSidecar).text).toBe(c.text)
    }
    expect(await files()).toEqual(['cue_0.json', 'cue_0.mp3', 'cue_1.json', 'cue_1.mp3', 'cue_2.json', 'cue_2.mp3'])
  })
  it('a split text cue leads its action by 400 ms when the shot started earlier, and stale moving_ files are removed', async () => {
    const SHOT0 = 'Snowy mountains. A lone figure walks left, carrying a spear. Words appear: SINTEL.'
    await writeFile(`${work}/shots.json`, JSON.stringify([{ index: 0, startMs: 0, endMs: 3000 }]))
    await writeFile(`${work}/moving_cue_7.mp3`, 'stale')
    await writeCues([{ ...cue(1000, SHOT0, 3500), shotIndex: 0 }])
    await voice(ctx(), { synthesize: async (t) => new TextEncoder().encode(t), measureMs: async (f) => (await readFile(f, 'utf8')).split(/\s+/).length * 560 })
    expect((await readCues()).map((c) => [c.startMs, c.extended, c.text])).toEqual([[600, true, 'Words appear: SINTEL.'], [1000, false, 'Snowy mountains.']])
    expect((await readdir(work)).filter((f) => f.startsWith('moving_'))).toEqual([])
  })
})

describe('voice: on-screen text and pauses after measured clips (DESC-020 follow-ups)', () => {
  const perWord = { synthesize: async (t: string) => new TextEncoder().encode(t), measureMs: async (f: string) => (await readFile(f, 'utf8')).split(/\s+/).length * 560 }
  const text = (startMs: number, t: string, shotIndex: number): FitCue => ({ startMs, endMs: startMs + 100, text: t, extended: true, wordCount: t.split(/\s+/).length, shotIndex })
  const run = async (cues: FitCue[], deps: VoiceDeps = perWord) => { await writeCues(cues); await voice(ctx(), deps); return readCues() }
  // (a) fit put the text cue 400 ms before its action from estimated ends; the measured clip before it runs later
  it('a text-only extended cue never starts while a placed clip still speaks: it moves to the measured end', async () => {
    // 'Smoke rises.' measures 1200 ms (DURATIONS): the text cue at 1800 moves to 2200; 'Snow falls.' at 2400 keeps its slot
    const out = await run([{ ...cue(1000, 'Smoke rises.', 5000), shotIndex: 0 }, text(1800, 'Words appear: North.', 1), { ...cue(2400, 'Snow falls.', 5000), shotIndex: 1 }], fakes())
    expect(out.map((c) => [c.startMs, c.endMs, c.extended, c.text])).toEqual([[1000, 2200, false, 'Smoke rises.'], [2200, 3900, true, 'Words appear: North.'], [2400, 3500, false, 'Snow falls.']])
    for (const [i, c] of out.entries()) expect(await readFile(`${work}/cue_${i}.mp3`, 'utf8')).toBe(c.text)
    // a text cue moved onto its action's start is re-slotted and heard first (byStart), clips with it; decision 0009 keeps the clip
    // before it from running past that start (it ended 50 ms into 'Snow falls.' at 2150 before)
    const late = await run([{ ...cue(1000, 'Smoke rises.', 5000), shotIndex: 0 }, text(2100, 'Words appear: North.', 1), { ...cue(2200, 'Snow falls.', 5000), shotIndex: 1 }], fakes())
    expect(late.map((c) => [c.startMs, c.text])).toEqual([[1000, 'Smoke rises.'], [2200, 'Words appear: North.'], [2200, 'Snow falls.']])
    for (const [i, c] of late.entries()) expect(await readFile(`${work}/cue_${i}.mp3`, 'utf8')).toBe(c.text)
  })
  it('a text cue split in voice is placed after every kept clip\'s measured end, including one that ends at this cue\'s start', async () => {
    // 'Smoke rises.' from 0 measures 1200 ms (speech 1000 ms = its limit): kept, its file ending at the next cue's start, 1200 (decision 0009)
    const SHOT0 = 'Snowy mountains. A lone figure walks left, carrying a spear. Words appear: SINTEL.'
    const out = await run([{ ...cue(0, 'Smoke rises.', 1050), shotIndex: 0 }, { ...cue(1200, SHOT0, 5000), shotIndex: 1 }], { synthesize: perWord.synthesize, measureMs: async (f) => { const t = await readFile(f, 'utf8'); return t === 'Smoke rises.' ? 1200 : t.split(/\s+/).length * 560 }, measureSpeechMs: async (f) => ((await readFile(f, 'utf8')) === 'Smoke rises.' ? 1000 : undefined) })
    expect(out.map((c) => [c.startMs, c.extended, c.text])).toEqual([[0, false, 'Smoke rises.'], [1200, true, 'Words appear: SINTEL.'], [1600, false, 'Snowy mountains.']])
  })
  it('a cue starting at or after the title\'s end (probe.json) is not voiced: no Polly call, no clip, not in cues.json (so not mixed)', async () => {
    await writeFile(`${work}/probe.json`, JSON.stringify({ format: { duration: '3.000' } }))
    const f = fakes()
    const out = await run([cue(1000, 'Smoke rises.', 2500), cue(3000, 'Snow falls.', 5000), cue(3200, 'She waits.', undefined, true)], f)
    expect(f.synthesize.mock.calls.map((c) => c[0])).toEqual(['Smoke rises.'])
    expect(out.map((c) => c.text)).toEqual(['Smoke rises.'])
    expect(await files()).toEqual(['cue_0.json', 'cue_0.mp3'])
  })
  it('an extended cue moved to or past the title\'s end by the measured clip before it is dropped, its clip with it', async () => {
    // 'Smoke rises.' from 1000 measures 1200 ms: the text cue at 1800 would move to 2200, on a 2.2 s title
    await writeFile(`${work}/probe.json`, JSON.stringify({ format: { duration: '2.2' } }))
    const out = await run([{ ...cue(1000, 'Smoke rises.', 5000), shotIndex: 0 }, text(1800, 'Words appear: North.', 1)], fakes())
    expect(out.map((c) => [c.startMs, c.text])).toEqual([[1000, 'Smoke rises.']])
    expect(await files()).toEqual(['cue_0.json', 'cue_0.mp3'])
    expect(await readFile(`${work}/cue_0.mp3`, 'utf8')).toBe('Smoke rises.')
  })
  // (d) sintel-90-150-r2: shots 0 and 1, the halves of one camera shot, both ended in "Words appear: SINTEL."
  it('does not voice on-screen text the previous voiced cue already said: the clause is dropped, the rest voiced', async () => {
    expect(withoutSaidText('Snowy mountains. A figure walks, falls. Words appear: SINTEL.', ['sintel'])).toBe('Snowy mountains. A figure walks, falls.')
    expect(withoutSaidText('Words appear: SINTEL. A figure walks.', ['sintel'])).toBe('A figure walks.')
    expect(withoutSaidText('Words appear: SINTEL.', ['sintel'])).toBe('')
    expect(withoutSaidText('Words appear: SINTEL. A figure walks.', ['north'])).toBe('Words appear: SINTEL. A figure walks.')
    expect(withoutSaidText('Words appear: "The End." A man waves.', ['the end'])).toBe('A man waves.')
    const out = await run([{ ...cue(0, 'Words appear: North. Snow falls.', 5000), shotIndex: 0 }, { ...cue(3000, 'Words appear: North. She waits.', 8000), shotIndex: 1 }, { ...cue(6000, 'Words appear: North.', 9000), shotIndex: 2 }])
    expect(out.map((c) => [c.startMs, c.text])).toEqual([[0, 'Words appear: North. Snow falls.'], [3000, 'She waits.'], [6000, 'Words appear: North.']]) // the third: the previous voiced cue did not say it
    for (const [i, c] of out.entries()) expect(await readFile(`${work}/cue_${i}.mp3`, 'utf8')).toBe(c.text)
  })
  it('a cue that is only on-screen text the previous cue said is not voiced; fit\'s split text cue counts as said with its action', async () => {
    // fit split shot 0 into its text cue and action; shot 1 (the second half of the camera shot) repeats the text
    const out = await run([text(0, 'Words appear: SINTEL.', 0), { ...cue(400, 'Snowy mountains.', 5000), shotIndex: 0 }, text(5604, 'Words appear: SINTEL.', 1), { ...cue(6004, 'A figure falls.', 9000), shotIndex: 1 }])
    expect(out.map((c) => [c.startMs, c.extended, c.text])).toEqual([[0, true, 'Words appear: SINTEL.'], [400, false, 'Snowy mountains.'], [6004, false, 'A figure falls.']])
    expect(await files()).toEqual(['cue_0.json', 'cue_0.mp3', 'cue_1.json', 'cue_1.mp3', 'cue_2.json', 'cue_2.mp3'])
    expect(await readFile(`${work}/cue_2.mp3`, 'utf8')).toBe('A figure falls.')
    // a text cue split in voice from the previous cue counts too
    const SHOT0 = 'Snowy mountains. A lone figure walks left, carrying a spear. Words appear: SINTEL.'
    const two = await run([{ ...cue(0, SHOT0, 3000), shotIndex: 0 }, { ...cue(5604, 'Snowy mountains. A figure walks, falls. Words appear: SINTEL.', 16720), shotIndex: 1 }])
    expect(two.map((c) => [c.startMs, c.extended, c.text])).toEqual([[0, true, 'Words appear: SINTEL.'], [400, false, 'Snowy mountains.'], [5604, false, 'Snowy mountains. A figure walks, falls.']])
  })
})

describe('voice: decision 0009 — the speech ends by the limit, the clip file by limit + 200 ms and the next cue\'s start', () => {
  const speech = (m: Record<string, number>) => async (f: string) => m[await readFile(f, 'utf8')]
  it('a clip whose file is within the tolerance but whose speech runs past the limit is shortened', async () => {
    // LONG: file 4000 ms (ends 4000 ≤ 3850 + 200), speech 3900 ms (ends 3900 > 3850) → shortened to SHORT
    await writeCues([cue(0, LONG, 3850)])
    const f = { ...fakes(), measureSpeechMs: speech({ [LONG]: 3900, [MID]: 2900 }) }
    await voice(ctx(), f)
    expect(f.synthesize.mock.calls.map((c) => c[0])).toEqual([LONG, MID]) // max(3, ⌊10 × 3850 / 4000⌋) = 9 words
    expect((await readCues()).map((c) => c.text)).toEqual([MID])
  })
  it('a clip whose speech ends by the limit but whose file runs past the next placed cue\'s start is shortened', async () => {
    // next placed cue at 3950 → limit min(10000, 3800); LONG speech 3700 ≤ 3800, file 4000 ≤ 4000 but > 3950 (the next cue's start)
    await writeCues([cue(0, LONG, 10000), cue(3950, 'Smoke rises.', 10000)])
    const f = { ...fakes(), measureSpeechMs: speech({ [LONG]: 3700, [MID]: 2900, 'Smoke rises.': 1000 }) }
    await voice(ctx(), f)
    expect((await readCues()).map((c) => [c.startMs, c.endMs, c.text])).toEqual([[0, 3000, MID], [3950, 5150, 'Smoke rises.']])
  })
  it('without a speech measurement the speech end is the clip end − TAIL_SILENCE_MS', async () => {
    // 'Smoke rises.' 1200 ms from 1000: file 2200 ≤ 2000 + 200, speech 2200 − 150 = 2050 > 2000 → no shorter text, not new, no event: dropped
    expect(TAIL_SILENCE_MS).toBe(150)
    await writeCues([cue(1000, 'Smoke rises.', 2000)])
    await voice(ctx(), fakes())
    expect(await readCues()).toEqual([])
    await writeCues([cue(1000, 'Smoke rises.', 2050)]) // 2050 = speech end: kept
    await voice(ctx(), fakes())
    expect((await readCues()).map((c) => c.text)).toEqual(['Smoke rises.'])
  })
  it('the clip sidecar stores the speech length, and a reused clip uses it', async () => {
    await writeCues([cue(0, 'Smoke rises.', 5000)])
    await voice(ctx(), { ...fakes(), measureSpeechMs: async () => 1010 })
    expect(JSON.parse(await readFile(`${work}/${cueSidecarFile(0)}`, 'utf8'))).toMatchObject({ durationMs: 1200, speechMs: 1010 })
    // reused with a 1020 ms limit: the stored speech (1010) passes; the fallback (1200 − 150 = 1050) would not
    await writeCues([cue(0, 'Smoke rises.', 1020)])
    const f = fakes()
    await voice(ctx(), f)
    expect(f.synthesize).not.toHaveBeenCalled()
    expect((await readCues()).map((c) => c.text)).toEqual(['Smoke rises.'])
  })
  it('no two placed clip files overlap', async () => {
    // clips that the old rule (file ≤ limit + 200 with limit = next start − 150) let run up to 50 ms into the next cue
    const T = ['Smoke rises.', 'Snow falls.', 'She waits.', 'Smoke rises.']
    const starts = [0, 1150, 2200, 3450]
    await writeCues(T.map((t, k) => ({ ...cue(starts[k]!, t, 10000), shotIndex: k })))
    await voice(ctx(), fakes())
    const placed = (await readCues()).filter((c) => !c.extended)
    expect(placed.length).toBeGreaterThan(0)
    for (let k = 1; k < placed.length; k++) expect(placed[k - 1]!.endMs).toBeLessThanOrEqual(placed[k]!.startMs)
  })
  it('g9 shots 8 and 9: an event pause from a later shot moves after the earlier shot\'s placed clip, and is heard after it', async () => {
    const placed8: FitCue = { startMs: 37240, endMs: 38815, text: 'Girl accepts bowl.', extended: false, wordCount: 3, shotIndex: 8, limitMs: 38989 }
    const event9: FitCue = { startMs: 36333, endMs: 36433, text: 'Woman offers bowl to man.', extended: true, wordCount: 5, shotIndex: 9, event: true }
    await writeCues([event9, placed8])
    await voice(ctx(), { synthesize: async (t) => new TextEncoder().encode(t), measureMs: async (f) => ((await readFile(f, 'utf8')) === 'Girl accepts bowl.' ? 1440 : 1872), measureSpeechMs: async (f) => ((await readFile(f, 'utf8')) === 'Girl accepts bowl.' ? 1332 : 1760) })
    const out = await readCues()
    expect(out.map((c) => [c.shotIndex, c.startMs, c.endMs])).toEqual([[8, 37240, 38680], [9, 38680, 40552]])
    for (const [i, c] of out.entries()) expect(await readFile(`${work}/cue_${i}.mp3`, 'utf8')).toBe(c.text)
  })
})
describe('speech end (silencedetect)', () => {
  it('builds the decision-0009 silencedetect command', () => {
    expect(silenceDetectArgs('c.mp3')).toEqual(['-hide_banner', '-nostats', '-i', 'c.mp3', '-af', 'silencedetect=noise=-45dB:d=0.05', '-f', 'null', '-'])
  })
  it('reads the start of the trailing silence (recorded g8 cue_3, 1800 ms), or the clip end when there is none', () => {
    const log = '[silencedetect @ 0x1] silence_start: 0\n[silencedetect @ 0x1] silence_end: 0.303958 | silence_duration: 0.303958\n[silencedetect @ 0x1] silence_start: 1.706625\n'
    expect(parseSpeechMs(log, 1800)).toBe(1707)
    expect(parseSpeechMs(log + '[silencedetect @ 0x1] silence_end: 1.8 | silence_duration: 0.093375\n', 1800)).toBe(1707) // ends at the clip end
    expect(parseSpeechMs(log + '[silencedetect @ 0x1] silence_end: 1.5 | silence_duration: 0.2\n', 1800)).toBe(1800) // a pause inside the clip
    expect(parseSpeechMs('', 1800)).toBe(1800)
  })
})
