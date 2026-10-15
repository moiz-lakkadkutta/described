import cors from 'cors'
import express from 'express'
import type { Express } from 'express'
import helmet from 'helmet'
import pinoHttp from 'pino-http'
import { env, type ApiMode } from './lib/env'
import { errorHandler, ok } from './lib/http'
import { logger } from './lib/logger'
import { catalog } from './routes/catalog'
import { titles } from './routes/titles'
import { me } from './routes/me'
import { admin } from './routes/admin'
import { about } from './routes/about'
import { prompts } from './routes/prompts'

/**
 * `viewer` mode (the hosted copy, DESC-034) leaves out /admin: creating titles and queueing pipeline jobs belong to the
 * developer's API, which has the queue, the worker and the AWS credentials. Unmounted, those paths answer 404.
 */
export function createApp({ mode = env.API_MODE }: { mode?: ApiMode } = {}): Express {
  const app = express()
  app.use(helmet())
  app.use(cors())
  app.use(express.json({ limit: '1mb' }))
  app.use(pinoHttp({ logger }))
  app.get('/health', (_req, res) => ok(res, { ok: true, service: 'described-api', mode }))
  app.use('/catalog', catalog)
  app.use('/titles', titles)
  app.use('/me', me)
  if (mode === 'full') app.use('/admin', admin)
  app.use('/about', about)
  app.use('/prompts', prompts)
  app.use(errorHandler)
  return app
}
