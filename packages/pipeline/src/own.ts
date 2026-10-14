import { parseArgs } from 'node:util'
import { Voice, voiceLanguage } from '@described/contracts'
import { estimateUsd, type Estimate } from './cost'
import { SLUG_RE, type DescribeInput } from './steps'
import { resolveLanguageAndVoice } from './steps/06-voice'
import type { Spoken } from './cues'

/**
 * `pnpm describe <file-or-https-url> --title "…"` (DESC-025): one command from a video you own to a described HLS stream in the
 * catalogue. It adds only what the pipeline CLI lacked — getting the file into S3, creating the Title row, an estimate before
 * any money is spent — and then runs the same steps (runDescribe) and writes the same rows (persistForCli).
 */
export const USAGE = `usage: pnpm describe <file.mp4 | https://…/file.mp4> --title "Name" [--slug name] [--start mm:ss] [--end mm:ss]
       [--language en|de] [--voice Joanna|Matthew|Vicki|Daniel] [--license "…"] [--credit "…"] [--year 2024] [--synopsis "…"]
       [--dry-run] [--yes] [--replace] [--long]`

/** Above this much film a run needs --long: the describe prompt is not yet re-checked on a full-length title (DESC-024, decision 0008). */
export const LONG_FILM_S = 15 * 60

export interface OwnOptions {
  input: string; title: string; slug: string; startS?: number; endS?: number; language: 'en' | 'de'; voice: string
  /** Only what was given: the defaults go on a new Title row only, so --replace never overwrites a title's licence or credit. */
  license?: string; credit?: string; year?: number; synopsis?: string; dryRun: boolean; yes: boolean; replace: boolean; long: boolean
}

/** Seconds from `90`, `1:30`, `01:30.5` or `1:02:03`. */
export function parseClock(s: string): number {
  const parts = s.trim().split(':')
  const ok = parts.length <= 3 && parts.every((p, i) => (i === parts.length - 1 ? /^\d+(\.\d+)?$/ : /^\d+$/).test(p)) && parts.slice(1).every((p) => Number(p) < 60)
  if (!s.trim() || !ok) throw new Error(`not a time: "${s}" (use seconds, mm:ss or h:mm:ss)`)
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0)
}
const clock = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = Math.round(s % 60); return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(r).padStart(2, '0')}` }

/** A path-safe slug (SLUG_RE) from a title: accents dropped, anything else becomes `-`, at most 64 characters. */
export const slugify = (title: string) => title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '')

const SENTENCE = 'Described by Described.'
/** Pure (tested). Flags → options; throws with the usage on anything the pipeline would reject later. */
export function parseOwnArgs(argv: string[], env: Record<string, string | undefined> = process.env): OwnOptions {
  const { values: v, positionals } = parseArgs({
    args: argv, allowPositionals: true, strict: true,
    options: {
      title: { type: 'string' }, slug: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, language: { type: 'string' },
      voice: { type: 'string' }, license: { type: 'string' }, credit: { type: 'string' }, year: { type: 'string' }, synopsis: { type: 'string' },
      'dry-run': { type: 'boolean' }, yes: { type: 'boolean' }, replace: { type: 'boolean' }, long: { type: 'boolean' },
    },
  })
  if (positionals.length === 0) throw new Error(USAGE)
  if (positionals.length > 1) throw new Error(`one input only, got ${positionals.length}\n${USAGE}`)
  const input = positionals[0]!
  if (/^[a-z]+:\/\//i.test(input) && !isHttps(input)) throw new Error(`input must be a local file or an https:// URL: ${input}`)
  if (/\.(m3u8|mpd)$/i.test(isHttps(input) ? new URL(input).pathname : input)) throw new Error(`a playlist (.m3u8/.mpd) is not a video file: give the URL of the .mp4 itself`)
  if (!v.title?.trim()) throw new Error(`--title is required\n${USAGE}`)
  const title = v.title.trim()
  const slug = v.slug ?? slugify(title)
  if (!slug) throw new Error(`no slug can be made from "${title}"; pass --slug`)
  if (!SLUG_RE.test(slug)) throw new Error(`invalid slug "${slug}": must match ${SLUG_RE.source}`)
  if (slug === 'prompts') throw new Error('slug "prompts" is reserved (published/prompts/ holds the app-voice clips)')
  const { language, voice } = resolveLanguageAndVoice({ lang: v.language, voice: v.voice }, env)
  const known = Voice.safeParse(voice)
  if (!known.success) throw new Error(`unknown voice "${voice}": use one of ${Voice.options.join(', ')}`)
  if (!voiceLanguage[known.data].startsWith(language)) throw new Error(`voice ${voice} speaks ${voiceLanguage[known.data].slice(0, 2)}, not ${language}`)
  const startS = v.start === undefined ? undefined : parseClock(v.start)
  const endS = v.end === undefined ? undefined : parseClock(v.end)
  if (endS !== undefined && endS <= (startS ?? 0)) throw new Error('--end must be after --start')
  if (v.year !== undefined && !/^\d{4}$/.test(v.year.trim())) throw new Error(`--year must be a four-digit year: "${v.year}"`)
  const year = v.year === undefined ? undefined : Number(v.year.trim())
  return {
    input, title, slug, startS, endS, language, voice, license: v.license?.trim() || undefined, credit: v.credit?.trim() ? creditSentence(v.credit) : undefined,
    year, synopsis: v.synopsis, dryRun: !!v['dry-run'], yes: !!v.yes, replace: !!v.replace, long: !!v.long,
  }
}

