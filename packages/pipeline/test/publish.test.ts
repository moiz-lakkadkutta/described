import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import { cacheControl, contentType, createInvalidation } from '../src/s3'
import { pack, type PackageReport } from '../src/steps/09-package'
import { publish } from '../src/steps/10-publish'
import type { Ctx } from '../src/steps'

const execa = vi.hoisted(() => vi.fn())
vi.mock('execa', () => ({ execa }))

const exists = (f: string) => access(f).then(() => true, () => false)
const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello.\n'

/** A work dir after steps 1–8 (and, for publish, after package): VTTs, sdh.json, cues.json, optional hls/ and art/. */
async function work(slug = 'sintel') {
  const dir = join(await mkdtemp(join(tmpdir(), 'publish-')), slug)
  await mkdir(dir, { recursive: true })
  for (const f of ['captions.vtt', 'sdh.vtt', 'descriptions.vtt']) await writeFile(join(dir, f), VTT)
  await writeFile(join(dir, 'sdh.json'), JSON.stringify({ degraded: false }))
  await writeFile(join(dir, 'cues.json'), '[]')
  return { dir, ctx: { slug, source: 's3://b/s.mp4', language: 'en', voice: 'Joanna', work: dir } satisfies Ctx }
}

describe('09-package', () => {
  beforeEach(() => execa.mockReset())
  it('pack clears a stale hls/ dir before packager runs', async () => {
    const { dir, ctx } = await work()
    await mkdir(join(dir, 'hls', 'video'), { recursive: true })
    await writeFile(join(dir, 'hls', 'video', '99.m4s'), 'stale segment from a longer run')
    let staleAtRun: boolean | undefined
    execa.mockImplementation(async () => { staleAtRun = await exists(join(dir, 'hls', 'video', '99.m4s')) })
    await pack(ctx)
    expect(execa).toHaveBeenCalledWith('packager', expect.any(Array), expect.objectContaining({ cwd: dir }))
    expect(staleAtRun).toBe(false)
  })
  it('pack writes package.json with what it advertised (degraded SDH, header-only descriptions)', async () => {
    const { dir, ctx } = await work()
    await writeFile(join(dir, 'sdh.json'), JSON.stringify({ degraded: true }))
    await writeFile(join(dir, 'descriptions.vtt'), 'WEBVTT\n\n')
    execa.mockResolvedValue({})
    await pack({ ...ctx, language: 'de' })
    expect(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))).toEqual<PackageReport>({ language: 'de', tracks: { captions: true, sdh: false, descriptions: false } })
  })
})

describe('s3 helpers', () => {
  it('cacheControl gives .vtt 60 s and .m4s a year', () => {
    expect(cacheControl('hls/captions/1.vtt')).toBe('public,max-age=60')
    expect(cacheControl('captions.vtt')).toBe('public,max-age=60')
    expect(cacheControl('hls/master.m3u8')).toBe('public,max-age=60')
    expect(cacheControl('art/poster.jpg')).toBe('public,max-age=60')
    expect(cacheControl('hls/video/1.m4s')).toBe('public,max-age=31536000,immutable')
    expect(cacheControl('cue_0.mp3')).toBe('public,max-age=31536000,immutable')
    expect(contentType('art/hero.jpg')).toBe('image/jpeg')
  })
  it('createInvalidation sends CreateInvalidation with the paths and a unique CallerReference', async () => {
    const send = vi.fn(async () => ({}))
    await createInvalidation('E2ABC', ['/published/sintel/*'], { send } as never)
    await createInvalidation('E2ABC', ['/published/sintel/*'], { send } as never)
    const [a, b] = send.mock.calls.map((c) => (c as unknown[])[0] as CreateInvalidationCommand)
    expect(a).toBeInstanceOf(CreateInvalidationCommand)
    expect(a!.input).toEqual({ DistributionId: 'E2ABC', InvalidationBatch: { CallerReference: expect.any(String), Paths: { Quantity: 1, Items: ['/published/sintel/*'] } } })
    expect(a!.input.InvalidationBatch!.CallerReference).not.toBe(b!.input.InvalidationBatch!.CallerReference)
  })
})

