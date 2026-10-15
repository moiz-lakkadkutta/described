import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cueSidecarFile, cueSsml, voice, type VoiceDeps } from '../src/steps/06-voice'
import { assertFitVoice, estimateClipMs, fit, FIT_VOICE_FILE, fitVoiceOf, WPS, wordsThatFit, type FitCue } from '../src/steps/05-fit'
import { EDIT_WPS, editCues } from '../src/steps/05b-edit'
import { rateFactor, resolveEngine, VOICE_RATES } from '../src/voiceProfile'
import { metered, pollyUsd } from '../src/cost'
import type { Ctx } from '../src/steps/index'
import type { Described } from '../src/steps/04-describe'

// The user's choice (2026-10-15): descriptions in Polly Ruth, generative engine. Rates from the spike (docs/spikes/narrative-pass-sintel.md).

describe('voice profile', () => {
  it('Ruth generative speaks slower than Joanna neural: fit and the edit pass budget at the more conservative of its file and speech rates', () => {
    expect(VOICE_RATES['Ruth/generative']).toEqual({ speechWps: 2.98, fileWps: 2.79 })
    expect(rateFactor('Joanna', 'neural')).toBe(1)
    expect(rateFactor('Ruth', 'generative')).toBeCloseTo(2.98 / 3.40, 9) // 0.876 < the file ratio 0.915
    expect(WPS * rateFactor('Ruth', 'generative')).toBeCloseTo(2.34, 2)
    expect(EDIT_WPS * rateFactor('Ruth', 'generative')).toBeCloseTo(1.93, 2)
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
    expect(wordsThatFit(5000, ruth)).toBe(10)
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

describe('a run that starts after fit with another voice than fit placed the cues for', () => {
  let work: string
  beforeEach(async () => { work = await mkdtemp(join(tmpdir(), 'fit-voice-')) })
  afterEach(async () => { await rm(work, { recursive: true, force: true }) })
  const ctx = (voice: string, engine?: 'neural' | 'generative') => ({ work, voice, ...(engine ? { engine } : {}) })

  it('fails loudly when cues.fit.voice.json names another voice or engine; passes when they match', async () => {
    await writeFile(`${work}/cues.fit.json`, '[]')
    await writeFile(`${work}/${FIT_VOICE_FILE}`, JSON.stringify(fitVoiceOf({ voice: 'Joanna', engine: 'neural' })))
    await expect(assertFitVoice(ctx('Ruth', 'generative'), 'edit')).rejects.toThrow('edit: fit placed these cues for Joanna neural; this run voices Ruth generative. Run again from fit (--from fit)')
    await expect(assertFitVoice(ctx('Joanna', 'generative'), 'voice')).rejects.toThrow(/Joanna generative/)
    await expect(assertFitVoice(ctx('Joanna'), 'edit')).resolves.toBeUndefined()
    await writeFile(`${work}/${FIT_VOICE_FILE}`, JSON.stringify(fitVoiceOf({ voice: 'Ruth', engine: 'generative' })))
    await expect(assertFitVoice(ctx('Ruth', 'generative'), 'edit')).resolves.toBeUndefined()
  })
  it('a work dir fitted before the file existed was fitted at Joanna neural\'s rate; with no cues.fit.json there is nothing to check', async () => {
    await expect(assertFitVoice(ctx('Ruth', 'generative'), 'edit')).resolves.toBeUndefined()
    await writeFile(`${work}/cues.fit.json`, '[]')
    await expect(assertFitVoice(ctx('Ruth', 'generative'), 'edit')).rejects.toThrow(/fitted before cues\.fit\.voice\.json existed/)
    await expect(assertFitVoice(ctx('Matthew'), 'edit')).resolves.toBeUndefined() // same rate as the calibration
  })
  it('edit and voice both refuse, so --from edit and --from voice cannot mix voices', async () => {
    await writeFile(`${work}/cues.fit.json`, '[]'); await writeFile(`${work}/cues.json`, '[]')
    await writeFile(`${work}/${FIT_VOICE_FILE}`, JSON.stringify(fitVoiceOf({ voice: 'Joanna' })))
    const c = { slug: 't', source: '', language: 'en' as const, voice: 'Ruth', engine: 'generative' as const, work }
    await expect(editCues(c)).rejects.toThrow(/^edit: fit placed these cues for Joanna neural/)
    await expect(voice(c, { synthesize: vi.fn(), measureMs: vi.fn() })).rejects.toThrow(/^voice: fit placed/)
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
