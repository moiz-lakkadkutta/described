import { serve } from './serve'
// Title rows as Prisma would return them for GET /catalog: the mock applies the route's include on `tracks`, so a route that
// stops asking for the title's TextTrack rows (or asks for the wrong kind) sees none.
type Track = { kind: 'captions' | 'sdh' | 'descriptions' }
const rows = [
  { slug: 'sintel-90-150', tracks: [{ kind: 'captions' }, { kind: 'descriptions' }] as Track[], cues: [] },
  { slug: 'tears-of-steel-40-100', tracks: [{ kind: 'captions' }, { kind: 'sdh' }, { kind: 'descriptions' }] as Track[], cues: [{ id: 'c1' }] },
].map((r) => ({ ...r, name: r.slug, year: 2010, durationS: 60, posterKey: null, synopsis: null, status: 'published', progress: [] }))
const findMany = vi.fn(async (a: { include?: { tracks?: { where?: { kind?: string } } } }) => {
  const kind = a.include?.tracks?.where?.kind
  return rows.map((r) => ({ ...r, tracks: a.include?.tracks ? r.tracks.filter((t) => !kind || t.kind === kind) : undefined }))
})
vi.mock('../src/lib/db', () => ({ db: { title: { findMany: (a: never) => findMany(a) } } }))
const { createApp } = await import('../src/app')
const http = serve(createApp())

describe('GET /catalog badges', () => {
  it("'sdh' only on a title with a Rich captions (sdh) TextTrack row", async () => {
    const res = await http().get('/catalog')
    const badges = Object.fromEntries((res.body.data.all as { slug: string; badges: string[] }[]).map((i) => [i.slug, i.badges]))
    expect(badges).toEqual({ 'sintel-90-150': ['ad'], 'tears-of-steel-40-100': ['ad', 'sdh', 'extended'] })
  })
})
