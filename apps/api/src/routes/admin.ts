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

/** Enqueue the describe pipeline for a title. One queued run per title (singletonKey); null means one is already queued, or no worker has created the queues. */
admin.post('/titles/:id/describe', async (req, res, next) => {
  try {
    await db.title.findUniqueOrThrow({ where: { id: req.params.id } })
    const jobId = await boss.send(PIPELINE_FIRST_QUEUE, { titleId: req.params.id }, { singletonKey: req.params.id })
    if (!jobId) throw new AppError(409, 'NOT_QUEUED', 'this title is already queued, or the pipeline worker has not started')
    await db.title.update({ where: { id: req.params.id }, data: { status: 'processing' } })
    ok(res, { jobId }, 202)
  } catch (e) { next(e) }
})
