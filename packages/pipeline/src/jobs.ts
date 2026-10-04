import type PgBoss from 'pg-boss'
import type { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { metered } from './cost'
import { writeDescriptionCues } from './cues'
import { ctxFor, runStep, SLUG_RE, STEPS, type Ctx } from './steps'
import type { Shot } from './steps/02-shots'
import type { Gap } from './steps/03-speech'
import type { Described } from './steps/04-describe'
import type { PackageReport } from './steps/09-package'
import type { ManifestProblems } from './validate'

/** One pg-boss job per step 1–5; `finish` runs steps 6–10 (voice … package, validate, publish) in one job (open question Q4 / decision pending). */
export const JOB_STEPS = ['probe', 'shots', 'speech', 'describe', 'fit', 'finish'] as const
export type JobStep = typeof JOB_STEPS[number]
/** Queue names: letters, digits, `-` and `_` only. apps/api/src/routes/admin.ts sends the first one by name. */
export const queueName = (s: JobStep) => `pipeline-${s}`

/** Dead-letter queue: pg-boss copies a step's payload here once its retries are spent, including attempts that expired or whose worker died. */
export const FAILED_QUEUE = 'pipeline-failed'

/**
 * Queue options (createQueue, then updateQueue so edits here reach existing queues); jobs sent without their own options inherit them.
 * Retry: retryLimit retries, retryDelay seconds, retryBackoff doubles the delay — https://github.com/timgit/pg-boss/blob/10.1.6/docs/api/jobs.md
 * Policy `short`: one queued job per singletonKey (the titleId) — https://github.com/timgit/pg-boss/blob/10.1.6/docs/api/queues.md
 * It does not see a running job; the admin route refuses a title that is already processing.
 * expireInSeconds bounds one attempt (pg-boss default 15 min); handleJob gives up STEP_MARGIN_S earlier so it records the failure itself.
 */
const RETRY = { policy: 'short', retryBackoff: true, deadLetter: FAILED_QUEUE } as const
export const QUEUE_OPTIONS: Record<JobStep, Omit<PgBoss.Queue, 'name'> & { expireInSeconds: number }> = {
  probe: { ...RETRY, retryLimit: 2, retryDelay: 30, expireInSeconds: 60 * 60 },
  shots: { ...RETRY, retryLimit: 2, retryDelay: 30, expireInSeconds: 60 * 60 },
  speech: { ...RETRY, retryLimit: 3, retryDelay: 60, expireInSeconds: 2 * 60 * 60 }, // a finished transcript is reused, see 03-speech
  describe: { ...RETRY, retryLimit: 3, retryDelay: 60, expireInSeconds: 2 * 60 * 60 }, // re-runs hit the per-shot cache
  fit: { ...RETRY, retryLimit: 3, retryDelay: 30, expireInSeconds: 30 * 60 },
  finish: { ...RETRY, retryLimit: 2, retryDelay: 60, expireInSeconds: 2 * 60 * 60 },
}
export const STEP_MARGIN_S = 60

/** Job data: the dead-letter copy keeps only this, so it names its own step and pg-boss job id (sent as the job's id). */
export interface StepData { titleId: string; step?: JobStep; jobId?: string }
export interface StepJob { id: string; data: StepData; retryCount: number; retryLimit: number }
/** Sends a step for a title with a fresh id that is also in its data. */
export const sendStep = (boss: Pick<Boss, 'send'>, step: JobStep, titleId: string) => { const id = randomUUID(); return boss.send(queueName(step), { titleId, step, jobId: id } satisfies StepData, { id, singletonKey: titleId }) }
export type Boss = Pick<PgBoss, 'createQueue' | 'updateQueue' | 'send' | 'work'>
export type Db = Pick<PrismaClient, 'title' | 'job' | 'shot' | 'gap' | 'descriptionCue' | 'rendition' | 'textTrack' | '$transaction'>
export interface Deps { boss: Boss; db: Db; run?: (step: JobStep, ctx: Ctx) => Promise<void>; timeoutMs?: number }

/** Steps 6–10 in order, with validate between package and publish. */
const STEPS_6_10 = STEPS.slice(STEPS.indexOf('voice'))
export const runJobStep = async (step: JobStep, ctx: Ctx) => { if (step !== 'finish') return runStep(step, ctx); for (const s of STEPS_6_10) await runStep(s, ctx) }

/** Creates (idempotent) and updates the queues, then one worker per step and one for the dead letters. */
export async function registerPipeline(deps: Deps) {
  await deps.boss.createQueue(FAILED_QUEUE, { name: FAILED_QUEUE, policy: 'standard', retryLimit: 5, retryDelay: 30, retryBackoff: true })
  for (const s of JOB_STEPS) {
    await deps.boss.createQueue(queueName(s), { name: queueName(s), ...QUEUE_OPTIONS[s] })
    await deps.boss.updateQueue(queueName(s), { name: queueName(s), ...QUEUE_OPTIONS[s] })
  }
  for (const s of JOB_STEPS) await deps.boss.work<StepData>(queueName(s), { includeMetadata: true }, async ([job]) => handleJob(s, job!, deps))
  await deps.boss.work<StepData>(FAILED_QUEUE, async ([job]) => handleDeadLetter(job!.data, deps.db))
}

/** Rejects when the signal aborts, so the handler returns before pg-boss expires the attempt; fn's own work stops at its next signal check. */
const untilAborted = <T>(fn: () => Promise<T>, signal: AbortSignal) => Promise.race([fn(), new Promise<never>((_, reject) => {
  if (signal.aborted) reject(signal.reason)
  signal.addEventListener('abort', () => reject(signal.reason), { once: true })
})])

/**
 * One attempt of one step for one title. The Job row's id is the pg-boss job id, so retries update the same row and add to its
 * cost. The step runs under a deadline STEP_MARGIN_S inside the queue's expiry; success persists the step's rows and enqueues the
 * next step, and an attempt that ran out of time does neither. The last failed attempt marks the title failed (anything that
 * escapes this — expiry, a dead worker — reaches handleDeadLetter). Throwing hands the job back to pg-boss for its retry policy.
 */
export async function handleJob(step: JobStep, job: StepJob, { boss, db, run = runJobStep, timeoutMs }: Deps) {
  const { titleId } = job.data
  const startedAt = new Date()
  await db.job.upsert({ where: { id: job.id }, create: { id: job.id, titleId, step, status: 'running', startedAt }, update: { status: 'running', startedAt, finishedAt: null, error: null } })
  const signal = AbortSignal.timeout(timeoutMs ?? (QUEUE_OPTIONS[step].expireInSeconds - STEP_MARGIN_S) * 1000)
  try {
    const t = await db.title.findUniqueOrThrow({ where: { id: titleId }, include: { assets: { where: { kind: 'source' } } } })
    if (!t.assets[0]) throw new Error(`title ${titleId} has no source asset`)
    if (!SLUG_RE.test(t.slug)) throw new Error(`title ${titleId}: invalid slug "${t.slug}" (work dir and S3 keys): must match ${SLUG_RE.source}`)
    await db.title.update({ where: { id: titleId }, data: { status: 'processing' } })
    const ctx: Ctx = { ...ctxFor({ slug: t.slug, source: `s3://${process.env.S3_BUCKET_MEDIA}/${t.assets[0].s3Key}`, language: t.language as 'en' | 'de', voice: t.voice }), signal }
    const { costUsd } = await metered(() => untilAborted(async () => { await run(step, ctx); signal.throwIfAborted(); await persist(step, titleId, ctx.work, db) }, signal), signal)
    signal.throwIfAborted()
    // Done first, then enqueue: if this update fails, the retry re-runs an idempotent step instead of starting a second chain.
    await db.job.update({ where: { id: job.id }, data: { status: 'done', finishedAt: new Date(), costUsd: { increment: costUsd } } })
    const next = JOB_STEPS[JOB_STEPS.indexOf(step) + 1]
    if (!next) { await db.title.update({ where: { id: titleId }, data: { status: 'published' } }); return }
    if (!(await sendStep(boss, next, titleId))) {
      const note = `${queueName(next)} not queued: a job for this title is already waiting there`
      console.warn(`pipeline: ${note} (title ${titleId})`)
      await db.job.update({ where: { id: job.id }, data: { error: note } })
    }
  } catch (e) {
    const final = job.retryCount >= job.retryLimit
    const costUsd = (e as { costUsd?: number }).costUsd ?? 0
    const error = signal.aborted ? `timed out after ${Math.round((Date.now() - startedAt.getTime()) / 1000)} s` : String((e as Error)?.stack ?? e)
    await db.job.update({ where: { id: job.id }, data: { status: final ? 'failed' : 'retrying', finishedAt: new Date(), error: error.slice(0, 4000), costUsd: { increment: costUsd } } })
    if (final) await db.title.update({ where: { id: titleId }, data: { status: 'failed' } })
    throw e
  }
}

/**
 * A step's retries are spent, possibly without handleJob seeing the end (expired, worker died). Closes that job's own row (if it
 * is still open) and fails the title — unless a newer job for the title has started since, e.g. a forced re-run.
 */
export async function handleDeadLetter({ titleId, jobId }: StepData, db: Db) {
  const row = jobId ? await db.job.findUnique({ where: { id: jobId } }) : null
  if (row && (row.status === 'running' || row.status === 'retrying')) await db.job.update({ where: { id: row.id }, data: { status: 'failed', finishedAt: new Date(), error: 'retries spent: the last attempt expired or its worker stopped (pg-boss dead letter)' } })
  const newer = await db.job.count({ where: { titleId, id: { not: jobId ?? '' }, startedAt: { gt: row?.startedAt ?? new Date() } } })
  if (newer === 0) await db.title.update({ where: { id: titleId }, data: { status: 'failed' } })
}

const json = async <T>(work: string, f: string) => JSON.parse(await readFile(`${work}/${f}`, 'utf8')) as T

/**
 * Rows each step owns, replaced wholesale so a re-run overwrites them (Title.durationS, Shot, Gap; describe fills Shot text;
 * finish writes DescriptionCue rows with their published clip keys, Rendition and TextTrack rows, and the art keys).
 * handleJob calls it only inside the deadline.
 */
export async function persist(step: JobStep, titleId: string, work: string, db: Db) {
  if (step === 'probe') {
    const p = await json<{ format: { duration: string } }>(work, 'probe.json')
    await db.title.update({ where: { id: titleId }, data: { durationS: parseFloat(p.format.duration) } })
  } else if (step === 'shots') {
    const shots = await json<Shot[]>(work, 'shots.json')
    await db.$transaction([db.shot.deleteMany({ where: { titleId } }), db.shot.createMany({ data: shots.map((s) => ({ titleId, index: s.index, startMs: s.startMs, endMs: s.endMs })) })])
  } else if (step === 'speech') {
    const gaps = await json<Gap[]>(work, 'gaps.json')
    await db.$transaction([db.gap.deleteMany({ where: { titleId } }), db.gap.createMany({ data: gaps.map((g) => ({ titleId, startMs: g.startMs, endMs: g.endMs })) })])
  } else if (step === 'describe') {
    const d = await json<Described[]>(work, 'described.json')
    await db.$transaction(d.map((s) => {
      const text = { description: s.description, sameAsPrev: s.sameAsPrev, novaTokens: s.tokens }
      return db.shot.upsert({ where: { titleId_index: { titleId, index: s.index } }, create: { titleId, index: s.index, startMs: s.startMs, endMs: s.endMs, ...text }, update: text })
    }))
  } else if (step === 'finish') {
    await writeDescriptionCues(db as never, titleId, work)
    await writeTrackRows(titleId, work, db)
  }
}

const exists = (f: string) => access(f).then(() => true, () => false)

/**
 * Rendition rows (Original, Audio description) and one TextTrack row per track 09-package advertised (package.json), with
 * validate's cue counts (validate.json); keys are where 10-publish put them. Poster/hero: work/art/*.jpg (01-probe) fill
 * Title.posterKey/heroKey only while they are null, so a key the admin set by hand is never overwritten.
 */
export async function writeTrackRows(titleId: string, work: string, db: Db) {
  const t = await db.title.findUniqueOrThrow({ where: { id: titleId } })
  const { language, tracks } = await json<PackageReport>(work, 'package.json')
  const { vttCues } = await json<ManifestProblems>(work, 'validate.json')
  const key = (f: string) => `published/${t.slug}/${f}`
  const kinds = (['captions', 'sdh', 'descriptions'] as const).filter((k) => tracks[k])
  await db.$transaction([
    db.rendition.deleteMany({ where: { titleId } }),
    db.rendition.createMany({ data: (['audio_main', 'audio_ad'] as const).map((kind) => ({ titleId, kind, language, s3Key: key(`${kind}.m3u8`) })) }),
    db.textTrack.deleteMany({ where: { titleId } }),
    db.textTrack.createMany({ data: kinds.map((kind) => ({ titleId, kind, language, s3Key: key(`${kind}.vtt`), cueCount: vttCues[`${kind}.vtt`] })) }),
  ])
  const art: { posterKey?: string; heroKey?: string } = {}
  if (t.posterKey == null && (await exists(`${work}/art/poster.jpg`))) art.posterKey = key('art/poster.jpg')
  if (t.heroKey == null && (await exists(`${work}/art/hero.jpg`))) art.heroKey = key('art/hero.jpg')
  if (Object.keys(art).length) await db.title.update({ where: { id: titleId }, data: art })
}

/**
 * SIGTERM/SIGINT: stop taking jobs and let running handlers finish (up to 30 s; anything still running is failed by pg-boss expiry
 * and retried), then close — https://github.com/timgit/pg-boss/blob/10.1.6/docs/api/ops.md (stop: graceful, timeout ms).
 */
export function stopOnSignals(boss: Pick<PgBoss, 'stop'>, close: () => Promise<void>, proc: Pick<NodeJS.Process, 'on' | 'exit'> = process) {
  let stopping = false
  for (const sig of ['SIGTERM', 'SIGINT'] as const) proc.on(sig, async () => {
    if (stopping) return
    stopping = true
    console.log(`${sig}: stopping pipeline workers`)
    try { await boss.stop({ graceful: true, timeout: 30_000 }); await close() } finally { proc.exit(0) }
  })
}
