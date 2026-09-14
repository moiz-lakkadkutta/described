import request from 'supertest'
import { createApp } from '../src/app'
describe('health', () => {
  it('responds with the envelope', async () => {
    const res = await request(createApp()).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, data: { ok: true } })
  })
})
