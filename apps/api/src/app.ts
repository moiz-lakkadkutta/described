import cors from 'cors'
        import express from 'express'
        import type { Express } from 'express'
        import helmet from 'helmet'
        import pinoHttp from 'pino-http'
        import { errorHandler, ok } from './lib/http'
        import { logger } from './lib/logger'
        import { catalog } from './routes/catalog'
import { titles } from './routes/titles'
import { me } from './routes/me'
import { admin } from './routes/admin'

        export function createApp(): Express {
          const app = express()
          app.use(helmet())
          app.use(cors())
          app.use(express.json({ limit: '1mb' }))
          app.use(pinoHttp({ logger }))
          app.get('/health', (_req, res) => ok(res, { ok: true, service: 'described-api' }))
          app.use('/catalog', catalog)
  app.use('/titles', titles)
  app.use('/me', me)
  app.use('/admin', admin)
          app.use(errorHandler)
          return app
        }
