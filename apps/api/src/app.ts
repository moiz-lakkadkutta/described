import cors from 'cors'
import express from 'express'
import type { Express, RequestHandler } from 'express'
import helmet from 'helmet'
import pinoHttp from 'pino-http'
import { env, type ApiMode } from './lib/env'
import { errorHandler, ok } from './lib/http'
import { logger } from './lib/logger'
import { catalog } from './routes/catalog'
import { titles } from './routes/titles'
import { me } from './routes/me'
import { about } from './routes/about'
import { prompts } from './routes/prompts'

/**
 * Request log level. The hosted copy (`viewer`) logs only 4xx as warn and 5xx as error, so judges' traffic costs no
 * CloudWatch Logs per successful request (DESC-034 review M2); `full` logs every request at info, as before.
 */
export function requestLogLevel(mode: ApiMode) {
  return (_req: unknown, res: { statusCode: number }, err?: Error) =>
    err || res.statusCode >= 500 ? 'error' as const : res.statusCode >= 400 ? 'warn' as const : mode === 'viewer' ? 'silent' as const : 'info' as const
}

/**
 * /admin in full mode, imported on first use: routes/admin imports lib/queue, which constructs PgBoss, and the hosted
 * copy must never construct it (DESC-034 review L1).
 */
const lazyAdmin: RequestHandler = (req, res, next) => { import('./routes/admin').then(({ admin }) => admin(req, res, next), next) }

/**
 * `viewer` mode (the hosted copy, DESC-034) leaves out /admin: creating titles and queueing pipeline jobs belong to the
 * developer's API, which has the queue, the worker and the AWS credentials. Unmounted, those paths answer 404.
 */
export function createApp({ mode = env.API_MODE }: { mode?: ApiMode } = {}): Express {
  const app = express()
  app.use(helmet())
  app.use(cors())
  app.use(express.json({ limit: '1mb' }))
  app.use(pinoHttp({ logger, customLogLevel: requestLogLevel(mode) }))
  app.get('/health', (_req, res) => ok(res, { ok: true, service: 'described-api', mode }))
  app.use('/catalog', catalog)
  app.use('/titles', titles)
  app.use('/me', me)
  if (mode === 'full') app.use('/admin', lazyAdmin)
  app.use('/about', about)
  app.use('/prompts', prompts)
  app.use(errorHandler)
  return app
}
