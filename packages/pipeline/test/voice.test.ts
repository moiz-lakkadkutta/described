import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { OVERRUN_TOLERANCE_MS, clipDurationArgs, cueSidecarFile, cueSsml, parseClipDurationMs, voice, type CueSidecar, type VoiceDeps } from '../src/steps/06-voice'
import type { FitCue } from '../src/steps/05-fit'
import type { Ctx } from '../src/steps/index'
import { metered, pollyUsd } from '../src/cost'

/**
 * Polly and ffprobe are injected: the fake Polly writes the cue text as the clip's bytes, and the fake ffprobe reads it back and
 * answers with the duration from DURATIONS (ms), so every number below is a fixture. No AWS call.
 */
const LONG = 'A tall woman slowly crosses the old bridge, holding a lantern.'
const SHORT = 'A woman crosses the bridge.' // shortenDeterministic(LONG, 5)
const NIGHT = 'Night. A rooftop. A man waits by the chimney, watching the street.'
const NIGHT_SHORT = 'Night. A rooftop.' // shortenDeterministic(NIGHT, 4)
const SNOW = 'Snow falls on the hills, drifting past the cabin.'
const SNOW_SHORT = 'Snow falls on the hills.' // shortenDeterministic(SNOW, 3)
const DURATIONS: Record<string, number> = {
  'Smoke rises.': 1200, 'Snow falls.': 1100, 'She waits.': 1300, 'Words appear: North.': 1700,
  [LONG]: 4000, [SHORT]: 1900, [NIGHT]: 5000, [NIGHT_SHORT]: 2500, [SNOW]: 6000, [SNOW_SHORT]: 2600,
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
    expect(JSON.parse(await readFile(`${work}/${cueSidecarFile(0)}`, 'utf8'))).toEqual({ text: 'Smoke rises.', voice: 'Joanna', language: 'en', ssml: cueSsml('Smoke rises.'), durationMs: 1200 })
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
    await writeCues([cue(1000, 'Smoke rises.', 2000)]) // 1000 + 1200 = 2200 = limit + 200
    const f = fakes()
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
  it('bills every Polly call even when the clip file is stamped before the run started', async () => {
    // Regression: the cost used to be inferred from clip mtimes ≥ Date.now() at the start of the step. Linux stamps files from a
    // coarse kernel clock that can lag Date.now(), so a clip written in the first tick looked older than the run and went unbilled
    // (CI: 'Smoke rises.' missing, 12 chars = $0.000192). Here every clip is back-dated an hour to make that deterministic.
    await writeCues([cue(1000, 'Smoke rises.', 5000), cue(20000, SNOW, 22000), cue(30000, 'She waits.', 34000)])
    const f = fakes()
    const measure = f.measureMs.getMockImplementation()!
    f.measureMs.mockImplementation(async (file: string) => { const past = new Date(Date.now() - 3_600_000); await utimes(file, past, past); return measure(file) })
    const { costUsd } = await metered(() => voice(ctx(), f))
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
})
