import request from 'supertest'
const findUnique = vi.fn()
vi.mock('../src/lib/db', () => ({ db: { title: { findUnique: (...a: unknown[]) => findUnique(...a) } } }))
const { createApp } = await import('../src/app')

const row = {
  slug: 'sintel-90-210', name: 'Sintel', year: 2010, durationS: 120, posterKey: null, status: 'published', synopsis: null, attribution: 'x', voice: 'Joanna',
  renditions: [], tracks: [], cues: [{ startMs: 1000, pollyKey: 'p/1.mp3', text: 'A dragon lands.' }], _count: { cues: 7 }, progress: [],
}
describe('GET /titles/:slug', () => {
  it('extendedCount counts every extended cue, not the one fetched for the sample', async () => {
    findUnique.mockResolvedValueOnce(row)
    const res = await request(createApp()).get('/titles/sintel-90-210')
    expect(res.body.data.extendedCount).toBe(7)
    expect(findUnique.mock.calls[0]![0].include._count).toEqual({ select: { cues: { where: { extended: true } } } })
  })
  it('carries voice, synopsis and attribution (the Player status line and Title read them)', async () => {
    findUnique.mockResolvedValueOnce({ ...row, synopsis: 'A girl and a dragon.' })
    const res = await request(createApp()).get('/titles/sintel-90-210')
    expect(res.body.data).toMatchObject({ voice: 'Joanna', synopsis: 'A girl and a dragon.', attribution: 'x', resumeS: null })
  })
  it("resumeS is this device's saved position", async () => {
    findUnique.mockResolvedValueOnce({ ...row, progress: [{ positionS: 321 }] })
    const res = await request(createApp()).get('/titles/sintel-90-210').set('x-device-id', 'fireos-abc')
    expect(res.body.data.resumeS).toBe(321)
    expect(findUnique.mock.calls.at(-1)![0].include.progress).toEqual({ where: { profile: { deviceId: 'fireos-abc' } } })
  })
})
