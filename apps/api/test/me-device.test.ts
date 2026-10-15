import { serve } from './serve'
// DESC-034 review M1 / L3: the device id is bounded, reads never create a Profile row, and progress for an unknown title is a 404.
const db = {
  profile: { upsert: vi.fn(async () => ({ id: 'p1' })), findUnique: vi.fn(async (): Promise<unknown> => null), update: vi.fn() },
  title: { findUnique: vi.fn(async (): Promise<unknown> => null), findFirst: vi.fn(async () => null) },
  listItem: { findMany: vi.fn(async () => []) },
  progress: { upsert: vi.fn() },
}
vi.mock('../src/lib/db', () => ({ db }))
const { createApp } = await import('../src/app')
const viewer = serve(createApp({ mode: 'viewer' }))
const full = serve(createApp({ mode: 'full' }))
beforeEach(() => { for (const t of Object.values(db)) for (const f of Object.values(t)) (f as ReturnType<typeof vi.fn>).mockClear() })
const untouched = () => { expect(db.profile.upsert).not.toHaveBeenCalled(); expect(db.profile.findUnique).not.toHaveBeenCalled() }

describe('x-device-id', () => {
  const bad = ['x'.repeat(65), 'fireos abc', '../etc', 'fireos-é', 'a;b', '']
  it.each(bad)('refuses %j with 400 in both modes, before any query', async (id) => {
    for (const http of [viewer, full]) {
      for (const req of [http().get('/me/prefs'), http().get('/me/list'), http().put('/me/list/sintel'), http().put('/me/prefs').send({ firstRunDone: true }), http().put('/me/progress').send({ titleSlug: 'sintel', positionS: 3 })]) {
        const res = await req.set('x-device-id', id)
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION')
      }
    }
    untouched()
  })
  it('accepts the ids the apps send (fireos-<android id>, dev-device) and 64 characters', async () => {
    for (const id of ['fireos-a1b2c3d4e5f60718', 'dev-device', 'A_z-9'.padEnd(64, 'x')]) expect((await viewer().get('/me/list').set('x-device-id', id)).status).toBe(200)
  })
})

describe('reads never insert', () => {
  it('GET /me/prefs for an unknown device answers the defaults without a row', async () => {
    const res = await viewer().get('/me/prefs').set('x-device-id', 'fireos-new')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ deviceId: 'fireos-new', adDefault: true, extendedMode: true, voice: 'Joanna', captionKind: 'sdh', captionScale: 100, captionStyle: 'system', firstRunDone: false })
    expect(db.profile.upsert).not.toHaveBeenCalled()
  })
  it('GET /me/prefs for a known device answers its row', async () => {
    db.profile.findUnique.mockResolvedValueOnce({ id: 'p1', deviceId: 'fireos-abc', voice: 'Vicki' })
    expect((await viewer().get('/me/prefs').set('x-device-id', 'fireos-abc')).body.data).toEqual({ id: 'p1', deviceId: 'fireos-abc', voice: 'Vicki' })
  })
  it('GET /me/list for an unknown device is empty without a row', async () => {
    const res = await viewer().get('/me/list').set('x-device-id', 'fireos-new')
    expect(res.body).toEqual({ success: true, data: { slugs: [] } })
    expect(db.profile.upsert).not.toHaveBeenCalled()
    expect(db.listItem.findMany).not.toHaveBeenCalled()
  })
})

describe('PUT /me/progress', () => {
  it('answers 404 for an unknown title, and creates no profile', async () => {
    const res = await viewer().put('/me/progress').set('x-device-id', 'fireos-abc').send({ titleSlug: 'no-such-title', positionS: 12 })
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(db.profile.upsert).not.toHaveBeenCalled()
    expect(db.progress.upsert).not.toHaveBeenCalled()
  })
})

describe('defaultPrefs matches the schema defaults (DESC-035)', () => {
  it('captionStyle default is the same in schema.prisma and the no-row answer', async () => {
    const { readFileSync } = await import('node:fs')
    const { defaultPrefs } = await import('../src/routes/me')
    const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
    expect(/captionStyle\s+String\s+@default\("(\w+)"\)/.exec(schema)![1]).toBe(defaultPrefs('x').captionStyle)
  })
})
