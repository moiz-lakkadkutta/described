import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { Glossary } from '@described/contracts'
import { TITLES_FILE, TitleSeed, loadTitles, seedTitles, titleUpsert } from '../prisma/seed-titles'

const sintel: TitleSeed = {
  slug: 'sintel-90-150-r2', name: 'Sintel', year: 2010, license: 'CC-BY 3.0', attribution: 'Sintel © Blender Foundation, CC-BY 3.0. Described by Described.',
  synopsis: 'A girl and a dragon.', language: 'en', voice: 'Joanna', sourceS3Key: 'sources/sintel-90-150.mp4',
  source: { film: 'Sintel', url: 'https://download.blender.org/demo/movies/', segment: '1:30–2:30' }, characters: [], settings: [],
}

describe('prisma/titles.json (the catalogue, DESC-010)', () => {
  it('has five titles, every one a CC-BY Blender open movie with a credit sentence and an official source', async () => {
    const titles = await loadTitles(TITLES_FILE)
    expect(titles.map((t) => t.slug)).toEqual(['sintel-90-150-r2', 'big-buck-bunny-0-60', 'elephants-dream-0-60', 'caminandes-35-95', 'tears-of-steel-40-100'])
    for (const t of titles) {
      expect(t.attribution).toMatch(/^.+ © .*Blender (Foundation|Institute).*, CC-BY \d\.\d\. Described by Described\.$/)
      expect(t.attribution).toContain(t.license)
      expect(t.source.url).toMatch(/^https:\/\/download\.blender\.org\//)
      expect(t.sourceS3Key).toBe(`sources/${t.slug === 'sintel-90-150-r2' ? 'sintel-90-150' : t.slug}.mp4`)
    }
  })
  // DESC-029 (docs/decisions/0012-characters-and-scenes.md): every title has its people and places, each name with its evidence.
  it('has characters and settings for every title, each name revealed at a segment time or never, with its evidence', async () => {
    const titles = await loadTitles(TITLES_FILE)
    for (const t of titles) {
      expect(t.characters.length, t.slug).toBeGreaterThan(0)
      expect(t.settings.length, t.slug).toBeGreaterThan(0)
      for (const c of t.characters) {
        expect(c.nameEvidence.length, c.name).toBeGreaterThan(10)
        if (c.revealedAtS !== null) expect(c.nameEvidence, c.name).toMatch(/\d/) // a time or a caption number
        if (c.revealedAtS !== null) expect(c.revealedAtS, c.name).toBeGreaterThanOrEqual(0) // revealed inside the segment only (0012)
        expect(c.look, c.name).not.toContain(c.name) // the look is how to refer to them before the name
      }
      for (const s of t.settings) if (s.firstAtS !== undefined) { expect(s.firstAtS).toBeGreaterThanOrEqual(0); expect(s.firstAtS).toBeLessThan(60) }
    }
    const named = (slug: string) => Object.fromEntries(titles.find((t) => t.slug === slug)!.characters.map((c) => [c.name, c.revealedAtS]))
    expect(named('elephants-dream-0-60')).toEqual({ Proog: null, Emo: 25.1 }) // "Emo," at 25.07 s; Proog never said in the segment
    expect(named('tears-of-steel-40-100')).toMatchObject({ Thom: 2.2, Celia: null }) // "Whatever, Thom." inside the segment; Celia only before it starts
    expect(named('sintel-90-150-r2').Sintel).toBeNull() // film 7:37, after the segment
  })
  it('rejects a malformed character (no evidence, a revealedAtS that is not a number or null)', () => {
    const c = { name: 'Emo', look: 'a thin young man', short: 'the thin young man', role: 'the young man', revealedAtS: 25.1, nameEvidence: 'Caption c3 "Emo," 25.07 s' }
    expect(TitleSeed.parse({ ...sintel, characters: [c] }).characters).toEqual([c])
    expect(() => TitleSeed.parse({ ...sintel, characters: [{ ...c, nameEvidence: '' }] })).toThrow()
    expect(() => TitleSeed.parse({ ...sintel, characters: [{ ...c, revealedAtS: undefined }] })).toThrow()
    expect(TitleSeed.parse({ ...sintel, characters: undefined, settings: undefined })).toMatchObject({ characters: [], settings: [] })
  })
  it('rejects a title that is not CC-BY, an attribution that is not a full sentence, or a source off download.blender.org', () => {
    expect(() => TitleSeed.parse({ ...sintel, license: 'CC-BY-NC 3.0' })).toThrow()
    expect(() => TitleSeed.parse({ ...sintel, attribution: 'Sintel © Blender Foundation, CC-BY 3.0' })).toThrow()
    expect(() => TitleSeed.parse({ ...sintel, source: { ...sintel.source, url: 'https://archive.org/details/Sintel' } })).toThrow()
    expect(() => TitleSeed.parse({ ...sintel, slug: 'prompts' })).toThrow()
    expect(TitleSeed.parse({ ...sintel, language: undefined, voice: undefined })).toMatchObject({ language: 'en', voice: 'Joanna' })
  })
})

describe('seedTitles', () => {
  it('upserts by slug: creates a draft with its source asset, updates metadata only (status, art, duration, assets, voice, language untouched)', () => {
    expect(titleUpsert(sintel, 'eu-central-1')).toEqual({
      where: { slug: 'sintel-90-150-r2' },
      create: { slug: 'sintel-90-150-r2', name: 'Sintel', year: 2010, license: 'CC-BY 3.0', attribution: sintel.attribution, synopsis: 'A girl and a dragon.', language: 'en', voice: 'Joanna', assets: { create: { kind: 'source', s3Key: 'sources/sintel-90-150.mp4', region: 'eu-central-1' } } },
      update: { name: 'Sintel', year: 2010, license: 'CC-BY 3.0', attribution: sintel.attribution, synopsis: 'A girl and a dragon.' },
    })
    const u = titleUpsert({ ...sintel, year: undefined, synopsis: undefined }, 'eu-central-1')
    expect(u.update).toMatchObject({ year: null, synopsis: null })
    for (const k of ['status', 'durationS', 'posterKey', 'heroKey', 'assets', 'voice', 'language', 'characters', 'settings']) expect(u.update).not.toHaveProperty(k) // voice/language: what the run spoke
  })
  it('seeds every entry in order and refuses a duplicate slug before writing anything', async () => {
    const upsert = vi.fn<(args: ReturnType<typeof titleUpsert>) => Promise<unknown>>(async () => ({}))
    const bbb = { ...sintel, slug: 'big-buck-bunny-0-60', name: 'Big Buck Bunny' }
    await expect(seedTitles({ title: { upsert } }, [sintel, bbb], 'eu-central-1')).resolves.toEqual(['sintel-90-150-r2', 'big-buck-bunny-0-60'])
    expect(upsert.mock.calls.map(([a]) => a.where.slug)).toEqual(['sintel-90-150-r2', 'big-buck-bunny-0-60'])
    upsert.mockClear()
    await expect(seedTitles({ title: { upsert } }, [sintel, sintel], 'eu-central-1')).rejects.toThrow(/appears twice/)
    expect(upsert).not.toHaveBeenCalled()
  })
})

// Glossaries of titles the seeder must not create (decision 0016): full-length `sintel` gets its Title row from `pnpm describe --slug
// sintel` (DESC-025), which refuses an existing slug; the pipeline reads its people and places from prisma/glossaries.json.
describe('prisma/glossaries.json (glossary-only titles, not seeded)', () => {
  const GLOSSARIES_FILE = new URL('../prisma/glossaries.json', import.meta.url)
  const load = async () => z.array(z.object({ slug: z.string().regex(/^[a-z0-9-]{1,64}$/) }).merge(Glossary).strict()).parse(JSON.parse(await readFile(GLOSSARIES_FILE, 'utf8')))
  it('has the full-length sintel glossary, each name with its evidence and a film time', async () => {
    const entries = await load()
    const sintelFull = entries.find((e) => e.slug === 'sintel')!
    expect(sintelFull.characters.length).toBeGreaterThan(0)
    expect(sintelFull.settings.length).toBeGreaterThan(0)
    for (const c of sintelFull.characters) {
      expect(c.nameEvidence.length, c.name).toBeGreaterThan(10)
      if (c.revealedAtS !== null) expect(c.nameEvidence, c.name).toMatch(/\d/)
      expect(c.look, c.name).not.toContain(c.name)
    }
    for (const s of sintelFull.settings) if (s.firstAtS !== undefined) expect(s.firstAtS).toBeLessThan(888) // the film is 14:48
  })
  it('lists no title that titles.json has, and seeding creates no row for its slugs', async () => {
    const [entries, titles] = await Promise.all([load(), loadTitles(TITLES_FILE)])
    const seeded = titles.map((t) => t.slug)
    for (const e of entries) expect(seeded, e.slug).not.toContain(e.slug)
    const upsert = vi.fn<(args: ReturnType<typeof titleUpsert>) => Promise<unknown>>(async () => ({}))
    await seedTitles({ title: { upsert } }, titles, 'eu-central-1')
    expect(upsert.mock.calls.map(([a]) => a.where.slug)).not.toContain('sintel')
    expect(upsert).toHaveBeenCalledTimes(titles.length)
  })
})
