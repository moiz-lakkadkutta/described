import request from 'supertest'
const db = {
  profile: { upsert: vi.fn(async (_a: { where: object }) => ({ id: 'p1' })) },
  title: { findUniqueOrThrow: vi.fn(async () => ({ id: 't1' })) },
  progress: { upsert: vi.fn(async (a: { create: object }) => a.create) },
}
vi.mock('../src/lib/db', () => ({ db }))
const { createApp } = await import('../src/app')

describe('PUT /me/progress', () => {
  it("upserts this device's position for the title", async () => {
    const res = await request(createApp()).put('/me/progress').set('x-device-id', 'fireos-abc').send({ titleSlug: 'sintel-90-210', positionS: 321 })
    expect(res.status).toBe(200)
    expect(db.profile.upsert.mock.calls.at(-1)![0]).toMatchObject({ where: { deviceId: 'fireos-abc' } })
    expect(db.progress.upsert.mock.calls.at(-1)![0]).toEqual({
      where: { profileId_titleId: { profileId: 'p1', titleId: 't1' } }, create: { profileId: 'p1', titleId: 't1', positionS: 321 }, update: { positionS: 321 },
    })
  })
  it('refuses a negative or missing position', async () => {
    for (const body of [{ titleSlug: 'sintel-90-210', positionS: -1 }, { titleSlug: 'sintel-90-210' }]) {
      const res = await request(createApp()).put('/me/progress').send(body)
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION')
    }
  })
})
