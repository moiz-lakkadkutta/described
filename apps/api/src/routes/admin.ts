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
 * Enqueue the describe pipeline for a title. A title already processing answers 409 unless `?force=1` (two chains would share one
 * work dir); pg-boss also keeps one queued run per title (singletonKey), so a null job id is a 409 too, and the status goes back.
 */
admin.post('/titles/:id/describe', async (req, res, next) => {
  try {
    const t = await db.title.findUniqueOrThrow({ where: { id: req.params.id } })
    if (t.status === 'processing' && req.query.force !== '1') throw new AppError(409, 'PROCESSING', 'this title is being described; add ?force=1 to queue it again')
    await db.title.update({ where: { id: t.id }, data: { status: 'processing' } })
    const jobId = await boss.send(PIPELINE_FIRST_QUEUE, { titleId: t.id }, { singletonKey: t.id }).catch(async (e) => { await db.title.update({ where: { id: t.id }, data: { status: t.status } }); throw e })
    if (!jobId) {
      await db.title.update({ where: { id: t.id }, data: { status: t.status } })
      throw new AppError(409, 'NOT_QUEUED', 'this title is already queued, or the pipeline worker has not started')
    }
    ok(res, { jobId }, 202)
  } catch (e) { next(e) }
})
