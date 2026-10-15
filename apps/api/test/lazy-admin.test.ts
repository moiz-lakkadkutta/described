// DESC-034 review L1 / M2: viewer mode never constructs PgBoss, and logs no successful request.
const { PgBoss } = vi.hoisted(() => ({ PgBoss: vi.fn(() => ({ on: vi.fn(), send: vi.fn() })) }))
vi.mock('pg-boss', () => ({ default: PgBoss }))
vi.mock('../src/lib/db', () => ({ db: { title: { findMany: vi.fn(async () => []) } } }))
import { serve } from './serve'
import { createApp, requestLogLevel } from '../src/app'

const viewer = serve(createApp({ mode: 'viewer' }))
const full = serve(createApp({ mode: 'full' }))

describe('PgBoss', () => {
  it('is not constructed by viewer mode, even when /admin is asked for', async () => {
    expect((await viewer().get('/about')).status).toBe(200)
    expect((await viewer().post('/admin/titles').send({})).status).toBe(404)
    expect(PgBoss).not.toHaveBeenCalled()
  })
  it('is constructed by full mode on its first /admin request', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'x')
    expect((await full().post('/admin/titles').send({})).status).toBe(401)
    expect(PgBoss).toHaveBeenCalledTimes(1)
  })
})

describe('requestLogLevel', () => {
  const res = (statusCode: number) => ({ statusCode })
  it('viewer: 2xx and 3xx silent, 4xx warn, 5xx and errors error', () => {
    const l = requestLogLevel('viewer')
    expect([200, 302, 404, 400, 500].map((c) => l({}, res(c)))).toEqual(['silent', 'silent', 'warn', 'warn', 'error'])
    expect(l({}, res(200), new Error('x'))).toBe('error')
  })
  it('full: every request still logged at info', () => {
    expect(requestLogLevel('full')({}, res(200))).toBe('info')
  })
})
