import { runDescribe, STEPS } from '../src/steps'
import { runJobStep } from '../src/jobs'
import { resolveLanguageAndVoice } from '../src/steps/06-voice'
import { waitForTranscription, TRANSCRIBE_TIMEOUT_MS } from '../src/steps/03-speech'

const calls = vi.hoisted(() => [] as string[])
vi.mock('../src/steps/09-package', () => ({ pack: vi.fn(async () => { calls.push('package') }) }))
vi.mock('../src/validate', () => ({ validateWork: vi.fn(async () => { calls.push('validate') }) }))
vi.mock('../src/steps/10-publish', () => ({ publish: vi.fn(async () => { calls.push('publish') }) }))

const input = { slug: 'sintel-90-150', source: 's3://bucket/sintel.mp4', language: 'en' as const, voice: 'Joanna' }

describe('runDescribe', () => {
  it('throws on an unknown --from step and lists the valid steps', async () => {
    await expect(runDescribe({ ...input, fromStep: 'transcribe' })).rejects.toThrow(`unknown step "transcribe"; valid steps: ${STEPS.join(', ')}`)
    expect(STEPS).toEqual(['probe', 'shots', 'speech', 'describe', 'fit', 'edit', 'voice', 'mix', 'text', 'package', 'validate', 'publish'])
  })
  it('runDescribe runs validate between package and publish', async () => {
    calls.length = 0
    vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'time').mockImplementation(() => {}); vi.spyOn(console, 'timeEnd').mockImplementation(() => {})
    await runDescribe({ ...input, fromStep: 'package' })
    expect(calls).toEqual(['package', 'validate', 'publish'])
    calls.length = 0
    await runDescribe({ ...input, fromStep: 'validate' }) // --from validate re-checks a packaged work dir, then publishes
    expect(calls).toEqual(['validate', 'publish'])
    vi.restoreAllMocks()
  })
  it('the finish job runs validate too (steps 6–10 end with package, validate, publish)', async () => {
    calls.length = 0
    const runStep = await import('../src/steps')
    const spy = vi.spyOn(runStep, 'runStep')
    spy.mockImplementation(async (s) => { calls.push(s) })
    await runJobStep('finish', { ...input, work: 'work/x' })
    expect(calls[0]).toBe('edit') // the scene edit pass (DESC-018) runs in the finish job, before voice
    expect(calls.slice(-3)).toEqual(['package', 'validate', 'publish'])
    spy.mockRestore()
  })
  it('rejects a slug outside ^[a-z0-9-]{1,64}$ before running any step', async () => {
    for (const slug of ['', 'Sintel', '../etc', 'a/b', 'a b', 'x'.repeat(65), 'sintel_90']) await expect(runDescribe({ ...input, slug, fromStep: 'transcribe' })).rejects.toThrow(/slug/)
  })
})

describe('resolveLanguageAndVoice', () => {
  it('defaults the voice by language: en → Joanna, de → Vicki', () => {
    expect(resolveLanguageAndVoice({}, {})).toEqual({ language: 'en', voice: 'Joanna' })
    expect(resolveLanguageAndVoice({ lang: 'de' }, {})).toEqual({ language: 'de', voice: 'Vicki' })
  })
  it('reads POLLY_VOICE_EN / POLLY_VOICE_DE and lets --voice win', () => {
    const env = { POLLY_VOICE_EN: 'Matthew', POLLY_VOICE_DE: 'Daniel' }
    expect(resolveLanguageAndVoice({ lang: 'en' }, env).voice).toBe('Matthew')
    expect(resolveLanguageAndVoice({ lang: 'de' }, env).voice).toBe('Daniel')
    expect(resolveLanguageAndVoice({ lang: 'de', voice: 'Marlene' }, env).voice).toBe('Marlene')
  })
  it('rejects a --lang other than en or de', () => {
    expect(() => resolveLanguageAndVoice({ lang: 'fr' }, {})).toThrow()
  })
})

describe('waitForTranscription', () => {
  const clock = () => { let t = 0; return { now: () => t, sleep: async (ms: number) => { t += ms } } }
  it('returns once the job is COMPLETED', async () => {
    const statuses = ['QUEUED', 'IN_PROGRESS', 'COMPLETED']
    await expect(waitForTranscription(async () => ({ status: statuses.shift() }), { ...clock(), pollMs: 5000 })).resolves.toBeUndefined()
    expect(statuses).toEqual([])
  })
  it('throws with the FailureReason when the job FAILED', async () => {
    await expect(waitForTranscription(async () => ({ status: 'FAILED', failureReason: 'Unsupported media format' }), clock())).rejects.toThrow(/FAILED: Unsupported media format/)
  })
  it('throws after a 30 min deadline', async () => {
    expect(TRANSCRIBE_TIMEOUT_MS).toBe(30 * 60_000)
    let polls = 0
    await expect(waitForTranscription(async () => { polls++; return { status: 'IN_PROGRESS' } }, { ...clock(), pollMs: 5000 })).rejects.toThrow(/30 min/)
    expect(polls).toBeLessThanOrEqual(30 * 60 / 5 + 1)
  })
})
