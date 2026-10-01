import type PgBoss from 'pg-boss'
import type { PrismaClient } from '@prisma/client'
import { readFile } from 'node:fs/promises'
import { metered } from './cost'
import { ctxFor, ORDER, runStep, type Ctx } from './steps'
import type { Shot } from './steps/02-shots'
import type { Gap } from './steps/03-speech'
import type { Described } from './steps/04-describe'

/** One pg-boss job per step 1–5; `finish` runs steps 6–10 unchanged (they become their own jobs in DESC-004). */
export const JOB_STEPS = ['probe', 'shots', 'speech', 'describe', 'fit', 'finish'] as const
export type JobStep = typeof JOB_STEPS[number]
/** Queue names: letters, digits, `-` and `_` only. apps/api/src/routes/admin.ts sends the first one by name. */
export const queueName = (s: JobStep) => `pipeline-${s}`

/**
 * Queue options, set once by createQueue; jobs sent without their own retry/expiry options inherit them.
 * Retry: retryLimit retries, retryDelay seconds, retryBackoff doubles the delay — https://github.com/timgit/pg-boss/blob/10.1.6/docs/api/jobs.md
 * Policy `short`: one queued job per singletonKey (the titleId), so a double click doesn't run a title twice — https://github.com/timgit/pg-boss/blob/10.1.6/docs/api/queues.md
 * Expiry is the longest a single attempt may run (pg-boss default 15 min): Transcribe polls, describe makes one call per shot.
 */
export const QUEUE_OPTIONS: Record<JobStep, Omit<PgBoss.Queue, 'name'>> = {
  probe: { policy: 'short', retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 60 * 60 },
  shots: { policy: 'short', retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 60 * 60 },
  speech: { policy: 'short', retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 2 * 60 * 60 },
  describe: { policy: 'short', retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 2 * 60 * 60 }, // re-runs hit the per-shot cache
  fit: { policy: 'short', retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 30 * 60 },
  finish: { policy: 'short', retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 2 * 60 * 60 },
}

export interface StepJob { id: string; data: { titleId: string }; retryCount: number; retryLimit: number }
export type Boss = Pick<PgBoss, 'createQueue' | 'send' | 'work'>
export type Db = Pick<PrismaClient, 'title' | 'job' | 'shot' | 'gap' | '$transaction'>
export interface Deps { boss: Boss; db: Db; run?: (step: JobStep, ctx: Ctx) => Promise<void> }

/** Steps 6–10 in order, unchanged. */
const STEPS_6_10 = ORDER.slice(ORDER.indexOf('voice'))
export const runJobStep = async (step: JobStep, ctx: Ctx) => { if (step !== 'finish') return runStep(step, ctx); for (const s of STEPS_6_10) await runStep(s, ctx) }

/** Creates the queues (idempotent) and one worker per step. */
export async function registerPipeline(deps: Deps) {
  for (const s of JOB_STEPS) await deps.boss.createQueue(queueName(s), { name: queueName(s), ...QUEUE_OPTIONS[s] })
  for (const s of JOB_STEPS) await deps.boss.work<{ titleId: string }>(queueName(s), { includeMetadata: true }, async ([job]) => handleJob(s, job!, deps))
}

/**
 * One attempt of one step for one title. The Job row's id is the pg-boss job id, so retries update the same row and add to its
 * cost. Success persists the step's rows and enqueues the next step; the last failed attempt marks the title failed.
 * Throwing hands the job back to pg-boss for its retry policy.
 */
export async function handleJob(step: JobStep, job: StepJob, { boss, db, run = runJobStep }: Deps) {
  const { titleId } = job.data
  const t = await db.title.findUniqueOrThrow({ where: { id: titleId }, include: { assets: { where: { kind: 'source' } } } })
  const ctx = ctxFor({ slug: t.slug, source: `s3://${process.env.S3_BUCKET_MEDIA}/${t.assets[0]!.s3Key}`, language: t.language as 'en' | 'de', voice: t.voice })
  const startedAt = new Date()
  await db.job.upsert({ where: { id: job.id }, create: { id: job.id, titleId, step, status: 'running', startedAt }, update: { status: 'running', startedAt, finishedAt: null, error: null } })
  await db.title.update({ where: { id: titleId }, data: { status: 'processing' } })
  try {
    const { costUsd } = await metered(async () => { await run(step, ctx); await persist(step, titleId, ctx.work, db) })
    await db.job.update({ where: { id: job.id }, data: { status: 'done', finishedAt: new Date(), costUsd: { increment: costUsd } } })
    const next = JOB_STEPS[JOB_STEPS.indexOf(step) + 1]
    if (next) await boss.send(queueName(next), { titleId }, { singletonKey: titleId })
    else await db.title.update({ where: { id: titleId }, data: { status: 'published' } }) // Rendition/TextTrack rows: DESC-004
  } catch (e) {
    const final = job.retryCount >= job.retryLimit
    const costUsd = (e as { costUsd?: number }).costUsd ?? 0
    await db.job.update({ where: { id: job.id }, data: { status: final ? 'failed' : 'retrying', finishedAt: new Date(), error: String((e as Error)?.stack ?? e).slice(0, 4000), costUsd: { increment: costUsd } } })
    if (final) await db.title.update({ where: { id: titleId }, data: { status: 'failed' } })
    throw e
  }
}

const json = async <T>(work: string, f: string) => JSON.parse(await readFile(`${work}/${f}`, 'utf8')) as T

/** Rows each step owns, replaced wholesale so a re-run overwrites them (Title.durationS, Shot, Gap; describe fills Shot text). */
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
  }
}
