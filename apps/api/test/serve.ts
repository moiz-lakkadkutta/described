import type { Express } from 'express'
import type { Server } from 'node:http'
import request from 'supertest'

// One server per test file on loopback: supertest's per-request app.listen(0) on `::` exhausts ephemeral ports and cross-talks under parallel runs.
export function serve(app: Express) {
  let server: Server
  beforeAll(() => new Promise<void>((ok) => { server = app.listen(0, '127.0.0.1', () => ok()) }))
  afterAll(() => new Promise<void>((ok) => { server.close(() => ok()) }))
  return () => request(server)
}
