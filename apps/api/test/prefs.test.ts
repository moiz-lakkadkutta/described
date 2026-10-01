import request from 'supertest'
const upsert = vi.fn(), update = vi.fn(), findMany = vi.fn()
vi.mock('../src/lib/db', () => ({ db: { profile: { upsert: (...a: unknown[]) => upsert(...a), update: (...a: unknown[]) => update(...a) }, title: { findMany: (...a: unknown[]) => findMany(...a) } } }))
vi.mock('../src/lib/env', () => ({ env: { CLOUDFRONT_DOMAIN: 'cdn.test' } }))
const { createApp } = await import('../src/app')

const profile = { id: 'p1', deviceId: 'fireos-abc', adDefault: true, extendedMode: true, voice: 'Joanna', captionKind: 'sdh', captionScale: 100, captionStyle: 'box', firstRunDone: false }
beforeEach(() => { upsert.mockReset().mockResolvedValue(profile); update.mockReset().mockImplementation(async ({ data }) => ({ ...profile, ...data })) })

describe('PUT /me/prefs', () => {
  it('persists first-run completion, extended choice and caption style', async () => {
    const res = await request(createApp()).put('/me/prefs').set('x-device-id', 'fireos-abc').send({ firstRunDone: true, extendedMode: false, captionStyle: 'shadow' })
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { firstRunDone: true, extendedMode: false, captionStyle: 'shadow' } })
    expect(res.body.data).toMatchObject({ firstRunDone: true, extendedMode: false, captionStyle: 'shadow' })
  })
  it.each([[{ captionStyle: 'neon' }], [{ voice: 'Brian' }], [{ captionScale: 175 }]])('rejects %j', async (body) => {
    const res = await request(createApp()).put('/me/prefs').send(body)
    expect(res.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('GET /about', () => {
  it('lists the attribution sentence of every published title', async () => {
    findMany.mockResolvedValueOnce([{ slug: 'sintel-90-210', name: 'Sintel', attribution: 'Sintel © Blender Foundation, CC-BY 3.0. Described by Described.' }])
    const res = await request(createApp()).get('/about')
    expect(res.body.data.titles).toEqual([{ slug: 'sintel-90-210', name: 'Sintel', attribution: 'Sintel © Blender Foundation, CC-BY 3.0. Described by Described.' }])
    expect(findMany.mock.calls[0]![0].where).toEqual({ status: 'published' })
  })
})

describe('GET /prompts/:voice/:key.mp3', () => {
  it('redirects to the clip on CloudFront', async () => {
    const res = await request(createApp()).get('/prompts/Vicki/firstRun2.mp3')
    expect(res.status).toBe(302)
    expect(res.header.location).toBe('https://cdn.test/prompts/Vicki/firstRun2.mp3')
  })
  it.each(['/prompts/Brian/firstRun1.mp3', '/prompts/Joanna/anything.mp3', '/prompts/Joanna/firstRun1.wav'])('404 for %s', async (path) => {
    expect((await request(createApp()).get(path)).status).toBe(404)
  })
})
