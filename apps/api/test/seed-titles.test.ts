import { TITLES_FILE, TitleSeed, loadTitles, seedTitles, titleUpsert } from '../prisma/seed-titles'

const sintel: TitleSeed = {
  slug: 'sintel-90-150-r2', name: 'Sintel', year: 2010, license: 'CC-BY 3.0', attribution: 'Sintel © Blender Foundation, CC-BY 3.0. Described by Described.',
  synopsis: 'A girl and a dragon.', language: 'en', voice: 'Joanna', sourceS3Key: 'sources/sintel-90-150.mp4',
  source: { film: 'Sintel', url: 'https://download.blender.org/demo/movies/', segment: '1:30–2:30' },
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
  it('rejects a title that is not CC-BY, an attribution that is not a full sentence, or a source off download.blender.org', () => {
    expect(() => TitleSeed.parse({ ...sintel, license: 'CC-BY-NC 3.0' })).toThrow()
    expect(() => TitleSeed.parse({ ...sintel, attribution: 'Sintel © Blender Foundation, CC-BY 3.0' })).toThrow()
    expect(() => TitleSeed.parse({ ...sintel, source: { ...sintel.source, url: 'https://archive.org/details/Sintel' } })).toThrow()
    expect(() => TitleSeed.parse({ ...sintel, slug: 'prompts' })).toThrow()
    expect(TitleSeed.parse({ ...sintel, language: undefined, voice: undefined })).toMatchObject({ language: 'en', voice: 'Joanna' })
  })
})

describe('seedTitles', () => {
  it('upserts by slug: creates a draft with its source asset, updates metadata only (status, art, duration, assets untouched)', () => {
    expect(titleUpsert(sintel, 'eu-central-1')).toEqual({
      where: { slug: 'sintel-90-150-r2' },
      create: { slug: 'sintel-90-150-r2', name: 'Sintel', year: 2010, license: 'CC-BY 3.0', attribution: sintel.attribution, synopsis: 'A girl and a dragon.', language: 'en', voice: 'Joanna', assets: { create: { kind: 'source', s3Key: 'sources/sintel-90-150.mp4', region: 'eu-central-1' } } },
      update: { name: 'Sintel', year: 2010, license: 'CC-BY 3.0', attribution: sintel.attribution, synopsis: 'A girl and a dragon.', language: 'en', voice: 'Joanna' },
    })
    const u = titleUpsert({ ...sintel, year: undefined, synopsis: undefined }, 'eu-central-1')
    expect(u.update).toMatchObject({ year: null, synopsis: null })
    for (const k of ['status', 'durationS', 'posterKey', 'heroKey', 'assets']) expect(u.update).not.toHaveProperty(k)
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
