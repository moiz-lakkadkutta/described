import { serve } from './serve'
const { send, updateMany, find, create } = vi.hoisted(() => ({ send: vi.fn(), updateMany: vi.fn(), find: vi.fn(), create: vi.fn() }))
vi.mock('../src/lib/queue', () => ({ boss: { send } }))
vi.mock('../src/lib/db', () => ({ db: { title: { findUniqueOrThrow: find, updateMany, create } } }))
import { createApp } from '../src/app'
const http = serve(createApp())

const post = (q = '') => http().post(`/admin/titles/t1/describe${q}`).set('x-admin-token', 'x')
const claim = { where: { id: 't1', status: { not: 'processing' } }, data: { status: 'processing' } }
describe('POST /admin/titles/:id/describe', () => {
  beforeEach(() => {
    vi.stubEnv('ADMIN_TOKEN', 'x'); send.mockReset(); find.mockReset().mockResolvedValue({ id: 't1', status: 'draft' })
    updateMany.mockReset().mockResolvedValue({ count: 1 })
  })
  it('claims the title atomically, then enqueues pipeline step 1 with its own id in the data', async () => {
    send.mockImplementation(async (_q, _d, o: { id: string }) => o.id)
    const res = await post()
    expect(res.status).toBe(202)
    expect(updateMany).toHaveBeenCalledWith(claim)
    const [queue, data, opts] = send.mock.calls[0]!
    expect([queue, opts]).toEqual(['pipeline-probe', { id: data.jobId, singletonKey: 't1' }])
    expect(data).toEqual({ titleId: 't1', step: 'probe', jobId: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    expect(res.body.data).toEqual({ jobId: data.jobId })
    expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]!)
  })
  it('answers 409 when the atomic claim finds the title already processing (a concurrent request won)', async () => {
    updateMany.mockResolvedValue({ count: 0 })
    expect((await post()).status).toBe(409)
    expect(send).not.toHaveBeenCalled()
    expect(updateMany).toHaveBeenCalledTimes(1) // nothing restored: this request changed nothing
  })
  it('restores the status it changed when nothing was queued or send failed', async () => {
    send.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('db down'))
    expect((await post()).status).toBe(409)
    expect(updateMany).toHaveBeenLastCalledWith({ where: { id: 't1', status: 'processing' }, data: { status: 'draft' } })
    expect((await post()).status).toBe(500)
    expect(updateMany).toHaveBeenCalledTimes(4)
  })
  it('with ?force=1 queues a processing title and never resets a status it did not change', async () => {
    find.mockResolvedValue({ id: 't1', status: 'processing' })
    send.mockResolvedValue(null)
    expect((await post('?force=1')).status).toBe(409)
    expect(updateMany).toHaveBeenCalledTimes(1)
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 't1', status: undefined }, data: { status: 'processing' } })
  })
})

describe('POST /admin/titles', () => {
  const title = { slug: 'sintel-90-150', name: 'Sintel', license: 'CC-BY 3.0', attribution: 'Sintel © Blender Foundation, CC-BY 3.0.', sourceS3Key: 'sources/sintel.mp4' }
  const postTitle = (body: object) => http().post('/admin/titles').set('x-admin-token', 'x').send(body)
  beforeEach(() => { vi.stubEnv('ADMIN_TOKEN', 'x'); create.mockReset().mockImplementation(async ({ data }) => ({ id: 't1', ...data })) })
  it('POST /admin/titles accepts posterKey under published/ and rejects other prefixes', async () => {
    const art = { posterKey: 'published/sintel-90-150/art/poster.jpg', heroKey: 'published/sintel-90-150/art/hero.jpg' }
    expect((await postTitle({ ...title, ...art })).status).toBe(201)
    expect(create.mock.calls[0]![0].data).toMatchObject(art)
    expect((await postTitle(title)).status).toBe(201)
    expect(create.mock.calls[1]![0].data.posterKey).toBeUndefined()
    for (const bad of [{ posterKey: 'work/sintel-90-150/art/poster.jpg' }, { heroKey: 'sources/hero.jpg' }, { posterKey: '/published/x.jpg' }, { heroKey: 'published/../work/x.jpg' }]) {
      expect((await postTitle({ ...title, ...bad })).status, JSON.stringify(bad)).toBe(400)
    }
    expect(create).toHaveBeenCalledTimes(2)
  })
  it('rejects the slug "prompts": published/prompts/ holds the app-voice clips', async () => {
    expect((await postTitle({ ...title, slug: 'prompts' })).status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })
})
