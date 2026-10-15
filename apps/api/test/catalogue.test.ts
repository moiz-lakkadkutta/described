import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Catalogue, MAX_SEED_BYTES, exportCatalogue, importCatalogue, type ExportDb, type ImportDb, type ImportTx } from '../src/hosted/catalogue'
import { writeSeedEvent } from '../prisma/export-catalogue'

// DESC-034: the hosted copy is seeded from the developer's published titles — catalogue tables only.
const title = (slug: string, over: Record<string, unknown> = {}) => ({
  id: `src-${slug}`, slug, name: 'Sintel', year: 2010, license: 'CC-BY 3.0', attribution: 'Sintel © Blender Foundation, CC-BY 3.0. Described by Described.',
  durationS: 60, posterKey: `published/${slug}/poster.jpg`, heroKey: null, synopsis: 'A girl searches the mountains.', language: 'en', voice: 'Joanna',
  status: 'published', createdAt: new Date('2026-10-14T10:00:00Z'),
  assets: [{ id: 'a1', kind: 'source', s3Key: 'sources/sintel.mp4', region: 'eu-central-1', bytes: null, durationS: null }],
  renditions: [{ id: 'r1', kind: 'audio_main', language: 'en', s3Key: `published/${slug}/audio_main` }, { id: 'r2', kind: 'audio_ad', language: 'en', s3Key: `published/${slug}/audio_ad` }],
  tracks: [{ id: 'k1', kind: 'sdh', language: 'en', s3Key: `published/${slug}/sdh.vtt`, cueCount: 12 }],
  cues: [{ id: `src-${slug}:d000001`, startMs: 0, endMs: 4440, text: 'Snow falls.', extended: false, pollyKey: `published/${slug}/cues/cue_0.abc.mp3`, wordCount: 2 }],
  ...over,
})
const exportDb = (rows: unknown[]) => { const findMany = vi.fn(async (_args: unknown) => rows); return { db: { title: { findMany } } as unknown as ExportDb, findMany } }
const NOW = new Date('2026-10-15T09:00:00Z')

describe('exportCatalogue', () => {
  it('asks for published titles only, with the four child tables and nothing per device or pipeline-only', async () => {
    const { db, findMany } = exportDb([title('sintel')])
    const c = await exportCatalogue(db, NOW)
    const args = findMany.mock.calls[0]![0] as { where: unknown; select: Record<string, unknown> }
    expect(args.where).toEqual({ status: 'published' })
    expect(Object.keys(args.select).filter((k) => typeof args.select[k] === 'object').sort()).toEqual(['assets', 'cues', 'renditions', 'tracks'])
    for (const k of ['progress', 'listItems', 'jobs', 'shots', 'gaps']) expect(args.select).not.toHaveProperty(k)
    expect(c).toEqual({ version: 1, exportedAt: NOW, titles: [expect.objectContaining({ slug: 'sintel', status: 'published' })] })
  })
  it('refuses a draft and any device data that would slip into a row', async () => {
    await expect(exportCatalogue(exportDb([title('x', { status: 'draft' })]).db)).rejects.toThrow()
    await expect(exportCatalogue(exportDb([title('x', { progress: [{ positionS: 3 }] })]).db)).rejects.toThrow(/progress/)
    await expect(exportCatalogue(exportDb([{ ...title('x'), listItems: [] }]).db)).rejects.toThrow(/listItems/)
  })
})

describe('writeSeedEvent (pnpm export:catalogue)', () => {
  it('writes the invoke payload { op: "seed", catalogue } that the hosted function validates', async () => {
    const out = path.join(await mkdtemp(path.join(tmpdir(), 'desc034-')), 'nested/seed-event.json')
    const r = await writeSeedEvent(exportDb([title('sintel'), title('bbb')]).db, out, NOW)
    expect(r).toMatchObject({ slugs: ['sintel', 'bbb'], cues: 2 })
    const ev = JSON.parse(await readFile(out, 'utf8'))
    expect(ev.op).toBe('seed')
    expect(Catalogue.parse(ev.catalogue).titles.map((t) => t.slug)).toEqual(['sintel', 'bbb'])
    expect(ev.catalogue.titles[0].createdAt).toBe('2026-10-14T10:00:00.000Z')
  })
  it('refuses a payload larger than one synchronous invoke takes', async () => {
    const big = title('big', { cues: Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, startMs: i, endMs: i + 1, text: 'x'.repeat(MAX_SEED_BYTES / 25), extended: false, pollyKey: null, wordCount: 1 })) })
    await expect(writeSeedEvent(exportDb([big]).db, path.join(tmpdir(), 'never.json'))).rejects.toThrow(/at most/)
  })
})

