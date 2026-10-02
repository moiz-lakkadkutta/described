import { runDescribe, STEPS } from '../src/steps'
import { resolveLanguageAndVoice } from '../src/steps/06-voice'
import { waitForTranscription, TRANSCRIBE_TIMEOUT_MS } from '../src/steps/03-speech'

const input = { slug: 'sintel-90-150', source: 's3://bucket/sintel.mp4', language: 'en' as const, voice: 'Joanna' }

describe('runDescribe', () => {
  it('throws on an unknown --from step and lists the valid steps', async () => {
    await expect(runDescribe({ ...input, fromStep: 'transcribe' })).rejects.toThrow(`unknown step "transcribe"; valid steps: ${STEPS.join(', ')}`)
    expect(STEPS).toEqual(['probe', 'shots', 'speech', 'describe', 'fit', 'voice', 'mix', 'text', 'package', 'publish'])
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
