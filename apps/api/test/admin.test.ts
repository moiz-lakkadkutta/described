import request from 'supertest'
const { send, update, find } = vi.hoisted(() => ({ send: vi.fn(), update: vi.fn(), find: vi.fn() }))
vi.mock('../src/lib/queue', () => ({ boss: { send } }))
vi.mock('../src/lib/db', () => ({ db: { title: { findUniqueOrThrow: find, update } } }))
import { createApp } from '../src/app'

const post = (q = '') => request(createApp()).post(`/admin/titles/t1/describe${q}`).set('x-admin-token', 'x')
describe('POST /admin/titles/:id/describe', () => {
  beforeEach(() => { vi.stubEnv('ADMIN_TOKEN', 'x'); send.mockReset(); update.mockReset(); find.mockReset().mockResolvedValue({ id: 't1', status: 'draft' }) })
  it('marks the title processing, then enqueues pipeline step 1 keyed by title', async () => {
    send.mockResolvedValue('job-1')
    const res = await post()
    expect(res.status).toBe(202)
    expect(res.body.data).toEqual({ jobId: 'job-1' })
    expect(send).toHaveBeenCalledWith('pipeline-probe', { titleId: 't1' }, { singletonKey: 't1' })
    expect(update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { status: 'processing' } })
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]!)
  })
  it('answers 409 and restores the status when nothing was queued', async () => {
    send.mockResolvedValue(null)
    expect((await post()).status).toBe(409)
    expect(update).toHaveBeenLastCalledWith({ where: { id: 't1' }, data: { status: 'draft' } })
  })
  it('refuses a title that is already processing unless forced', async () => {
    find.mockResolvedValue({ id: 't1', status: 'processing' })
    send.mockResolvedValue('job-2')
    expect((await post()).status).toBe(409)
    expect(send).not.toHaveBeenCalled()
    expect((await post('?force=1')).status).toBe(202)
  })
})
