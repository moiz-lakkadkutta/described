import request from 'supertest'
const { send, update } = vi.hoisted(() => ({ send: vi.fn(), update: vi.fn() }))
vi.mock('../src/lib/queue', () => ({ boss: { send } }))
vi.mock('../src/lib/db', () => ({ db: { title: { findUniqueOrThrow: vi.fn(async () => ({ id: 't1' })), update } } }))
import { createApp } from '../src/app'

describe('POST /admin/titles/:id/describe', () => {
  beforeEach(() => { vi.stubEnv('ADMIN_TOKEN', 'x'); send.mockReset(); update.mockReset() })
  it('enqueues pipeline step 1 keyed by title and marks the title processing', async () => {
    send.mockResolvedValue('job-1')
    const res = await request(createApp()).post('/admin/titles/t1/describe').set('x-admin-token', 'x')
    expect(res.status).toBe(202)
    expect(res.body.data).toEqual({ jobId: 'job-1' })
    expect(send).toHaveBeenCalledWith('pipeline-probe', { titleId: 't1' }, { singletonKey: 't1' })
    expect(update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { status: 'processing' } })
  })
  it('answers 409 and leaves the title alone when nothing was queued', async () => {
    send.mockResolvedValue(null)
    const res = await request(createApp()).post('/admin/titles/t1/describe').set('x-admin-token', 'x')
    expect(res.status).toBe(409)
    expect(update).not.toHaveBeenCalled()
  })
})