/** The app's credit line: full sentences (decision 0002), always ending "Described by Described." */
export function creditSentence(text: string): string {
  const t = text.trim()
  if (t.endsWith(SENTENCE)) return t
  return `${/[.!?]$/.test(t) ? t : `${t}.`} ${SENTENCE}`
}
export const isHttps = (s: string) => /^https:\/\//i.test(s)
/** ffmpeg/ffprobe may follow only these protocols for an https input (no concat:, no subfile:, no local file tricks via a playlist). https://ffmpeg.org/ffmpeg-protocols.html#Protocol-Options */
const whitelist = (input: string) => (isHttps(input) ? ['-protocol_whitelist', 'file,http,https,tcp,tls'] : [])
/** Pure (tested). ffprobe of the local file or URL: streams and duration only. */
export const probeArgs = (input: string) => ['-v', 'error', ...whitelist(input), '-print_format', 'json', '-show_format', '-show_streams', input]

/** Pure (tested). The span that will be described, clamped to the source's length. */
export function clipSeconds(durationS: number, startS?: number, endS?: number) {
  const start = startS ?? 0
  if (start >= durationS) throw new Error(`--start ${clock(start)} is at or past the end of the source (${clock(durationS)})`)
  const end = Math.min(endS ?? durationS, durationS)
  return { startS: start, endS: end, seconds: end - start }
}

/**
 * Pure (tested). The cut used for the five catalogue titles (docs/titles.md "How a segment is cut"): first video and audio
 * stream, H.264 CRF 18, AAC 192k, faststart. Input seek (-ss before -i) is fast and also works on an https URL.
 * https://ffmpeg.org/ffmpeg.html#Main-options
 */
export function cutArgs(input: string, out: string, span?: { startS: number; endS: number }): string[] {
  const range = span ? { pre: ['-ss', String(span.startS)], post: ['-t', String(span.endS - span.startS)] } : { pre: [], post: [] }
  return ['-y', ...whitelist(input), ...range.pre, '-i', input, ...range.post, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]
}

/**
 * Pure (tested). Prisma upsert of the Title by slug. New: a draft with its source Asset, licence "All rights reserved" and the
 * credit "<Title>. Described by Described." unless given. --replace: back to draft (out of the catalogue while its files are
 * rewritten; persistForCli publishes it again), the source Asset swapped, and only the licence, credit, year and synopsis that
 * were given — the title's own are kept.
 */
export function titleUpsertArgs(o: OwnOptions, s3Key: string, region: string) {
  const spoken = { name: o.title, language: o.language, voice: o.voice }
  const given = { ...(o.license ? { license: o.license } : {}), ...(o.credit ? { attribution: o.credit } : {}), ...(o.year !== undefined ? { year: o.year } : {}), ...(o.synopsis !== undefined ? { synopsis: o.synopsis } : {}) }
  const asset = { kind: 'source' as const, s3Key, region }
  return {
    where: { slug: o.slug },
    create: { slug: o.slug, ...spoken, license: 'All rights reserved', attribution: creditSentence(o.title), year: null as number | null, synopsis: null as string | null, ...given, assets: { create: asset } },
    update: { ...spoken, ...given, status: 'draft' as const, assets: { deleteMany: { kind: 'source' as const }, create: asset } },
  }
}

