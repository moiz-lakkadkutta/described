import { clipSeconds, cutArgs, parseClock, parseOwnArgs, runOwn, slugify, titleUpsertArgs, type OwnDeps, type OwnOptions } from '../src/own'
import { estimateUsd } from '../src/cost'

describe('parseClock', () => {
  it('reads seconds, mm:ss and h:mm:ss', () => {
    expect(parseClock('90')).toBe(90)
    expect(parseClock('1:30')).toBe(90)
    expect(parseClock('01:30.5')).toBe(90.5)
    expect(parseClock('1:02:03')).toBe(3723)
  })
  it('rejects anything else', () => {
    for (const s of ['', 'abc', '1:60', '1:2:3:4', '-5', '1:-1']) expect(() => parseClock(s)).toThrow(/time/)
  })
})

describe('slugify', () => {
  it('turns a title into a path-safe slug', () => {
    expect(slugify('My Film: Part 2!')).toBe('my-film-part-2')
    expect(slugify('  Ça va  ')).toBe('ca-va')
    expect(slugify('x'.repeat(80))).toHaveLength(64)
  })
})

describe('parseOwnArgs', () => {
  it('takes the input, --title and the defaults', () => {
    const o = parseOwnArgs(['film.mp4', '--title', 'My Film'], {})
    expect(o).toMatchObject({ input: 'film.mp4', title: 'My Film', slug: 'my-film', language: 'en', voice: 'Joanna', dryRun: false, yes: false, replace: false, license: 'All rights reserved' })
    expect(o.credit).toBe('My Film. Described by Described.')
    expect(o.startS).toBeUndefined()
    expect(o.endS).toBeUndefined()
  })
  it('reads every flag', () => {
    const o = parseOwnArgs(['https://example.com/a.mp4', '--title', 'A', '--slug', 'a-1', '--start', '1:30', '--end', '2:30', '--language', 'de', '--voice', 'Daniel',
      '--license', 'CC-BY 4.0', '--credit', 'A © Me, CC-BY 4.0.', '--year', '2024', '--synopsis', 'S.', '--dry-run', '--yes', '--replace'], {})
    expect(o).toMatchObject({ input: 'https://example.com/a.mp4', slug: 'a-1', startS: 90, endS: 150, language: 'de', voice: 'Daniel', license: 'CC-BY 4.0', year: 2024, synopsis: 'S.', dryRun: true, yes: true, replace: true })
    expect(o.credit).toBe('A © Me, CC-BY 4.0. Described by Described.') // the app's credit sentence always ends this way
  })
  it('keeps a credit that already ends with the Described sentence, and voices default by language', () => {
    expect(parseOwnArgs(['a.mp4', '--title', 'A', '--credit', 'A. Described by Described.'], {}).credit).toBe('A. Described by Described.')
    expect(parseOwnArgs(['a.mp4', '--title', 'A', '--language', 'de'], {}).voice).toBe('Vicki')
    expect(parseOwnArgs(['a.mp4', '--title', 'A'], { POLLY_VOICE_EN: 'Matthew' }).voice).toBe('Matthew')
  })
  it('rejects what the pipeline cannot take', () => {
    expect(() => parseOwnArgs([], {})).toThrow(/usage/i)
    expect(() => parseOwnArgs(['a.mp4'], {})).toThrow(/--title/)
    expect(() => parseOwnArgs(['a.mp4', 'b.mp4', '--title', 'A'], {})).toThrow(/one input/)
    expect(() => parseOwnArgs(['http://example.com/a.mp4', '--title', 'A'], {})).toThrow(/https/)
    expect(() => parseOwnArgs(['a.mp4', '--title', 'A', '--slug', 'Bad Slug'], {})).toThrow(/slug/)
    expect(() => parseOwnArgs(['a.mp4', '--title', 'A', '--slug', 'prompts'], {})).toThrow(/reserved/)
    expect(() => parseOwnArgs(['a.mp4', '--title', '!!!'], {})).toThrow(/--slug/)
    expect(() => parseOwnArgs(['a.mp4', '--title', 'A', '--language', 'fr'], {})).toThrow()
    expect(() => parseOwnArgs(['a.mp4', '--title', 'A', '--voice', 'Brian'], {})).toThrow(/voice/)
    expect(() => parseOwnArgs(['a.mp4', '--title', 'A', '--voice', 'Daniel'], {})).toThrow(/speaks de/) // a German voice on an English title
    expect(() => parseOwnArgs(['a.mp4', '--title', 'A', '--start', '2:00', '--end', '1:00'], {})).toThrow(/--end/)
    expect(() => parseOwnArgs(['a.mp4', '--title', 'A', '--nope'], {})).toThrow()
  })
})

