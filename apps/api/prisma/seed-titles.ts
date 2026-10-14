import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/**
 * The catalogue (DESC-010): one entry per title in prisma/titles.json — what `POST /admin/titles` takes, plus where the
 * segment came from (`source`: film, official download URL, segment), so every CC-BY credit line in the app can be traced
 * to its source. The pipeline fills the rest (durationS, art, cues, tracks, status) when it publishes the title.
 */
export const TitleSeed = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/).refine((s) => s !== 'prompts', 'slug "prompts" is reserved'),
  name: z.string().min(1),
  year: z.number().int().optional(),
  license: z.string().regex(/^CC-BY \d\.\d$/, 'demo content is CC-BY (docs/submission.md)'),
  attribution: z.string().regex(/\. Described by Described\.$/, 'attribution is a full sentence ending in "Described by Described."'),
  synopsis: z.string().optional(),
  language: z.enum(['en', 'de']).default('en'),
  voice: z.enum(['Joanna', 'Matthew', 'Vicki', 'Daniel']).default('Joanna'),
  sourceS3Key: z.string().regex(/^sources\/[\w.-]+\.mp4$/),
  source: z.object({ film: z.string(), url: z.string().url().startsWith('https://download.blender.org/', 'sources are official Blender downloads'), segment: z.string().regex(/^\d+:\d\d–\d+:\d\d$/) }),
})
export type TitleSeed = z.infer<typeof TitleSeed>

/** What seeding needs of Prisma's client, structurally (tests pass a fake). */
export interface SeedDb { title: { upsert(args: ReturnType<typeof titleUpsert>): Promise<unknown> } }

/**
 * Pure (tested). Upsert by slug: a new title is a draft with its source Asset; an existing one gets only its metadata updated,
 * so status, durationS, art keys and assets written by the pipeline or set by the admin are never touched by a re-seed.
 */
export function titleUpsert(t: TitleSeed, region: string) {
  const meta = { name: t.name, year: t.year ?? null, license: t.license, attribution: t.attribution, synopsis: t.synopsis ?? null, language: t.language, voice: t.voice }
  return { where: { slug: t.slug }, create: { slug: t.slug, ...meta, assets: { create: { kind: 'source' as const, s3Key: t.sourceS3Key, region } } }, update: meta }
}

export async function seedTitles(db: SeedDb, entries: readonly TitleSeed[], region: string): Promise<string[]> {
  const slugs = entries.map((e) => e.slug)
  const dup = slugs.find((s, i) => slugs.indexOf(s) !== i)
  if (dup) throw new Error(`titles.json: slug "${dup}" appears twice`)
  for (const t of entries) await db.title.upsert(titleUpsert(t, region))
  return slugs
}

export const TITLES_FILE = new URL('./titles.json', import.meta.url)
export const loadTitles = async (file: URL | string = TITLES_FILE) => z.array(TitleSeed).parse(JSON.parse(await readFile(file, 'utf8')))

/** `pnpm titles:seed` (root) — needs DATABASE_URL; no AWS call. The pipeline (`pnpm pipeline describe --title <slug> --source s3://…/<sourceS3Key>`) publishes each title. */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { PrismaClient } = await import('@prisma/client')
  const db = new PrismaClient()
  try {
    const slugs = await seedTitles(db, await loadTitles(), process.env.AWS_REGION ?? 'eu-central-1')
    console.log(`seeded ${slugs.length} titles: ${slugs.join(', ')}`)
  } finally { await db.$disconnect() }
}