export interface OwnDeps {
  env: Record<string, string | undefined>
  log: (line: string) => void
  /** ffprobe of the local file or URL (reads headers only; no AWS call). */
  probe: (input: string) => Promise<{ durationS: number; hasVideo: boolean; hasAudio: boolean }>
  /** Whether a Title row has this slug, and the slug of another title whose Asset already has this source key. */
  slugInDb: (slug: string, sourceKey: string) => Promise<{ title: boolean; keyOwner: string | null }>
  /** S3 ListObjectsV2 under a prefix in S3_BUCKET_MEDIA (real runs only: a dry run makes no AWS call). */
  s3Keys: (prefix: string) => Promise<string[]>
  confirm: (question: string) => Promise<boolean>
  /** The file to upload: the input itself when it is a local .mp4 with no span, else the cutArgs output at `out`. */
  prepare: (input: string, out: string, span?: { startS: number; endS: number }) => Promise<string>
  upload: (file: string, uri: string) => Promise<void>
  register: (args: ReturnType<typeof titleUpsertArgs>) => Promise<void>
  /** runDescribe; `invalidate`: CloudFront invalidation of /published/<slug>/* after publish (10-publish PUBLISH_INVALIDATE). */
  describe: (input: DescribeInput, how: { invalidate: boolean }) => Promise<number>
  persist: (slug: string, work: string, spoken: Spoken) => Promise<void>
}

