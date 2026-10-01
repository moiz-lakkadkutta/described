import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleJob, JOB_STEPS, persist, QUEUE_OPTIONS, queueName, registerPipeline, type Db, type JobStep } from '../src/jobs'
import { meter } from '../src/cost'
import type { Ctx } from '../src/steps'

/** In-memory stand-ins for Prisma and pg-boss: no Postgres, no AWS. */
function fakes() {
  const jobs = new Map<string, Record<string, unknown>>()
  const title: Record<string, unknown> = { id: 't1', slug: 'sintel', language: 'en', voice: 'Joanna', status: 'draft', assets: [{ s3Key: 'sources/sintel.mp4' }] }
  let shots: Array<Record<string, unknown>> = [], gaps: Array<Record<string, unknown>> = []
  const inc = (row: Record<string, unknown>, data: Record<string, unknown>) => { for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === 'object' && 'increment' in v ? Number(row[k] ?? 0) + (v as { increment: number }).increment : v }
  const db = {
    title: { findUniqueOrThrow: vi.fn(async () => title), update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(title, data)) },
    job: {
      upsert: vi.fn(async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => { const r = jobs.get(where.id); if (r) inc(r, update); else jobs.set(where.id, { costUsd: 0, ...create }) }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => inc(jobs.get(where.id)!, data)),
    },
    shot: {
      deleteMany: vi.fn(async () => { shots = [] }), createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => { shots.push(...data) }),
      upsert: vi.fn(async ({ where, create, update }: { where: { titleId_index: { index: number } }; create: Record<string, unknown>; update: Record<string, unknown> }) => { const r = shots.find((s) => s.index === where.titleId_index.index); if (r) Object.assign(r, update); else shots.push(create) }),
    },
    gap: { deleteMany: vi.fn(async () => { gaps = [] }), createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => { gaps.push(...data) }) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  const boss = { createQueue: vi.fn(async () => {}), send: vi.fn(async () => 'next-id'), work: vi.fn(async () => 'worker-id') }
  return { db: db as unknown as Db, raw: db, boss, jobs, title, shots: () => shots, gaps: () => gaps }
}
const job = (id: string, retryCount = 0, retryLimit = 2) => ({ id, data: { titleId: 't1' }, retryCount, retryLimit })

