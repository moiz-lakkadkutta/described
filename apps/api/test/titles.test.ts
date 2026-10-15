import { serve } from './serve'
import { parseVtt } from '@moiz0309/vega-media-kit/core'
const findUnique = vi.fn()
vi.mock('../src/lib/db', () => ({ db: { title: { findUnique: (...a: unknown[]) => findUnique(...a) } } }))
const { createApp } = await import('../src/app')
const http = serve(createApp())
beforeEach(() => { findUnique.mockReset() })

const row = {
  slug: 'sintel-90-210', name: 'Sintel', year: 2010, durationS: 120, posterKey: null, status: 'published', synopsis: null, attribution: 'x', voice: 'Joanna',
  renditions: [], tracks: [], cues: [{ startMs: 1000, pollyKey: 'p/1.mp3', text: 'A dragon lands.' }], _count: { cues: 7 }, progress: [],
}
describe('GET /titles/:slug', () => {
  it('extendedCount counts every extended cue, not the one fetched for the sample', async () => {
    findUnique.mockResolvedValueOnce(row)
    const res = await http().get('/titles/sintel-90-210')
    expect(res.body.data.extendedCount).toBe(7)
    expect(findUnique.mock.calls[0]![0].include._count).toEqual({ select: { cues: { where: { extended: true } } } })
  })
  it('carries voice, synopsis and attribution (the Player status line and Title read them)', async () => {
    findUnique.mockResolvedValueOnce({ ...row, synopsis: 'A girl and a dragon.' })
    const res = await http().get('/titles/sintel-90-210')
    expect(res.body.data).toMatchObject({ voice: 'Joanna', synopsis: 'A girl and a dragon.', attribution: 'x', resumeS: null })
  })
  it("resumeS is this device's saved position", async () => {
    findUnique.mockResolvedValueOnce({ ...row, progress: [{ positionS: 321 }] })
    const res = await http().get('/titles/sintel-90-210').set('x-device-id', 'fireos-abc')
    expect(res.body.data.resumeS).toBe(321)
    expect(findUnique.mock.calls.at(-1)![0].include.progress).toEqual({ where: { profile: { deviceId: 'fireos-abc' } } })
  })
  it("badges carry 'extended' when the title has extended cues, as /catalog does", async () => {
    const sdh = { ...row, tracks: [{ kind: 'sdh', language: 'en', s3Key: 'published/x/sdh.m3u8' }] }
    findUnique.mockResolvedValueOnce(sdh)
    expect((await http().get('/titles/sintel-90-210')).body.data.badges).toEqual(['ad', 'sdh', 'extended'])
    findUnique.mockResolvedValueOnce({ ...sdh, _count: { cues: 0 } })
    expect((await http().get('/titles/sintel-90-210')).body.data.badges).toEqual(['ad', 'sdh'])
  })
  it("badges carry 'sdh' only when the title has a Rich captions (sdh) text track, as /catalog does", async () => {
    findUnique.mockResolvedValueOnce({ ...row, tracks: [{ kind: 'captions', language: 'en', s3Key: 'published/x/captions.m3u8' }] })
    expect((await http().get('/titles/sintel-90-210')).body.data.badges).toEqual(['ad', 'extended'])
  })
})

describe('GET /titles/:slug/cues/:cueId/audio (Extended mode, DESC-007)', () => {
  it('d{n} redirects to the n-th cue\'s published clip on the CDN', async () => {
    findUnique.mockResolvedValueOnce({ status: 'published', cues: [{ pollyKey: 'published/sintel-90-210/cues/cue_6.3f2a9c01b7de.mp3' }] })
    const res = await http().get('/titles/sintel-90-210/cues/d7/audio')
    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(/^https:\/\/[^/]+\/published\/sintel-90-210\/cues\/cue_6\.3f2a9c01b7de\.mp3$/)
    expect(res.headers['cache-control']).toBe('public, max-age=300')
    const q = findUnique.mock.calls.at(-1)![0]
    expect(q.where).toEqual({ slug: 'sintel-90-210' })
    expect(q.select.cues).toMatchObject({ orderBy: [{ startMs: 'asc' }, { endMs: 'asc' }, { id: 'asc' }], skip: 6, take: 1 })
  })
  it('404 when the cue has no clip — nothing is synthesised at request time', async () => {
    findUnique.mockResolvedValueOnce({ status: 'published', cues: [{ pollyKey: null }] })
    expect((await http().get('/titles/sintel-90-210/cues/d1/audio')).status).toBe(404)
  })
  it('404 past the last cue, for an unknown or unpublished title, and for an id that is not d{n}', async () => {
    findUnique.mockResolvedValueOnce({ status: 'published', cues: [] })
    expect((await http().get('/titles/sintel-90-210/cues/d99/audio')).status).toBe(404)
    findUnique.mockResolvedValueOnce(null)
    expect((await http().get('/titles/nope/cues/d1/audio')).status).toBe(404)
    findUnique.mockResolvedValueOnce({ status: 'processing', cues: [{ pollyKey: 'k.mp3' }] })
    expect((await http().get('/titles/sintel-90-210/cues/d1/audio')).status).toBe(404)
    const calls = findUnique.mock.calls.length
    for (const id of ['d0', 'x1', 'ckabc123', 'd1.mp3']) expect((await http().get(`/titles/sintel-90-210/cues/${id}/audio`)).status).toBe(404)
    expect(findUnique.mock.calls.length).toBe(calls) // rejected before the database
  })
})

