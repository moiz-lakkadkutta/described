import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FAILED_QUEUE, handleDeadLetter, handleJob, JOB_STEPS, persist, QUEUE_OPTIONS, queueName, registerPipeline, type Db, type JobStep } from '../src/jobs'
import { meter } from '../src/cost'
import type { Ctx } from '../src/steps'

/** In-memory stand-ins for Prisma and pg-boss: no Postgres, no AWS. */
function fakes() {
  const jobs = new Map<string, Record<string, unknown>>()
  const title: Record<string, unknown> = { id: 't1', slug: 'sintel', language: 'en', voice: 'Joanna', status: 'draft', assets: [{ s3Key: 'sources/sintel.mp4' }] }
  let shots: Array<Record<string, unknown>> = [], gaps: Array<Record<string, unknown>> = [], cues: Array<Record<string, unknown>> = []
  const inc = (row: Record<string, unknown>, data: Record<string, unknown>) => { for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === 'object' && 'increment' in v ? Number(row[k] ?? 0) + (v as { increment: number }).increment : v }
  const db = {
    title: { findUniqueOrThrow: vi.fn(async () => title), update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(title, data)) },
    job: {
      upsert: vi.fn(async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => { const r = jobs.get(where.id); if (r) inc(r, update); else jobs.set(where.id, { costUsd: 0, ...create }) }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => inc(jobs.get(where.id)!, data)),
      updateMany: vi.fn(async ({ where, data }: { where: { status: { in: string[] } }; data: Record<string, unknown> }) => { for (const r of jobs.values()) if (where.status.in.includes(r.status as string)) inc(r, data) }),
    },
    shot: {
      deleteMany: vi.fn(async () => { shots = [] }), createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => { shots.push(...data) }),
      upsert: vi.fn(async ({ where, create, update }: { where: { titleId_index: { index: number } }; create: Record<string, unknown>; update: Record<string, unknown> }) => { const r = shots.find((s) => s.index === where.titleId_index.index); if (r) Object.assign(r, update); else shots.push(create) }),
    },
    gap: { deleteMany: vi.fn(async () => { gaps = [] }), createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => { gaps.push(...data) }) },
    descriptionCue: { deleteMany: vi.fn(async () => { cues = [] }), createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => { cues.push(...data) }) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  const boss = { createQueue: vi.fn(async () => {}), updateQueue: vi.fn(async () => {}), send: vi.fn(async () => 'next-id'), work: vi.fn(async () => 'worker-id') }
  return { db: db as unknown as Db, raw: db, boss, jobs, title, shots: () => shots, gaps: () => gaps, cues: () => cues }
}
const job = (id: string, retryCount = 0, retryLimit = 2) => ({ id, data: { titleId: 't1' }, retryCount, retryLimit })
/** What steps 6–10 leave for persist('finish'): cues.json and publish's clips.json. */
const finishFiles = async (work: string) => {
  await mkdir(work, { recursive: true })
  await writeFile(`${work}/cues.json`, JSON.stringify([{ startMs: 0, endMs: 2000, text: 'Snow.', extended: false, wordCount: 1, shotIndex: 0 }, { startMs: 5000, endMs: 5100, text: 'Words appear: Berlin.', extended: true, wordCount: 3, shotIndex: 1 }]))
  await writeFile(`${work}/clips.json`, JSON.stringify({ 0: 'published/sintel/cues/cue_0.aaaaaaaaaaaa.mp3', 1: 'published/sintel/cues/cue_1.bbbbbbbbbbbb.mp3' }))
}
const inTmp = async (fn: () => Promise<void>) => { const cwd = process.cwd(); process.chdir(await mkdtemp(join(tmpdir(), 'jobs-cwd-'))); try { await fn() } finally { process.chdir(cwd) } }

