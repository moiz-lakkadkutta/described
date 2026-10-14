import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { transcribeUsd } from '../cost'
import { cutArgs, isHttps, parseClock } from '../own'
import { SLUG_RE, type Step } from '../steps'
import { assertCap, assertNew, evalCtx, runEvalSteps, runSettings, writeManifest, type EvalDeps, type EvalResult } from './run'

/**
 * DESC-030 `gate-c prepare`: a NEW segment for evaluation — cut [start, end) from a film (https URL, s3:// URI or local file) with
 * the catalogue's cut (own.ts cutArgs), put it at s3://$S3_BUCKET_MEDIA/work/<slug>/source.mp4 (the prefix 03-speech already writes
 * the mezzanine to; not sources/, so it never looks like a catalogue title), and run probe → shots → speech into work/<slug> under
 * the meter with a hard cap. No Title row, no DB, no publish. The result is a source for `gate-c run`.
 * Transcribe StartTranscriptionJob (03-speech) — https://docs.aws.amazon.com/transcribe/latest/APIReference/API_StartTranscriptionJob.html
 * S3 PutObject / GetObject (../s3) — https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html · https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
 */
export const PREPARE_STEPS = ['probe', 'shots', 'speech'] as const satisfies readonly Step[]
export const DEFAULT_PREPARE_CAP_USD = 0.1
/** A Gate C segment is minutes, not a film: keeps a typo in --end from transcribing an hour. */
export const MAX_PREPARE_S = 10 * 60

export interface PrepareDeps extends EvalDeps {
  env: Record<string, string | undefined>
  cut: (input: string, out: string, span: { startS: number; endS: number }) => Promise<void>
  download: (s3Uri: string, file: string) => Promise<void>
  upload: (file: string, s3Uri: string) => Promise<void>
}
export interface PrepareOptions { workRoot: string; input: string; slug: string; start: string; end: string; cap: number; dryRun?: boolean; language: 'en' | 'de'; voice: string }

/** Pure (tested): validates the request and prices it before anything runs. Transcribe is the only metered call (S3 is not metered). */
export function preparePlan(o: Omit<PrepareOptions, 'workRoot' | 'dryRun' | 'voice' | 'language'>) {
  if (!SLUG_RE.test(o.slug)) throw new Error(`invalid slug "${o.slug}": must match ${SLUG_RE.source}`)
  assertCap(o.cap)
  const startS = parseClock(o.start), endS = parseClock(o.end)
  if (!(endS > startS)) throw new Error(`--end (${o.end}) must be after --start (${o.start})`)
  const seconds = endS - startS
  if (seconds > MAX_PREPARE_S) throw new Error(`${seconds} s is over ${MAX_PREPARE_S / 60} min; an evaluation segment is a few minutes`)
  const kind = o.input.startsWith('s3://') ? 's3' as const : isHttps(o.input) ? 'https' as const : 'file' as const
  const estimateUsd = transcribeUsd(seconds)
  if (estimateUsd > o.cap) throw new Error(`Transcribe for ${seconds} s costs about $${estimateUsd.toFixed(4)}, over the cap $${o.cap.toFixed(2)}; it is billed when the job ends, so the cap is checked first. Nothing was spent.`)
  return { startS, endS, seconds, kind, estimateUsd }
}

export async function prepareGateC(o: PrepareOptions, deps: PrepareDeps): Promise<EvalResult> {
  const p = preparePlan(o)
  const work = join(o.workRoot, o.slug)
  await assertNew(work)
  if (p.kind === 'file' && !existsSync(o.input)) throw new Error(`no such file: ${o.input}`)
  const bucket = deps.env.S3_BUCKET_MEDIA
  if (!bucket && !o.dryRun) throw new Error('set S3_BUCKET_MEDIA first (03-speech hands the mezzanine to Transcribe through S3); nothing was spent')
  const source = `s3://${bucket ?? '$S3_BUCKET_MEDIA'}/work/${o.slug}/source.mp4`
  deps.log(`cut ${o.start}–${o.end} (${p.seconds} s) of ${o.input}${p.kind === 's3' ? ' (downloaded first)' : ''} → ${source}`)
  deps.log(`run ${PREPARE_STEPS.join(' → ')} into ${work}; Transcribe ≈ $${p.estimateUsd.toFixed(4)}; hard cap $${o.cap.toFixed(2)}; no publish, no DB writes`)
  deps.log(`then: pnpm gate-c run ${o.slug} ${o.slug}-<run> --dry-run`)
  if (o.dryRun) { deps.log('dry run: nothing cut or uploaded, no AWS call, $0.00'); return { steps: [], totalUsd: 0 } }
  const settings = runSettings(PREPARE_STEPS, o.language, o.voice)
  const record = { input: o.input, start: o.start, end: o.end, startS: p.startS, endS: p.endS, source, steps: PREPARE_STEPS, capUsd: o.cap, estimateUsd: p.estimateUsd }
  await mkdir(work, { recursive: false })
  try {
    let input = o.input
    if (p.kind === 's3') { input = join(work, 'download.mp4'); await deps.download(o.input, input) }
    const cut = join(work, 'cut.mp4')
    await deps.cut(input, cut, { startS: p.startS, endS: p.endS })
    await deps.upload(cut, source)
    for (const f of ['download.mp4', 'cut.mp4']) await rm(join(work, f), { force: true }) // probe downloads the uploaded cut as source.mp4
  } catch (e) {
    await rm(work, { recursive: true, force: true })
    throw e
  }
  try {
    const r = await runEvalSteps({ steps: PREPARE_STEPS, cap: o.cap }, evalCtx(o.workRoot, o.slug, o.language, o.voice, source), deps)
    await writeManifest(work, record, settings, r)
    return r
  } catch (e) {
    await writeManifest(work, record, settings, { steps: (e as { steps?: EvalResult['steps'] }).steps, totalUsd: (e as { spentUsd?: number; costUsd?: number }).spentUsd ?? (e as { costUsd?: number }).costUsd, error: (e as Error).message })
    throw e
  }
}

