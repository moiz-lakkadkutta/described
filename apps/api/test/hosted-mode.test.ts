import { serve } from './serve'
const { send, create } = vi.hoisted(() => ({ send: vi.fn(), create: vi.fn() }))
vi.mock('../src/lib/queue', () => ({ boss: { send } }))
vi.mock('../src/lib/db', () => ({ db: { title: { create, findMany: vi.fn(async () => []) } } }))
import { createApp } from '../src/app'
import { ApiMode, env } from '../src/lib/env'
import { isOp } from '../src/lambda'

const full = serve(createApp({ mode: 'full' }))
const viewer = serve(createApp({ mode: 'viewer' }))
const unset = serve(createApp())

// DESC-034: the hosted copy (API_MODE=viewer) serves the TV app's routes and nothing that creates titles or queues jobs.
describe('API_MODE', () => {
  beforeEach(() => { vi.stubEnv('ADMIN_TOKEN', 'x'); send.mockReset(); create.mockReset() })

  it('accepts only full or viewer; unset, the API is full (the developer path is unchanged)', async () => {
    expect(ApiMode.safeParse('viewer').success).toBe(true)
    expect(ApiMode.safeParse('admin').success).toBe(false)
    expect(process.env.API_MODE).toBeUndefined()
    expect(env.API_MODE).toBe('full')
    expect((await unset().post('/admin/titles').send({})).status).toBe(401)
  })

  it('full mode mounts /admin (the token check answers)', async () => {
    expect((await full().post('/admin/titles').send({})).status).toBe(401)
    expect((await full().get('/health')).body.data.mode).toBe('full')
  })

  it('viewer mode answers 404 on every /admin route, with a valid token, and never reaches the queue or the database', async () => {
    for (const [method, path] of [['post', '/admin/titles'], ['post', '/admin/titles/t1/describe'], ['get', '/admin/titles']] as const) {
      const res = await viewer()[method](path).set('x-admin-token', 'x').send({ slug: 'x' })
      expect(res.status, `${method} ${path}`).toBe(404)
    }
    expect(send).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('viewer mode still serves the TV app routes', async () => {
    expect((await viewer().get('/health')).body.data).toEqual({ ok: true, service: 'described-api', mode: 'viewer' })
    expect((await viewer().get('/about')).status).toBe(200)
  })
})

describe('lambda isOp', () => {
  it('takes migrate and seed only from a direct invoke, never from a function URL request', () => {
    expect(isOp({ op: 'migrate' })).toBe(true)
    expect(isOp({ op: 'seed', catalogue: {} })).toBe(true)
    expect(isOp({ op: 'drop' })).toBe(false)
    expect(isOp(null)).toBe(false)
    // a function URL event always has requestContext; a body that looks like an op stays an HTTP request
    expect(isOp({ op: 'seed', requestContext: { http: { method: 'POST' } }, body: '{"op":"seed"}' })).toBe(false)
  })
})