describe('pipeline jobs', () => {
  it('creates the dead-letter queue first, then creates and updates one queue per step, and one worker each', async () => {
    const f = fakes()
    await registerPipeline({ boss: f.boss as never, db: f.db })
    expect(f.boss.createQueue.mock.calls.map((c) => (c as unknown[])[0])).toEqual([FAILED_QUEUE, 'pipeline-probe', 'pipeline-shots', 'pipeline-speech', 'pipeline-describe', 'pipeline-fit', 'pipeline-finish'])
    expect(f.boss.updateQueue.mock.calls.map((c) => (c as unknown[])[0])).toEqual(JOB_STEPS.map(queueName)) // QUEUE_OPTIONS edits reach existing queues
    for (const s of JOB_STEPS) expect(QUEUE_OPTIONS[s]).toMatchObject({ policy: 'short', retryBackoff: true, deadLetter: FAILED_QUEUE, retryLimit: expect.any(Number), retryDelay: expect.any(Number) })
    expect(f.boss.work).toHaveBeenCalledTimes(JOB_STEPS.length + 1)
    expect(f.boss.work.mock.calls[0]).toEqual(['pipeline-probe', { includeMetadata: true }, expect.any(Function)])
    expect((f.boss.work.mock.calls.at(-1) as unknown[])[0]).toBe(FAILED_QUEUE)
  })
  it('gives up before pg-boss expiry: records a timeout, persists nothing and enqueues nothing, even if the step finishes later', async () => {
    const f = fakes()
    let finish!: () => void
    const run = vi.fn(() => new Promise<void>((r) => { finish = r }))
    await expect(handleJob('shots', job('x1'), { boss: f.boss as never, db: f.db, run, timeoutMs: 20 })).rejects.toThrow()
    expect(f.jobs.get('x1')).toMatchObject({ status: 'retrying', error: expect.stringMatching(/^timed out after/) })
    finish()
    await new Promise((r) => setTimeout(r, 10))
    expect(f.raw.$transaction).not.toHaveBeenCalled()
    expect(f.boss.send).not.toHaveBeenCalled()
    for (const s of JOB_STEPS) expect(QUEUE_OPTIONS[s].expireInSeconds).toBeGreaterThan(60)
  })
  it('records a failed Job row when the title has no source asset', async () => {
    const f = fakes()
    f.title.assets = []
    await expect(handleJob('probe', job('p1', 2, 2), { boss: f.boss as never, db: f.db, run: vi.fn() })).rejects.toThrow(/no source asset/)
    expect(f.jobs.get('p1')).toMatchObject({ status: 'failed', error: expect.stringContaining('no source asset') })
    expect(f.title.status).toBe('failed')
  })
  it('notes on the Job row when the next step was not queued', async () => {
    const f = fakes()
    f.boss.send.mockResolvedValue(null as never)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await handleJob('fit', job('f1'), { boss: f.boss as never, db: f.db, run: vi.fn(async () => {}) })
    expect(f.jobs.get('f1')).toMatchObject({ status: 'done', error: expect.stringContaining('pipeline-finish not queued') })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
  it('dead letter: closes running rows and fails the title', async () => {
    const f = fakes()
    f.jobs.set('d1', { titleId: 't1', step: 'describe', status: 'running' })
    f.jobs.set('s1', { titleId: 't1', step: 'shots', status: 'done' })
    f.title.status = 'processing'
    await handleDeadLetter('t1', f.db)
    expect(f.jobs.get('d1')).toMatchObject({ status: 'failed', error: expect.stringContaining('dead letter') })
    expect(f.jobs.get('s1')!.status).toBe('done')
    expect(f.title.status).toBe('failed')
  })
  it('enqueues the next step by titleId and records a Job row with cost per step', async () => {
    const f = fakes()
    const ran: Array<[JobStep, string]> = []
    const run = vi.fn(async (s: JobStep, ctx: Ctx) => { ran.push([s, ctx.work]); meter()!.add(0.01); if (s === 'finish') await finishFiles(ctx.work) })
    await inTmp(async () => {
      for (const [i, s] of JOB_STEPS.entries()) {
        if (s === 'probe' || s === 'shots' || s === 'speech' || s === 'describe') continue // these persist files: covered below
        await handleJob(s, job(`j${i}`), { boss: f.boss as never, db: f.db, run })
      }
    })
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
    const run = vi.fn(async (s: JobStep, ctx: Ctx) => { await mkdir(ctx.work, { recursive: true }); const x = files[s]; if (x) await writeFile(`${ctx.work}/${x[0]}`, JSON.stringify(x[1])); if (s === 'finish') await finishFiles(ctx.work) })
    const cwd = process.cwd()
    process.chdir(await mkdtemp(join(tmpdir(), 'chain-')))
    try { for (const s of JOB_STEPS) await handleJob(s, job(s), { boss: f.boss as never, db: f.db, run }) } finally { process.chdir(cwd) }
    expect(f.boss.send.mock.calls.map((c) => (c as unknown[])[0])).toEqual(JOB_STEPS.slice(1).map(queueName))
    expect(f.shots()).toEqual([{ titleId: 't1', index: 0, startMs: 0, endMs: 1000, description: 'Snow.', sameAsPrev: false, novaTokens: 1 }])
    expect([...f.jobs.values()].map((j) => [j.step, j.status])).toEqual(JOB_STEPS.map((s) => [s, 'done']))
    expect(f.cues().map((c) => [c.titleId, c.extended, c.pollyKey])).toEqual([['t1', false, 'published/sintel/cues/cue_0.aaaaaaaaaaaa.mp3'], ['t1', true, 'published/sintel/cues/cue_1.bbbbbbbbbbbb.mp3']])
  })
  it('finish persists DescriptionCue rows with the job\'s db and titleId, replacing a previous run\'s', async () => {
    const f = fakes()
    const work = await mkdtemp(join(tmpdir(), 'finish-'))
    await finishFiles(work)
    await persist('finish', 't1', work, f.db); await persist('finish', 't1', work, f.db)
    expect(f.cues()).toHaveLength(2)
    expect(f.raw.descriptionCue.deleteMany).toHaveBeenCalledWith({ where: { titleId: 't1' } })
  })
  it('finish that runs out of time writes no DescriptionCue rows and does not publish, even if steps 6–10 finish later', async () => {
    const f = fakes()
    let done!: () => void
    const run = vi.fn(async (_s: JobStep, ctx: Ctx) => { await new Promise<void>((r) => { done = r }); await finishFiles(ctx.work) })
    await inTmp(async () => {
      await expect(handleJob('finish', job('fin'), { boss: f.boss as never, db: f.db, run, timeoutMs: 20 })).rejects.toThrow()
      done(); await new Promise((r) => setTimeout(r, 20))
    })
    expect(f.jobs.get('fin')).toMatchObject({ status: 'retrying', error: expect.stringMatching(/^timed out after/) })
    expect(f.raw.descriptionCue.createMany).not.toHaveBeenCalled()
    expect(f.title.status).not.toBe('published')
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