describe('d{n} is the same cue in descriptions.vtt and the clip route, even for cues tied on start and end', () => {
  // Postgres returns rows tied on every ORDER BY key in no promised order, and two queries may differ. The stand-in sorts by the
  // route's orderBy and leaves ties in storage order for the VTT query but reversed for the clip query (OFFSET … LIMIT 1).
  type Row = { id: string; startMs: number; endMs: number; text: string; extended: boolean; wordCount: number; pollyKey: string }
  const stored: Row[] = [
    { id: 't1:d000002', startMs: 5000, endMs: 5001, text: 'Words appear: Paris.', extended: true, wordCount: 3, pollyKey: 'paris.mp3' },
    { id: 't1:d000001', startMs: 5000, endMs: 5001, text: 'Words appear: Berlin.', extended: true, wordCount: 3, pollyKey: 'berlin.mp3' },
  ]
  const sorted = (orderBy: Record<string, 'asc'>[], tiesReversed: boolean) => {
    const rows = tiesReversed ? [...stored].reverse() : [...stored]
    return rows.sort((a, b) => { for (const o of orderBy) { const k = Object.keys(o)[0] as keyof Row; if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1 } return 0 })
  }
  it('each tied cue maps to its own clip', async () => {
    findUnique.mockImplementation(async (q: { include?: { cues: { orderBy: Record<string, 'asc'>[] } }; select?: { cues: { orderBy: Record<string, 'asc'>[]; skip: number; take: number } } }) => {
      if (q.include) return { status: 'published', cues: sorted(q.include.cues.orderBy, false) }
      const c = q.select!.cues
      return { status: 'published', cues: sorted(c.orderBy, true).slice(c.skip, c.skip + c.take) }
    })
    const parsed = parseVtt((await http().get('/titles/x/descriptions.vtt')).text, { trackId: 'd' })
    const clips = await Promise.all(parsed.map(async (c) => (await http().get(`/titles/x/cues/${c.id}/audio`)).headers.location as string))
    expect(parsed.map((c, k) => [c.id, c.text, clips[k]!.split('/').at(-1)])).toEqual([['d1', 'Words appear: Berlin.', 'berlin.mp3'], ['d2', 'Words appear: Paris.', 'paris.mp3']])
  })
})

describe('GET /titles/:slug/descriptions.vtt (the app\'s source for d{n})', () => {
  it('numbers cues d1… in start-then-end order and marks extended ones', async () => {
    findUnique.mockResolvedValueOnce({ status: 'published', cues: [
      { startMs: 1000, endMs: 1100, text: 'Words appear: Berlin.', extended: true, wordCount: 3 },
      { startMs: 1000, endMs: 4000, text: 'A dragon lands.', extended: false, wordCount: 3 },
    ] })
    const res = await http().get('/titles/sintel-90-210/descriptions.vtt')
    expect(res.type).toBe('text/vtt')
    expect(res.text).toBe('WEBVTT\n\nd1\n00:00:01.000 --> 00:00:01.100\nWords appear: Berlin. {extended=1;words=3}\n\nd2\n00:00:01.000 --> 00:00:04.000\nA dragon lands.\n')
    expect(findUnique.mock.calls.at(-1)![0].include.cues.orderBy).toEqual([{ startMs: 'asc' }, { endMs: 'asc' }, { id: 'asc' }])
  })
  it('a blank line, an arrow or text that cleans to nothing cannot move a cue onto another\'s clip', async () => {
    findUnique.mockResolvedValueOnce({ status: 'published', cues: [
      { startMs: 1000, endMs: 3000, text: 'A girl climbs.\n\nSnow falls.', extended: false, wordCount: 5 },
      { startMs: 4000, endMs: 6000, text: '<c></c>', extended: false, wordCount: 0 },
      { startMs: 7000, endMs: 7100, text: 'Words appear: 10:00 --> 11:00 {x}', extended: true, wordCount: 6 },
      { startMs: 9000, endMs: 9100, text: 'A dragon lands.', extended: true, wordCount: 3 },
    ] })
    const res = await http().get('/titles/sintel-90-210/descriptions.vtt')
    const parsed = parseVtt(res.text, { trackId: 'd' })
    expect(parsed.map((c) => [c.id, c.text, c.meta?.extended])).toEqual([
      ['d1', 'A girl climbs. Snow falls.', undefined], // one cue, whitespace collapsed
      // d2 cleans to nothing and is dropped by the parser; the others keep their own ids
      ['d3', 'Words appear: 10:00 → 11:00 x', '1'],
      ['d4', 'A dragon lands.', '1'],
    ])
  })
  it('404 unless the title is published, like the clip route', async () => {
    findUnique.mockResolvedValueOnce({ status: 'processing', cues: [] })
    expect((await http().get('/titles/sintel-90-210/descriptions.vtt')).status).toBe(404)
    findUnique.mockResolvedValueOnce(null)
    expect((await http().get('/titles/nope/descriptions.vtt')).status).toBe(404)
  })
})
