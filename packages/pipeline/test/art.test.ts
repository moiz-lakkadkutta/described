import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { download, execa } = vi.hoisted(() => ({ download: vi.fn(async () => {}), execa: vi.fn() }))
vi.mock('../src/s3', () => ({ download }))
vi.mock('execa', () => ({ execa }))
import { artArgs, probe } from '../src/steps/01-probe'

const pair = (args: string[], flag: string) => args[args.indexOf(flag) + 1]

describe('artArgs', () => {
  it('artArgs crops a 16:9 frame to 1488×560 and a 2:3 poster', () => {
    const { hero, poster } = artArgs('work/x', 42.5)
    for (const a of [hero, poster]) {
      expect(pair(a, '-ss')).toBe('42.5')
      expect(a.indexOf('-ss')).toBeLessThan(a.indexOf('-i')) // input seek: fast, decodes one frame
      expect(pair(a, '-i')).toBe('work/x/mezz.mp4')
      expect(pair(a, '-frames:v')).toBe('1')
    }
    expect(pair(hero, '-vf')).toBe('scale=1488:560:force_original_aspect_ratio=increase,crop=1488:560')
    expect(hero.at(-1)).toBe('work/x/art/hero.jpg')
    expect(pair(poster, '-vf')).toBe('crop=ih*2/3:ih,scale=480:720')
    expect(poster.at(-1)).toBe('work/x/art/poster.jpg')
  })
})

describe('probe art', () => {
  let work: string
  const ctx = () => ({ slug: 's', source: 's3://b/s.mp4', language: 'en' as const, voice: 'Joanna', work })
  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), 'art-'))
    execa.mockReset().mockImplementation(async (cmd: string) => (cmd === 'ffprobe' ? { stdout: JSON.stringify({ format: { duration: '600.0' }, streams: [{ codec_type: 'video', r_frame_rate: '24/1' }] }) } : { stdout: '' }))
  })
  afterEach(async () => { await rm(work, { recursive: true, force: true }); vi.unstubAllEnvs() })
  const artCalls = () => execa.mock.calls.filter(([, a]) => String((a as string[]).at(-1)).includes('/art/'))

  it('probe writes work/art when ffmpeg succeeds and continues when it fails', async () => {
    await probe(ctx())
    expect((await stat(join(work, 'art'))).isDirectory()).toBe(true)
    expect(artCalls().map(([, a]) => (a as string[]).at(-1))).toEqual([`${work}/art/hero.jpg`, `${work}/art/poster.jpg`])
    expect(artCalls().every(([, a]) => pair(a as string[], '-ss') === '180')).toBe(true) // 30 % of 600 s

    execa.mockImplementation(async (cmd: string, a: string[]) => {
      if (cmd === 'ffprobe') return { stdout: JSON.stringify({ format: { duration: '600.0' }, streams: [] }) }
      if (String(a.at(-1)).includes('/art/')) throw new Error('ffmpeg: no frame')
      return { stdout: '' }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(probe(ctx())).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/art/), expect.anything())
    warn.mockRestore()
  })
  it('PIPELINE_ART_AT_S overrides the 30 % point', async () => {
    vi.stubEnv('PIPELINE_ART_AT_S', '12')
    await probe(ctx())
    expect(artCalls().map(([, a]) => pair(a as string[], '-ss'))).toEqual(['12', '12'])
  })
  it('PIPELINE_ART_AT_S=0 takes the first frame', async () => {
    vi.stubEnv('PIPELINE_ART_AT_S', '0')
    await probe(ctx())
    expect(artCalls().map(([, a]) => pair(a as string[], '-ss'))).toEqual(['0', '0'])
  })
})
