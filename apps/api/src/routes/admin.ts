import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { db } from '../lib/db'
import { boss } from '../lib/queue'
import { AppError, ok, validate } from '../lib/http'

export const admin: Router = Router()
admin.use((req, _res, next) => (req.header('x-admin-token') === process.env.ADMIN_TOKEN && process.env.ADMIN_TOKEN ? next() : next(new AppError(401, 'UNAUTHORIZED', 'admin token required'))))

const NewTitle = z.object({ slug: z.string().regex(/^[a-z0-9-]+$/), name: z.string(), year: z.number().int().optional(), license: z.string(), attribution: z.string(), synopsis: z.string().optional(), language: z.enum(['en', 'de']).default('en'), voice: z.enum(['Joanna', 'Matthew', 'Vicki', 'Daniel']).default('Joanna'), sourceS3Key: z.string() })

admin.post('/titles', validate(NewTitle, (r) => r.body), async (req, res, next) => {
  try {
    const v = (req as never as { valid: z.infer<typeof NewTitle> }).valid
    const t = await db.title.create({ data: { slug: v.slug, name: v.name, year: v.year, license: v.license, attribution: v.attribution, synopsis: v.synopsis, language: v.language, voice: v.voice, assets: { create: { kind: 'source', s3Key: v.sourceS3Key, region: process.env.AWS_REGION ?? 'eu-central-1' } } } })
    ok(res, t, 201)
  } catch (e) { next(e) }
})

/** Pipeline step 1's queue: the worker (packages/pipeline/src/jobs.ts) creates it and chains probe → shots → speech → describe → fit → finish. */
export const PIPELINE_FIRST_QUEUE = 'pipeline-probe'

/**
 * Enqueue the describe pipeline for a title. Claiming the title is one atomic update (processing unless it already is), so two
 * requests cannot both start a chain in one work dir; `?force=1` queues anyway. pg-boss keeps one queued run per title
 * (singletonKey), so a null job id is a 409 too. When queueing fails, the status goes back only if this request changed it.
 * The job data carries its own id (sent as the job id) so the pipeline's dead-letter handler can close exactly that Job row.
 */
admin.post('/titles/:id/describe', async (req, res, next) => {
  try {
    const force = req.query.force === '1'
    const t = await db.title.findUniqueOrThrow({ where: { id: req.params.id } })
    const { count } = await db.title.updateMany({ where: { id: t.id, status: force ? undefined : { not: 'processing' } }, data: { status: 'processing' } })
    if (count === 0) throw new AppError(409, 'PROCESSING', 'this title is being described; add ?force=1 to queue it again')
    const changed = !force || t.status !== 'processing'
    const restore = async () => { if (changed) await db.title.updateMany({ where: { id: t.id, status: 'processing' }, data: { status: t.status } }) }
    const id = randomUUID()
    const jobId = await boss.send(PIPELINE_FIRST_QUEUE, { titleId: t.id, step: 'probe', jobId: id }, { id, singletonKey: t.id }).catch(async (e) => { await restore(); throw e })
    if (!jobId) { await restore(); throw new AppError(409, 'NOT_QUEUED', 'this title is already queued, or the pipeline worker has not started') }
    ok(res, { jobId }, 202)
  } catch (e) { next(e) }
})
