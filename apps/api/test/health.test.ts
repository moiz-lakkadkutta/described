import { serve } from './serve'
import { createApp } from '../src/app'
const http = serve(createApp())
describe('health', () => {
  it('responds with the envelope', async () => {
    const res = await http().get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, data: { ok: true } })
  })
})
