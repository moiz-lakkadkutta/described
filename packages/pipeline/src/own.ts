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
       [--dry-run] [--yes] [--replace]`

export interface OwnOptions {
  input: string; title: string; slug: string; startS?: number; endS?: number; language: 'en' | 'de'; voice: string
  license: string; credit: string; year?: number; synopsis?: string; dryRun: boolean; yes: boolean; replace: boolean
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
      'dry-run': { type: 'boolean' }, yes: { type: 'boolean' }, replace: { type: 'boolean' },
    },
  })
  if (positionals.length === 0) throw new Error(USAGE)
  if (positionals.length > 1) throw new Error(`one input only, got ${positionals.length}\n${USAGE}`)
  const input = positionals[0]!
  if (/^[a-z]+:\/\//i.test(input) && !/^https:\/\//i.test(input)) throw new Error(`input must be a local file or an https:// URL: ${input}`)
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
  const year = v.year === undefined ? undefined : Number(v.year)
  if (year !== undefined && !Number.isInteger(year)) throw new Error(`--year must be a whole number: ${v.year}`)
  const credit = (v.credit?.trim() || `${title}.`).replace(/\s*$/, '')
  return {
    input, title, slug, startS, endS, language, voice, license: v.license?.trim() || 'All rights reserved',
    credit: credit.endsWith(SENTENCE) ? credit : `${credit} ${SENTENCE}`, year, synopsis: v.synopsis, dryRun: !!v['dry-run'], yes: !!v.yes, replace: !!v.replace,
  }
}

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
  return ['-y', ...range.pre, '-i', input, ...range.post, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]
}

/** Pure (tested). Prisma upsert of the Title by slug: a draft with its source Asset; on --replace, metadata and the source Asset are replaced. */
export function titleUpsertArgs(o: OwnOptions, s3Key: string, region: string) {
  const meta = { name: o.title, year: o.year ?? null, license: o.license, attribution: o.credit, synopsis: o.synopsis ?? null, language: o.language, voice: o.voice }
  const asset = { kind: 'source' as const, s3Key, region }
  return { where: { slug: o.slug }, create: { slug: o.slug, ...meta, assets: { create: asset } }, update: { ...meta, assets: { deleteMany: { kind: 'source' as const }, create: asset } } }
}

export interface OwnDeps {
  env: Record<string, string | undefined>
  log: (line: string) => void
  /** ffprobe of the local file or URL (reads headers only; no AWS call). */
  probe: (input: string) => Promise<{ durationS: number; hasVideo: boolean; hasAudio: boolean }>
  titleExists: (slug: string) => Promise<boolean>
  confirm: (question: string) => Promise<boolean>
  /** The file to upload: the input itself when it is a local .mp4 with no span, else the cutArgs output at `out`. */
  prepare: (input: string, out: string, span?: { startS: number; endS: number }) => Promise<string>
  upload: (file: string, uri: string) => Promise<void>
  register: (args: ReturnType<typeof titleUpsertArgs>) => Promise<void>
  describe: (input: DescribeInput) => Promise<number>
  persist: (slug: string, work: string, spoken: Spoken) => Promise<void>
}

const usd = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`
export const REQUIRED_ENV = ['S3_BUCKET_MEDIA', 'CLOUDFRONT_DOMAIN', 'DATABASE_URL'] as const

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
 * The one command. Order: probe (no AWS) → settings and slug checks → estimate → confirm (unless --yes) → only then spend:
 * cut/upload to s3://$S3_BUCKET_MEDIA/sources/<slug>.mp4, the draft Title row, every pipeline step, the rows and status = published.
 * --dry-run stops after the estimate: no upload, no row, no AWS call.
 */
export async function runOwn(o: OwnOptions, d: OwnDeps) {
  const p = await d.probe(o.input)
  if (!p.hasVideo || !p.hasAudio) throw new Error(`${o.input} needs a video and an audio stream (has video: ${p.hasVideo}, audio: ${p.hasAudio})`)
  const span = clipSeconds(p.durationS, o.startS, o.endS)
  const cut = o.startS !== undefined || o.endS !== undefined ? { startS: span.startS, endS: span.endS } : undefined
  const missing = REQUIRED_ENV.filter((k) => !d.env[k])
  if (missing.length && !o.dryRun) throw new Error(`set ${missing.join(', ')} first (README "Run it locally"); nothing was spent`)
  const exists = d.env.DATABASE_URL ? await d.titleExists(o.slug) : undefined
  if (exists && !o.replace && !o.dryRun) throw new Error(`a title with slug "${o.slug}" exists; pass --replace to describe it again, or choose another --slug`)

  const estimate = estimateUsd(span.seconds)
  const work = `work/${o.slug}`
  const key = `sources/${o.slug}.mp4`
  const source = `s3://${d.env.S3_BUCKET_MEDIA ?? '$S3_BUCKET_MEDIA'}/${key}`
  d.log(`"${o.title}" → ${o.slug} (${o.language}, ${o.voice}), describing ${clock(span.startS)}–${clock(span.endS)} of ${clock(p.durationS)}`)
  for (const l of estimateLines(estimate)) d.log(l)
  const result = { estimate, seconds: span.seconds, slug: o.slug }
  if (o.dryRun) {
    d.log(`would upload ${cut ? 'the cut' : 'the file'} to ${source}, create the Title row (draft), run every pipeline step (probe … publish), then list it in the catalogue (status published)`)
    if (exists) d.log(`slug "${o.slug}" already exists: a real run needs --replace`)
    if (missing.length) d.log(`a real run needs ${missing.join(', ')} set`)
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
  let costUsd: number
  try {
    costUsd = await d.describe({ slug: o.slug, source, language: o.language, voice: o.voice })
  } catch (e) {
    const spent = (e as { costUsd?: number }).costUsd
    throw new Error(`${(e as Error).message}\n${spent !== undefined ? `spent ${usd(spent)} before it stopped. ` : ''}The title stays a draft. Resume with:\n  pnpm pipeline describe --title ${o.slug} --source ${source} --lang ${o.language} --voice ${o.voice} --from <step>`, { cause: e })
  }
  await d.persist(o.slug, work, { language: o.language, voice: o.voice })
  const hlsUrl = `https://${d.env.CLOUDFRONT_DOMAIN}/published/${o.slug}/master.m3u8`
  d.log(`measured cost: ${usd(costUsd)} (estimate was ${usd(estimate.total)})`)
  d.log(`HLS: ${hlsUrl}`)
  return { ...result, ran: true as const, costUsd, hlsUrl }
}