describe('10-publish', () => {
  const env = { ...process.env }
  beforeEach(() => { process.env.S3_BUCKET_MEDIA = 'media'; process.env.CLOUDFRONT_DOMAIN = 'd.invalid'; vi.spyOn(console, 'log').mockImplementation(() => {}) })
  afterEach(() => { process.env = { ...env }; vi.restoreAllMocks() })
  async function published() {
    const w = await work()
    await mkdir(join(w.dir, 'hls'), { recursive: true })
    await writeFile(join(w.dir, 'hls', 'master.m3u8'), '#EXTM3U\n')
    return w
  }

  it('publish uploads work/art/*.jpg under published/{slug}/art/', async () => {
    const { dir, ctx } = await published()
    await mkdir(join(dir, 'art'))
    await writeFile(join(dir, 'art', 'poster.jpg'), 'jpg')
    await writeFile(join(dir, 'art', 'hero.jpg'), 'jpg')
    await writeFile(join(dir, 'art', 'notes.txt'), 'not art')
    const upload = vi.fn(async () => {})
    await publish(ctx, { upload })
    const art = upload.mock.calls.map((c) => c as unknown as [string, string, { ContentType: string; CacheControl: string }]).filter(([, uri]) => uri.includes('/art/'))
    expect(art.map(([f, uri, o]) => [f, uri, o]).sort()).toEqual([
      [join(dir, 'art', 'hero.jpg'), 's3://media/published/sintel/art/hero.jpg', { ContentType: 'image/jpeg', CacheControl: 'public,max-age=60' }],
      [join(dir, 'art', 'poster.jpg'), 's3://media/published/sintel/art/poster.jpg', { ContentType: 'image/jpeg', CacheControl: 'public,max-age=60' }],
    ])
  })
  it('publish without work/art uploads the playlist and the whole-file VTTs with 60 s caching', async () => {
    const { ctx } = await published()
    const upload = vi.fn(async () => {})
    await publish(ctx, { upload })
    expect(upload.mock.calls.map((c) => [(c as unknown[])[1], ((c as unknown[])[2] as { CacheControl: string }).CacheControl]).sort()).toEqual([
      ['s3://media/published/sintel/captions.vtt', 'public,max-age=60'],
      ['s3://media/published/sintel/descriptions.vtt', 'public,max-age=60'],
      ['s3://media/published/sintel/master.m3u8', 'public,max-age=60'],
      ['s3://media/published/sintel/sdh.vtt', 'public,max-age=60'],
    ])
  })
  it('publish calls CreateInvalidation only when PUBLISH_INVALIDATE=1', async () => {
    const { ctx } = await published()
    const upload = vi.fn(async () => {})
    const invalidate = vi.fn(async () => {})
    process.env.CLOUDFRONT_DISTRIBUTION_ID = 'E2ABC'
    delete process.env.PUBLISH_INVALIDATE
    await publish(ctx, { upload, invalidate })
    expect(invalidate).not.toHaveBeenCalled()
    process.env.PUBLISH_INVALIDATE = '1'
    delete process.env.CLOUDFRONT_DISTRIBUTION_ID
    await publish(ctx, { upload, invalidate })
    expect(invalidate).not.toHaveBeenCalled() // no distribution to invalidate
    process.env.CLOUDFRONT_DISTRIBUTION_ID = 'E2ABC'
    await publish(ctx, { upload, invalidate })
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith('E2ABC', ['/published/sintel/*'])
    expect(invalidate.mock.invocationCallOrder[0]).toBeGreaterThan(Math.max(...upload.mock.invocationCallOrder)) // after every upload
  })
})