/** In-memory transaction client: titles by slug, child rows per table. */
function fakeDb(existing: { id: string; slug: string; status: string }[] = []) {
  const titles = new Map(existing.map((t) => [t.slug, { ...t }]))
  const rows: Record<string, Record<string, unknown>[]> = { asset: [], rendition: [], textTrack: [], descriptionCue: [] }
  for (const t of existing) rows.descriptionCue!.push({ id: 'old-cue', titleId: t.id })
  const table = (name: string) => ({
    deleteMany: vi.fn(async ({ where }: { where: { titleId: string } }) => { rows[name] = rows[name]!.filter((r) => r.titleId !== where.titleId) }),
    createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => { rows[name]!.push(...data) }),
  })
  const tx = {
    title: {
      upsert: vi.fn(async ({ where, create, update }: { where: { slug: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const found = titles.get(where.slug)
        const next = found ? { ...found, ...update } : { ...create }
        titles.set(where.slug, next as never)
        return { id: String(next.id) }
      }),
      updateMany: vi.fn(async ({ where }: { where: { slug: { notIn: string[] } } }) => {
        let count = 0
        for (const t of titles.values()) if (!where.slug.notIn.includes(t.slug) && t.status === 'published') { t.status = 'draft'; count++ }
        return { count }
      }),
    },
    asset: table('asset'), rendition: table('rendition'), textTrack: table('textTrack'), descriptionCue: table('descriptionCue'),
  }
  const db: ImportDb = { $transaction: vi.fn(async (fn: (t: ImportTx) => Promise<unknown>) => fn(tx as unknown as ImportTx)) as ImportDb['$transaction'] }
  return { db, titles, rows, tx }
}
const catalogue = (...ts: ReturnType<typeof title>[]) => JSON.parse(JSON.stringify({ version: 1, exportedAt: NOW, titles: ts }))

describe('importCatalogue (the hosted function\'s seed op)', () => {
  it('creates new titles with their export ids and all child rows', async () => {
    const { db, titles, rows } = fakeDb()
    expect(await importCatalogue(db, catalogue(title('sintel')))).toEqual({ titles: ['sintel'], cues: 1, hidden: 0 })
    expect(titles.get('sintel')).toMatchObject({ id: 'src-sintel', status: 'published', createdAt: new Date('2026-10-14T10:00:00Z') })
    expect(rows.rendition!.map((r) => [r.id, r.titleId])).toEqual([['r1', 'src-sintel'], ['r2', 'src-sintel']])
    expect(rows.descriptionCue).toEqual([expect.objectContaining({ id: 'src-sintel:d000001', titleId: 'src-sintel', pollyKey: 'published/sintel/cues/cue_0.abc.mp3' })])
  })
  it('keeps the hosted id of an existing title (devices\' progress and My list survive) and replaces its children', async () => {
    const { db, titles, rows } = fakeDb([{ id: 'hosted-1', slug: 'sintel', status: 'published' }])
    await importCatalogue(db, catalogue(title('sintel')))
    expect(titles.get('sintel')!.id).toBe('hosted-1')
    expect(rows.descriptionCue!.map((r) => r.id)).toEqual(['src-sintel:d000001'])
    expect(rows.descriptionCue![0]!.titleId).toBe('hosted-1')
  })
  it('hides a hosted title that is no longer in the export', async () => {
    const { db, titles } = fakeDb([{ id: 'h0', slug: 'retired', status: 'published' }])
    expect((await importCatalogue(db, catalogue(title('sintel')))).hidden).toBe(1)
    expect(titles.get('retired')!.status).toBe('draft')
  })
  it('refuses a malformed catalogue, a draft, or a slug twice — before touching the database', async () => {
    const { db } = fakeDb()
    await expect(importCatalogue(db, { version: 2, exportedAt: NOW, titles: [] })).rejects.toThrow()
    await expect(importCatalogue(db, catalogue(title('x', { status: 'draft' })))).rejects.toThrow()
    await expect(importCatalogue(db, catalogue(title('x'), title('x')))).rejects.toThrow(/twice/)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})
