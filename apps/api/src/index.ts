import http from 'node:http'
import { Server } from 'socket.io'
import { createApp } from './app'
import { setIo } from './lib/io'
import { env } from './lib/env'
import { logger } from './lib/logger'
import { startQueue } from './lib/queue'
import { registerSockets } from './sockets'

const app = createApp()
const server = http.createServer(app)
const io = new Server(server, { cors: { origin: '*' } })
setIo(io)
registerSockets(io)

startQueue()
  .then(() => server.listen(env.PORT, () => logger.info({ port: env.PORT }, 'api listening')))
  .catch((e) => { logger.error(e, 'failed to start'); process.exit(1) })