describe('clipSeconds', () => {
  it('is the described span, clamped to the source', () => {
    expect(clipSeconds(600)).toEqual({ startS: 0, endS: 600, seconds: 600 })
    expect(clipSeconds(600, 90, 150)).toEqual({ startS: 90, endS: 150, seconds: 60 })
    expect(clipSeconds(100, 90, 150)).toEqual({ startS: 90, endS: 100, seconds: 10 })
    expect(clipSeconds(600, 90)).toEqual({ startS: 90, endS: 600, seconds: 510 })
  })
  it('refuses a start at or past the end of the source', () => {
    expect(() => clipSeconds(60, 60)).toThrow(/--start/)
  })
})

describe('cutArgs', () => {
  it('is the docs/titles.md cut: first video and audio stream, H.264 CRF 18, AAC 192k, faststart', () => {
    expect(cutArgs('in.mov', 'out.mp4', { startS: 90, endS: 150 })).toEqual(['-y', '-ss', '90', '-i', 'in.mov', '-t', '60', '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'out.mp4'])
    expect(cutArgs('in.mov', 'out.mp4')).toEqual(['-y', '-i', 'in.mov', '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'out.mp4'])
  })
})

describe('titleUpsertArgs', () => {
  it('creates a draft with its source asset; --replace also swaps the source asset', () => {
    const o = parseOwnArgs(['a.mp4', '--title', 'A', '--year', '2024'], {})
    const a = titleUpsertArgs(o, 'sources/a.mp4', 'eu-central-1')
    expect(a.where).toEqual({ slug: 'a' })
    expect(a.create).toMatchObject({ slug: 'a', name: 'A', year: 2024, license: 'All rights reserved', attribution: 'A. Described by Described.', language: 'en', voice: 'Joanna', assets: { create: { kind: 'source', s3Key: 'sources/a.mp4', region: 'eu-central-1' } } })
    expect(a.create).not.toHaveProperty('status') // a draft (the schema default) until persistForCli publishes it
    expect(a.update).toMatchObject({ name: 'A', language: 'en', voice: 'Joanna', assets: { deleteMany: { kind: 'source' }, create: { kind: 'source', s3Key: 'sources/a.mp4' } } })
  })
})

const ENV = { S3_BUCKET_MEDIA: 'media-bucket', CLOUDFRONT_DOMAIN: 'd123.cloudfront.net', DATABASE_URL: 'postgresql://x', AWS_REGION: 'eu-central-1' }
function fakeDeps(over: Partial<OwnDeps> = {}) {
  const calls: string[] = []
  const lines: string[] = []
  const deps: OwnDeps = {
    env: ENV,
    log: (l) => { lines.push(l) },
    probe: async () => { calls.push('probe'); return { durationS: 3600, hasVideo: true, hasAudio: true } },
    titleExists: async () => { calls.push('titleExists'); return false },
    confirm: async () => { calls.push('confirm'); return true },
    prepare: async (_o, out) => { calls.push('prepare'); return out },
    upload: async (_f, uri) => { calls.push(`upload ${uri}`) },
    register: async () => { calls.push('register') },
    describe: async (input) => { calls.push(`describe ${input.slug} ${input.source} ${input.language} ${input.voice}`); return 3.21 },
    persist: async (slug) => { calls.push(`persist ${slug}`) },
    ...over,
  }
  return { deps, calls, lines }
}
const opts = (extra: string[] = []): OwnOptions => parseOwnArgs(['film.mp4', '--title', 'My Film', ...extra], {})

describe('runOwn', () => {
  it('estimates, confirms, then uploads, registers, describes, persists and prints the measured cost and the HLS URL', async () => {
    const { deps, calls, lines } = fakeDeps()
    const r = await runOwn(opts(), deps)
    expect(calls).toEqual(['probe', 'titleExists', 'confirm', 'prepare', 'upload s3://media-bucket/sources/my-film.mp4', 'register', 'describe my-film s3://media-bucket/sources/my-film.mp4 en Joanna', 'persist my-film'])
    expect(r).toMatchObject({ ran: true, costUsd: 3.21, hlsUrl: 'https://d123.cloudfront.net/published/my-film/master.m3u8' })
    expect(r.estimate.total).toBeCloseTo(estimateUsd(3600).total)
    const out = lines.join('\n')
    expect(out).toContain('$3.21')
    expect(out).toContain('https://d123.cloudfront.net/published/my-film/master.m3u8')
    expect(out.indexOf('estimate')).toBeLessThan(out.indexOf('$3.21')) // the estimate is printed before anything is spent
  })
  it('--dry-run probes and estimates only: no confirm, no upload, no row, no AWS step', async () => {
    const { deps, calls, lines } = fakeDeps()
    const r = await runOwn(opts(['--dry-run']), deps)
    expect(calls).toEqual(['probe', 'titleExists'])
    expect(r.ran).toBe(false)
    expect(lines.join('\n')).toMatch(/dry run/i)
  })
  it('--dry-run without DATABASE_URL or S3 settings still estimates, and names what a real run would need', async () => {
    const { deps, calls, lines } = fakeDeps({ env: {} })
    await runOwn(opts(['--dry-run']), deps)
    expect(calls).toEqual(['probe'])
    expect(lines.join('\n')).toMatch(/S3_BUCKET_MEDIA.*CLOUDFRONT_DOMAIN.*DATABASE_URL/s)
  })
  it('a real run without the settings stops before spending', async () => {
    const { deps, calls } = fakeDeps({ env: { ...ENV, S3_BUCKET_MEDIA: undefined } })
    await expect(runOwn(opts(['--yes']), deps)).rejects.toThrow(/S3_BUCKET_MEDIA/)
    expect(calls).toEqual(['probe'])
  })
  it('--yes skips the question; a no stops before spending', async () => {
    const yes = fakeDeps()
    await runOwn(opts(['--yes']), yes.deps)
    expect(yes.calls).not.toContain('confirm')
    const no = fakeDeps({ confirm: async () => false })
    const r = await runOwn(opts(), no.deps)
    expect(r.ran).toBe(false)
    expect(no.calls).toEqual(['probe', 'titleExists'])
  })
  it('refuses an existing slug unless --replace', async () => {
    const { deps, calls } = fakeDeps({ titleExists: async () => true })
    await expect(runOwn(opts(['--yes']), deps)).rejects.toThrow(/--replace/)
    expect(calls).toEqual(['probe'])
    const again = fakeDeps({ titleExists: async () => true })
    await runOwn(opts(['--yes', '--replace']), again.deps)
    expect(again.calls).toContain('register')
  })
  it('refuses a source without a video or an audio stream before spending', async () => {
    const { deps, calls } = fakeDeps({ probe: async () => ({ durationS: 60, hasVideo: true, hasAudio: false }) })
    await expect(runOwn(opts(['--yes']), deps)).rejects.toThrow(/audio/)
    expect(calls).toEqual([])
  })
  it('estimates the --start/--end span, not the whole source', async () => {
    const { deps } = fakeDeps()
    const r = await runOwn(opts(['--dry-run', '--start', '1:30', '--end', '2:30']), deps)
    expect(r.seconds).toBe(60)
    expect(r.estimate.total).toBeCloseTo(estimateUsd(60).total)
  })
  it('passes the source and span to prepare, and --language/--voice to describe and persist', async () => {
    let prepared: unknown
    let spoken: unknown
    const { deps, calls } = fakeDeps({ prepare: async (o, out, span) => { prepared = { o, out, span }; return out }, persist: async (_s, _w, sp) => { spoken = sp } })
    await runOwn(parseOwnArgs(['film.mp4', '--title', 'F', '--language', 'de', '--voice', 'Daniel', '--start', '10', '--end', '70', '--yes'], {}), deps)
    expect(prepared).toEqual({ o: 'film.mp4', out: 'work/f/upload.mp4', span: { startS: 10, endS: 70 } })
    expect(calls).toContain('describe f s3://media-bucket/sources/f.mp4 de Daniel')
    expect(spoken).toEqual({ language: 'de', voice: 'Daniel' })
  })
  it('a failed step leaves the measured cost and the resume command in the error', async () => {
    const { deps, calls } = fakeDeps({ describe: async () => { throw Object.assign(new Error('Polly throttled'), { costUsd: 0.5 }) } })
    await expect(runOwn(opts(['--yes']), deps)).rejects.toThrow(/Polly throttled[\s\S]*pnpm pipeline describe --title my-film --source s3:\/\/media-bucket\/sources\/my-film\.mp4/)
    expect(calls).not.toContain('persist my-film')
  })
})
