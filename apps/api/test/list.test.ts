import { serve } from './serve'
// In-memory stand-in for the three tables My list touches: Profile (by device), Title (slug, status) and ListItem.
const titles = [
  { id: 't1', slug: 'sintel-90-210', status: 'published' },
  { id: 't2', slug: 'tears-of-steel', status: 'published' },
  { id: 't3', slug: 'still-drafting', status: 'processing' },
]
let items: { profileId: string; titleId: string; createdAt: Date }[] = []
let clock = 0
const bySlug = (slug: string) => titles.find((t) => t.slug === slug)
const db = {
  profile: { upsert: vi.fn(async ({ where }: { where: { deviceId: string } }) => ({ id: `p:${where.deviceId}` })) },
  title: { findFirst: vi.fn(async ({ where }: { where: { slug: string; status: string } }) => titles.find((t) => t.slug === where.slug && t.status === where.status) ?? null) },
  listItem: {
    findMany: vi.fn(async ({ where, orderBy }: { where: { profileId: string; title: { status: string } }; orderBy: { createdAt: 'desc' } }) => {
      expect(orderBy).toEqual({ createdAt: 'desc' })
      return items
        .filter((i) => i.profileId === where.profileId && titles.find((t) => t.id === i.titleId)!.status === where.title.status)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((i) => ({ title: { slug: titles.find((t) => t.id === i.titleId)!.slug } }))
    }),
    upsert: vi.fn(async ({ where, create }: { where: { profileId_titleId: { profileId: string; titleId: string } }; create: { profileId: string; titleId: string } }) => {
      const k = where.profileId_titleId
      const found = items.find((i) => i.profileId === k.profileId && i.titleId === k.titleId)
      if (found) return found
      const row = { ...create, createdAt: new Date(++clock) }
      items.push(row)
      return row
    }),
    deleteMany: vi.fn(async ({ where }: { where: { profileId: string; title: { slug: string } } }) => {
      const before = items.length
      items = items.filter((i) => !(i.profileId === where.profileId && i.titleId === bySlug(where.title.slug)?.id))
      return { count: before - items.length }
    }),
  },
}
vi.mock('../src/lib/db', () => ({ db }))
const { createApp } = await import('../src/app')
const app = serve(createApp())
beforeEach(() => { items = []; clock = 0 })

const list = async (device: string) => (await app().get('/me/list').set('x-device-id', device)).body.data

describe('My list', () => {
  it('GET /me/list is empty for a new device', async () => {
    const res = await app().get('/me/list').set('x-device-id', 'fireos-new')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, data: { slugs: [] } })
    expect(db.profile.upsert.mock.calls.at(-1)![0]).toMatchObject({ where: { deviceId: 'fireos-new' } })
  })

  it('PUT /me/list/:slug adds a published title once', async () => {
    const first = await app().put('/me/list/sintel-90-210').set('x-device-id', 'fireos-abc')
    expect(first.status).toBe(200)
    expect(first.body.data).toEqual({ slugs: ['sintel-90-210'] })
    await app().put('/me/list/sintel-90-210').set('x-device-id', 'fireos-abc')
    expect(items).toHaveLength(1)
    await app().put('/me/list/tears-of-steel').set('x-device-id', 'fireos-abc')
    expect(await list('fireos-abc')).toEqual({ slugs: ['tears-of-steel', 'sintel-90-210'] }) // newest first
    expect(await list('fireos-other')).toEqual({ slugs: [] }) // per device
  })

  it('PUT /me/list/:slug 404s an unpublished or unknown title', async () => {
    for (const slug of ['still-drafting', 'no-such-film']) {
      const res = await app().put(`/me/list/${slug}`).set('x-device-id', 'fireos-abc')
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    }
    expect(items).toEqual([])
  })

  it('DELETE removes it', async () => {
    await app().put('/me/list/sintel-90-210').set('x-device-id', 'fireos-abc')
    await app().put('/me/list/tears-of-steel').set('x-device-id', 'fireos-abc')
    const res = await app().delete('/me/list/sintel-90-210').set('x-device-id', 'fireos-abc')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ slugs: ['tears-of-steel'] })
    // Removing something that is not there is not an error: the list is already as asked.
    expect((await app().delete('/me/list/sintel-90-210').set('x-device-id', 'fireos-abc')).status).toBe(200)
    expect(await list('fireos-abc')).toEqual({ slugs: ['tears-of-steel'] })
  })
})