const usd = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`
export const REQUIRED_ENV = ['S3_BUCKET_MEDIA', 'CLOUDFRONT_DOMAIN', 'DATABASE_URL'] as const
const LONG_NOTE = `the describe prompt is not yet re-checked on a full-length title (DESC-024, TASKS.md)`

/** Lines of the estimate, printed before anything is spent. */
export function estimateLines(e: Estimate): string[] {
  return [
    `estimate for ${(e.seconds / 60).toFixed(1)} min of film (measured per-minute rates of the five catalogue titles, src/cost.ts):`,
    `  Transcribe          ${usd(e.transcribe)}  ($0.024 per min, billed per second)`,
    `  Qwen3-VL (describe) ${usd(e.describe)}`,
    `  Nova Lite (edit)    ${usd(e.nova)}`,
    `  Polly (voice)       ${usd(e.polly)}`,
    `  total               ≈ ${usd(e.total)}  (range ${usd(e.low)}–${usd(e.high)}; list prices, not an AWS bill; S3 and CloudFront not included)`,
  ]
}

/**
 * The one command. Order: probe (no AWS) → settings, length and slug checks → estimate → confirm (unless --yes) → only then spend:
 * cut/upload to s3://$S3_BUCKET_MEDIA/sources/<slug>.mp4, the draft Title row, every pipeline step, the rows and status = published.
 * --dry-run stops after the estimate: no upload, no row, no AWS call (so the S3 half of the slug check is skipped, and says so).
 * A slug is free when no Title row has it (or --replace), no other title's Asset has its source key, and — when no Title row has
 * it — nothing is in S3 at sources/<slug>.mp4 or under published/<slug>/. --replace invalidates /published/<slug>/* after publish:
 * segments keep their names and are cached for a year as immutable (../s3 cacheControl), so without it CloudFront would serve
 * the old segments under the new playlists.
 */
export async function runOwn(o: OwnOptions, d: OwnDeps) {
  const p = await d.probe(o.input)
  if (!p.hasVideo || !p.hasAudio) throw new Error(`${o.input} needs a video and an audio stream (has video: ${p.hasVideo}, audio: ${p.hasAudio})`)
  const span = clipSeconds(p.durationS, o.startS, o.endS)
  const cut = o.startS !== undefined || o.endS !== undefined ? { startS: span.startS, endS: span.endS } : undefined
  const tooLong = span.seconds > LONG_FILM_S && !o.long
  if (tooLong && !o.dryRun) throw new Error(`${clock(span.seconds)} of film is over ${LONG_FILM_S / 60} min: ${LONG_NOTE}. Add --long to run it anyway, or describe a part with --start/--end. Nothing was spent.`)
  const missing = REQUIRED_ENV.filter((k) => !d.env[k])
  if (missing.length && !o.dryRun) throw new Error(`set ${missing.join(', ')} first (README "Run it locally"); nothing was spent`)
  if (o.replace && !o.dryRun && !d.env.CLOUDFRONT_DISTRIBUTION_ID) throw new Error('--replace needs CLOUDFRONT_DISTRIBUTION_ID: the old segments are cached for a year and must be invalidated. Nothing was spent.')

  const key = `sources/${o.slug}.mp4`
  const db = d.env.DATABASE_URL ? await d.slugInDb(o.slug, key) : undefined
  const refuse = (why: string) => { if (!o.dryRun) throw new Error(`${why}. Nothing was spent.`); return why }
  const problems: string[] = []
  if (db?.keyOwner) problems.push(refuse(`${key} is already the source of the title "${db.keyOwner}"; choose another --slug`))
  if (db?.title && !o.replace) problems.push(refuse(`a title with slug "${o.slug}" exists; pass --replace to describe it again, or choose another --slug`))
  if (!o.dryRun && !db?.title) {
    const found = [...(await d.s3Keys(`published/${o.slug}/`)).slice(0, 1), ...(await d.s3Keys(key)).filter((k) => k === key)]
    if (found.length) refuse(`${found.join(', ')} already in S3 with no Title row for "${o.slug}"; choose another --slug`)
  }

  const estimate = estimateUsd(span.seconds)
  const work = `work/${o.slug}`
  const source = `s3://${d.env.S3_BUCKET_MEDIA ?? '$S3_BUCKET_MEDIA'}/${key}`
  const invalidate = o.replace
  d.log(`"${o.title}" → ${o.slug} (${o.language}, ${o.voice}), describing ${clock(span.startS)}–${clock(span.endS)} of ${clock(p.durationS)}`)
  for (const l of estimateLines(estimate)) d.log(l)
  if (span.seconds > LONG_FILM_S) d.log(`note: ${LONG_NOTE}${tooLong ? '; a real run needs --long' : ''}`)
  const result = { estimate, seconds: span.seconds, slug: o.slug }
  if (o.dryRun) {
    d.log(`would upload ${cut ? 'the cut' : 'the file'} to ${source}, ${o.replace ? 'set the Title row back to draft' : 'create the Title row (draft)'}, run every pipeline step (probe … publish)${invalidate ? ', invalidate /published/' + o.slug + '/* in CloudFront' : ''}, then list it in the catalogue (status published)`)
    for (const why of problems) d.log(`a real run would stop: ${why}`)
    if (missing.length) d.log(`a real run needs ${missing.join(', ')} set`)
    if (o.replace && !d.env.CLOUDFRONT_DISTRIBUTION_ID) d.log('a real run with --replace needs CLOUDFRONT_DISTRIBUTION_ID set')
    d.log(`S3 not checked for objects left under published/${o.slug}/ (a real run checks before it asks).`)
    d.log('dry run: nothing uploaded, no row written, no AWS call made.')
    return { ...result, ran: false as const }
  }
  if (!o.yes && !(await d.confirm(`Spend about ${usd(estimate.total)} on AWS to describe "${o.title}"? [y/N] `))) {
    d.log('stopped: nothing was spent.')
    return { ...result, ran: false as const }
  }
  const file = await d.prepare(o.input, `${work}/upload.mp4`, cut)
  await d.upload(file, source)
  await d.register(titleUpsertArgs(o, key, d.env.AWS_REGION ?? 'eu-central-1'))
  const draft = o.replace ? 'The title is a draft, out of the catalogue, until a run finishes.' : 'The title stays a draft until a run finishes.'
  const resume = (from: string) => `  ${invalidate ? 'PUBLISH_INVALIDATE=1 ' : ''}pnpm pipeline describe --title ${o.slug} --source ${source} --lang ${o.language} --voice ${o.voice} --from ${from}`
  let costUsd: number
  try {
    costUsd = await d.describe({ slug: o.slug, source, language: o.language, voice: o.voice }, { invalidate })
  } catch (e) {
    const spent = (e as { costUsd?: number }).costUsd
    throw new Error(`${(e as Error).message}\n${spent !== undefined ? `spent ${usd(spent)} before it stopped. ` : ''}${draft} Resume with:\n${resume('<step>')}`, { cause: e })
  }
  try {
    await d.persist(o.slug, work, { language: o.language, voice: o.voice })
  } catch (e) {
    throw new Error(`${(e as Error).message}\nevery step ran and was published to S3 (measured cost ${usd(costUsd)}), but the rows were not written. ${draft} Write them again (validate and an S3 re-upload, no paid AWS call):\n${resume('validate')}`, { cause: e })
  }
  const hlsUrl = `https://${d.env.CLOUDFRONT_DOMAIN}/published/${o.slug}/master.m3u8`
  d.log(`measured cost: ${usd(costUsd)} (estimate was ${usd(estimate.total)})`)
  d.log(`HLS: ${hlsUrl}`)
  return { ...result, ran: true as const, costUsd, hlsUrl }
}
