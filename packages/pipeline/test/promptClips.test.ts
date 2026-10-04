import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PromptKey, Voice, promptAudioKey, promptTextFor, voiceLanguage } from '@described/contracts'
import { promptOptions, promptSsml, synthesizePrompts } from '../src/promptClips'

const fakePolly = () => {
  const inputs: Array<Record<string, string>> = []
  const send = vi.fn(async (cmd: unknown) => {
    inputs.push((cmd as { input: Record<string, string> }).input)
    return { AudioStream: { transformToByteArray: async () => new TextEncoder().encode(`mp3:${inputs.length}`) } }
  })
  return { polly: { send }, inputs }
}
const allChars = Voice.options.reduce((n, v) => n + PromptKey.options.reduce((m, k) => m + promptTextFor(v, k).length, 0), 0)

let out: string
beforeEach(async () => { out = await mkdtemp(join(tmpdir(), 'prompts-')); vi.stubEnv('S3_BUCKET_MEDIA', 'media-bucket') })
afterEach(async () => { await rm(out, { recursive: true, force: true }); vi.unstubAllEnvs() })

describe('synthesizePrompts', () => {
  it('synthesizes 4 voices × 4 keys in each voice\'s language', async () => {
    const { polly, inputs } = fakePolly()
    const r = await synthesizePrompts({ outDir: out, upload: false }, { polly })
    expect(polly.send).toHaveBeenCalledTimes(16)
    for (const v of Voice.options) for (const k of PromptKey.options) {
      expect(inputs).toContainEqual({ Engine: 'neural', VoiceId: v, OutputFormat: 'mp3', TextType: 'ssml', LanguageCode: voiceLanguage[v], Text: promptSsml(promptTextFor(v, k)) })
      expect(r.written).toContain(join(out, v, `${k}.mp3`))
    }
    expect(inputs.find((i) => i.VoiceId === 'Vicki')!.LanguageCode).toBe('de-DE')
    expect(await readFile(join(out, 'Vicki', 'firstRun1.mp3'), 'utf8')).toMatch(/^mp3:\d+$/)
    expect(r.uploaded).toEqual([])
    expect(r.chars).toBe(allChars)
    expect(r.usd).toBeCloseTo(allChars * 16 / 1e6, 8)
  })
  it('--dry-run makes no Polly call and reports 16 clips and the character count', async () => {
    const { polly } = fakePolly()
    const upload = vi.fn()
    const r = await synthesizePrompts({ outDir: out, upload: true, dryRun: true }, { polly, upload })
    expect(polly.send).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
    expect(r.clips).toHaveLength(16)
    expect(r.written).toEqual([])
    expect(r.chars).toBe(allChars)
    expect(r.chars).toBeGreaterThan(1000)
    expect(r.usd).toBeLessThan(0.05)
  })
  it('upload keys match promptAudioKey', async () => {
    const { polly } = fakePolly()
    const upload = vi.fn(async () => {})
    const r = await synthesizePrompts({ voices: ['Joanna', 'Vicki'], keys: ['voicePreview'], outDir: out, upload: true }, { polly, upload })
    expect(upload.mock.calls).toEqual([
      [join(out, 'Joanna', 'voicePreview.mp3'), `s3://media-bucket/${promptAudioKey('Joanna', 'voicePreview')}`, { ContentType: 'audio/mpeg', CacheControl: 'public,max-age=60' }],
      [join(out, 'Vicki', 'voicePreview.mp3'), `s3://media-bucket/${promptAudioKey('Vicki', 'voicePreview')}`, { ContentType: 'audio/mpeg', CacheControl: 'public,max-age=60' }],
    ])
    expect(r.uploaded).toEqual(['s3://media-bucket/published/prompts/Joanna/voicePreview.mp3', 's3://media-bucket/published/prompts/Vicki/voicePreview.mp3'])
  })
  it('refuses to upload without S3_BUCKET_MEDIA before calling Polly', async () => {
    vi.stubEnv('S3_BUCKET_MEDIA', '')
    const { polly } = fakePolly()
    await expect(synthesizePrompts({ outDir: out, upload: true }, { polly, upload: vi.fn() })).rejects.toThrow(/S3_BUCKET_MEDIA/)
    expect(polly.send).not.toHaveBeenCalled()
  })
  it('escapes XML in the SSML wrapper (same wrapper as 06-voice)', () => {
    expect(promptSsml('A & B <c>')).toBe('<speak><break time="150ms"/><prosody rate="100%">A &amp; B &lt;c&gt;</prosody></speak>')
  })
})

describe('promptOptions (pnpm pipeline prompts)', () => {
  it('defaults to a dry run; only --run calls Polly', () => {
    expect(promptOptions({ upload: true })).toEqual({ voices: undefined, outDir: 'work/prompts', upload: true, dryRun: true })
    expect(promptOptions({ upload: true, run: true }).dryRun).toBe(false)
    expect(promptOptions({ upload: true, run: true, dryRun: true }).dryRun).toBe(true)
  })
  it('parses --voice Vicki,Joanna, --out and --no-upload, and rejects an unknown voice', () => {
    expect(promptOptions({ voice: 'Vicki, Joanna', out: 'x', upload: false, run: true })).toEqual({ voices: ['Vicki', 'Joanna'], outDir: 'x', upload: false, dryRun: false })
    expect(() => promptOptions({ voice: 'Brian' })).toThrow()
  })
})
