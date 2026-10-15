import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cueSidecarFile, cueSsml, voice, type VoiceDeps } from '../src/steps/06-voice'
import { estimateClipMs, fit, WPS, wordsThatFit, type FitCue } from '../src/steps/05-fit'
import { EDIT_WPS } from '../src/steps/05b-edit'
import { rateFactor, resolveEngine, VOICE_RATES } from '../src/voiceProfile'
import { metered, pollyUsd } from '../src/cost'
import type { Ctx } from '../src/steps/index'
import type { Described } from '../src/steps/04-describe'

// The user's choice (2026-10-15): descriptions in Polly Ruth, generative engine. Rates from the spike (docs/spikes/narrative-pass-sintel.md).

describe('voice profile', () => {
  it('Ruth generative speaks slower than Joanna neural: fit and the edit pass budget at its file rate', () => {
    expect(VOICE_RATES['Ruth/generative']).toEqual({ speechWps: 2.98, fileWps: 2.79 })
    expect(rateFactor('Joanna', 'neural')).toBe(1)
    expect(rateFactor('Ruth', 'generative')).toBeCloseTo(2.79 / 3.05, 9)
    expect(WPS * rateFactor('Ruth', 'generative')).toBeCloseTo(2.44, 2)
    expect(EDIT_WPS * rateFactor('Ruth', 'generative')).toBeCloseTo(2.01, 2)
    expect(rateFactor('Matthew', 'neural')).toBe(1) // not measured: today's budgets
  })
  it('the engine: --engine, else POLLY_ENGINE, else generative for Ruth, else neural; an unknown engine is refused', () => {
    expect(resolveEngine('Ruth', undefined, {})).toBe('generative')
    expect(resolveEngine('Joanna', undefined, {})).toBe('neural')
    expect(resolveEngine('Joanna', 'generative', {})).toBe('generative')
    expect(resolveEngine('Ruth', undefined, { POLLY_ENGINE: 'neural' })).toBe('neural')
    expect(() => resolveEngine('Ruth', 'long-form', {})).toThrow(/unknown Polly engine "long-form"/)
  })
  it('fit places fewer words in the same gap at Ruth\'s rate', () => {
    const ruth = WPS * rateFactor('Ruth', 'generative')
    expect(wordsThatFit(5000)).toBe(12)
    expect(wordsThatFit(5000, ruth)).toBe(11)
    expect(estimateClipMs(10, ruth)).toBeGreaterThan(estimateClipMs(10))
  })
  it('fit uses opts.wps for its slots', async () => {
    const shots: Described[] = [{ index: 0, startMs: 0, endMs: 6000, description: 'A young woman with short red hair walks slowly across the old stone bridge in the snow.', sameAsPrev: false, tokens: 0, outputTokens: 0 }]
    const gaps = [{ startMs: 0, endMs: 5200 }]
    const short = (t: string, n: number) => t.split(' ').slice(0, n).join(' ')
    const joanna = await fit(shots, gaps, short, 'en'), ruth = await fit(shots, gaps, short, 'en', { wps: WPS * rateFactor('Ruth', 'generative') })
    expect(joanna[0]!.endMs - joanna[0]!.startMs).toBeLessThan(ruth[0]!.endMs - ruth[0]!.startMs + 1) // same or longer estimate at Ruth's rate
  })
})

describe('06-voice with a generative engine', () => {
  let work: string
  beforeEach(async () => { work = await mkdtemp(join(tmpdir(), 'voice-engine-')) })
  afterEach(async () => { await rm(work, { recursive: true, force: true }) })
  const ctx = (o: Partial<Ctx> = {}): Ctx => ({ slug: 't', source: 's.mp4', language: 'en', voice: 'Ruth', engine: 'generative', work, ...o })
  const cue = (startMs: number, text: string): FitCue => ({ startMs, endMs: startMs + 1000, text, extended: false, wordCount: 2, shotIndex: 0, limitMs: startMs + 5000 })
  const fakes = () => ({ synthesize: vi.fn(async (t: string) => new TextEncoder().encode(t)), measureMs: vi.fn(async () => 1200) }) satisfies VoiceDeps

  it('SSML: no <prosody> on generative (supported only around full sentences); the 150 ms lead break stays', () => {
    expect(cueSsml('Smoke rises.', 'generative')).toBe('<speak><break time="150ms"/>Smoke rises.</speak>')
    expect(cueSsml('Smoke rises.')).toBe('<speak><break time="150ms"/><prosody rate="100%">Smoke rises.</prosody></speak>')
    expect(cueSsml('A & B.', 'generative')).toContain('A &amp; B.')
  })
  it('records the engine in the sidecar, prices Polly generative, and re-voices a clip when only the engine changed', async () => {
    await writeFile(`${work}/cues.json`, JSON.stringify([cue(1000, 'Smoke rises.')]))
    const f = fakes()
    const { costUsd } = await metered(() => voice(ctx(), f))
    expect(f.synthesize).toHaveBeenCalledWith('Smoke rises.', 'Ruth', 'en')
    expect(costUsd).toBeCloseTo(pollyUsd('Smoke rises.'.length, 'generative'), 12)
    expect(JSON.parse(await readFile(`${work}/${cueSidecarFile(0)}`, 'utf8'))).toMatchObject({ voice: 'Ruth', engine: 'generative', ssml: cueSsml('Smoke rises.', 'generative') })
    const again = fakes()
    await voice(ctx(), again)
    expect(again.synthesize).not.toHaveBeenCalled() // same voice, engine, text: reused
    // a neural sidecar with the same SSML is still another clip
    await writeFile(`${work}/${cueSidecarFile(0)}`, JSON.stringify({ text: 'Smoke rises.', voice: 'Ruth', language: 'en', ssml: cueSsml('Smoke rises.', 'generative'), durationMs: 1200 }))
    const third = fakes()
    await voice(ctx(), third)
    expect(third.synthesize).toHaveBeenCalledTimes(1)
  })
})