describe('pipeline jobs', () => {
  it('creates one queue per step with a retry policy, and one worker each', async () => {
    const f = fakes()
    await registerPipeline({ boss: f.boss as never, db: f.db })
    expect(f.boss.createQueue.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['pipeline-probe', 'pipeline-shots', 'pipeline-speech', 'pipeline-describe', 'pipeline-fit', 'pipeline-finish'])
    for (const s of JOB_STEPS) expect(QUEUE_OPTIONS[s]).toMatchObject({ policy: 'short', retryBackoff: true, retryLimit: expect.any(Number), retryDelay: expect.any(Number) })
    expect(f.boss.work).toHaveBeenCalledTimes(JOB_STEPS.length)
    expect(f.boss.work.mock.calls[0]).toEqual(['pipeline-probe', { includeMetadata: true }, expect.any(Function)])
  })
  it('enqueues the next step by titleId and records a Job row with cost per step', async () => {
    const f = fakes()
    const ran: Array<[JobStep, string]> = []
    const run = vi.fn(async (s: JobStep, ctx: Ctx) => { ran.push([s, ctx.work]); meter()!.add(0.01) })
    for (const [i, s] of JOB_STEPS.entries()) {
      if (s === 'probe' || s === 'shots' || s === 'speech' || s === 'describe') continue // these persist files: covered below
      await handleJob(s, job(`j${i}`), { boss: f.boss as never, db: f.db, run })
    }
    expect(ran).toEqual([['fit', 'work/sintel'], ['finish', 'work/sintel']])
    expect(f.boss.send).toHaveBeenCalledWith('pipeline-finish', { titleId: 't1' }, { singletonKey: 't1' })
    expect(f.boss.send).toHaveBeenCalledTimes(1) // nothing after finish
    expect(f.jobs.get('j4')).toMatchObject({ titleId: 't1', step: 'fit', status: 'done', costUsd: 0.01, startedAt: expect.any(Date), finishedAt: expect.any(Date) })
    expect(f.title.status).toBe('published')
  })
  it('persists Shot and Gap rows after their steps and overwrites them on a re-run', async () => {
    const f = fakes()
    const work = await mkdtemp(join(tmpdir(), 'jobs-'))
    await writeFile(join(work, 'probe.json'), JSON.stringify({ format: { duration: '60.5' } }))
    await writeFile(join(work, 'shots.json'), JSON.stringify([{ index: 0, startMs: 0, endMs: 4000 }, { index: 1, startMs: 4000, endMs: 9000 }]))
    await writeFile(join(work, 'gaps.json'), JSON.stringify([{ startMs: 0, endMs: 3000 }]))
    await writeFile(join(work, 'described.json'), JSON.stringify([{ index: 0, startMs: 0, endMs: 4000, description: 'Snow falls.', sameAsPrev: false, tokens: 2500, outputTokens: 4 }, { index: 1, startMs: 4000, endMs: 9000, description: '', sameAsPrev: true, tokens: 2400, outputTokens: 1 }]))
    for (const s of ['probe', 'shots', 'speech', 'describe', 'shots', 'speech', 'describe'] as const) await persist(s, 't1', work, f.db)
    expect(f.title.durationS).toBe(60.5)
    expect(f.gaps()).toEqual([{ titleId: 't1', startMs: 0, endMs: 3000 }])
    expect(f.shots()).toEqual([
      { titleId: 't1', index: 0, startMs: 0, endMs: 4000, description: 'Snow falls.', sameAsPrev: false, novaTokens: 2500 },
      { titleId: 't1', index: 1, startMs: 4000, endMs: 9000, description: '', sameAsPrev: true, novaTokens: 2400 },
    ])
    await persist('fit', 't1', work, f.db) // fit owns no rows yet
    expect(f.raw.$transaction).toHaveBeenCalledTimes(6)
  })
  it('chains every step to the next by titleId, with the files each step writes', async () => {
    const f = fakes()
    const files: Partial<Record<JobStep, [string, unknown]>> = {
      probe: ['probe.json', { format: { duration: '1' } }], shots: ['shots.json', [{ index: 0, startMs: 0, endMs: 1000 }]],
      speech: ['gaps.json', []], describe: ['described.json', [{ index: 0, startMs: 0, endMs: 1000, description: 'Snow.', sameAsPrev: false, tokens: 1, outputTokens: 1 }]],
    }
    const run = vi.fn(async (s: JobStep, ctx: Ctx) => { await mkdir(ctx.work, { recursive: true }); const x = files[s]; if (x) await writeFile(`${ctx.work}/${x[0]}`, JSON.stringify(x[1])) })
    const cwd = process.cwd()
    process.chdir(await mkdtemp(join(tmpdir(), 'chain-')))
    try { for (const s of JOB_STEPS) await handleJob(s, job(s), { boss: f.boss as never, db: f.db, run }) } finally { process.chdir(cwd) }
    expect(f.boss.send.mock.calls.map((c) => (c as unknown[])[0])).toEqual(JOB_STEPS.slice(1).map(queueName))
    expect(f.shots()).toEqual([{ titleId: 't1', index: 0, startMs: 0, endMs: 1000, description: 'Snow.', sameAsPrev: false, novaTokens: 1 }])
    expect([...f.jobs.values()].map((j) => [j.step, j.status])).toEqual(JOB_STEPS.map((s) => [s, 'done']))
  })
  it('lets pg-boss retry: a failed attempt keeps the title processing, the last one marks it failed; cost adds up across attempts', async () => {
    const f = fakes()
    const run = vi.fn(async () => { meter()!.add(0.02); throw new Error('ThrottlingException') })
    const deps = { boss: f.boss as never, db: f.db, run }
    await expect(handleJob('describe', job('d1', 0, 1), deps)).rejects.toThrow('ThrottlingException')
    expect(f.jobs.get('d1')).toMatchObject({ status: 'retrying', error: expect.stringContaining('ThrottlingException') })
    expect(f.title.status).toBe('processing')
    await expect(handleJob('describe', job('d1', 1, 1), deps)).rejects.toThrow()
    expect(f.jobs.get('d1')).toMatchObject({ status: 'failed', costUsd: 0.04 })
    expect(f.title.status).toBe('failed')
    expect(f.boss.send).not.toHaveBeenCalled()
  })
  it('names queues pipeline-<step>', () => { expect(queueName('probe')).toBe('pipeline-probe') })
})
