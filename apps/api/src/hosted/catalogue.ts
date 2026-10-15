import { z } from 'zod'

/**
 * The catalogue moved from the developer's database to the hosted copy (DESC-034): published titles with the rows the
 * viewer routes read — Title, Asset, Rendition, TextTrack and DescriptionCue. Nothing per device (Profile, Progress,
 * ListItem) and nothing only the pipeline reads (Job, Shot, Gap) is exported. Media stays on CloudFront; rows carry keys.
 */
export const CATALOGUE_VERSION = 1

const Asset = z.object({ id: z.string(), kind: z.enum(['source', 'mezzanine', 'shot', 'narration']), s3Key: z.string(), region: z.string(), bytes: z.number().int().nullable(), durationS: z.number().nullable() }).strict()
const Rendition = z.object({ id: z.string(), kind: z.enum(['audio_main', 'audio_ad']), language: z.string(), s3Key: z.string() }).strict()
const TextTrack = z.object({ id: z.string(), kind: z.enum(['captions', 'sdh', 'descriptions']), language: z.string(), s3Key: z.string(), cueCount: z.number().int() }).strict()
const Cue = z.object({ id: z.string(), startMs: z.number().int(), endMs: z.number().int(), text: z.string(), extended: z.boolean(), pollyKey: z.string().nullable(), wordCount: z.number().int() }).strict()
export const CatalogueTitle = z.object({
  id: z.string(), slug: z.string().regex(/^[a-z0-9-]{1,64}$/), name: z.string(), year: z.number().int().nullable(), license: z.string(), attribution: z.string(),
  durationS: z.number().nullable(), posterKey: z.string().nullable(), heroKey: z.string().nullable(), synopsis: z.string().nullable(),
  language: z.string(), voice: z.string(), status: z.literal('published'), createdAt: z.coerce.date(),
  assets: z.array(Asset), renditions: z.array(Rendition), tracks: z.array(TextTrack), cues: z.array(Cue),
}).strict()
export type CatalogueTitle = z.infer<typeof CatalogueTitle>
export const Catalogue = z.object({ version: z.literal(CATALOGUE_VERSION), exportedAt: z.coerce.date(), titles: z.array(CatalogueTitle) }).strict()
export type Catalogue = z.infer<typeof Catalogue>

/** Lambda's synchronous invoke payload limit is 6 MB (https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html); keep a margin. */
export const MAX_SEED_BYTES = 5_500_000

const titleSelect = {
  id: true, slug: true, name: true, year: true, license: true, attribution: true, durationS: true, posterKey: true, heroKey: true, synopsis: true,
  language: true, voice: true, status: true, createdAt: true,
  assets: { select: { id: true, kind: true, s3Key: true, region: true, bytes: true, durationS: true }, orderBy: { id: 'asc' as const } },
  renditions: { select: { id: true, kind: true, language: true, s3Key: true }, orderBy: { id: 'asc' as const } },
  tracks: { select: { id: true, kind: true, language: true, s3Key: true, cueCount: true }, orderBy: { id: 'asc' as const } },
  cues: { select: { id: true, startMs: true, endMs: true, text: true, extended: true, pollyKey: true, wordCount: true }, orderBy: [{ startMs: 'asc' as const }, { endMs: 'asc' as const }, { id: 'asc' as const }] },
}

/** What the export needs of Prisma's client, structurally (tests pass a fake). */
export interface ExportDb { title: { findMany(args: { where: { status: 'published' }; orderBy: { slug: 'asc' }; select: typeof titleSelect }): Promise<unknown[]> } }

/** Published titles only; the schema refuses anything else, so a draft can never reach the hosted copy. */
export async function exportCatalogue(db: ExportDb, now = new Date()): Promise<Catalogue> {
  const rows = await db.title.findMany({ where: { status: 'published' }, orderBy: { slug: 'asc' }, select: titleSelect })
  return Catalogue.parse({ version: CATALOGUE_VERSION, exportedAt: now, titles: rows })
}

/** The `aws lambda invoke` payload for the hosted function's seed operation (apps/api/src/lambda.ts). */
export const seedEvent = (c: Catalogue) => ({ op: 'seed' as const, catalogue: c })

type Data<T> = { data: T }
/** What the import needs of Prisma's transaction client, structurally. */
export interface ImportTx {
  title: {
    upsert(args: { where: { slug: string }; create: Record<string, unknown>; update: Record<string, unknown>; select: { id: true } }): Promise<{ id: string }>
    updateMany(args: { where: { slug: { notIn: string[] }; status: 'published' }; data: { status: 'draft' } }): Promise<{ count: number }>
  }
  asset: { deleteMany(a: { where: { titleId: string } }): Promise<unknown>; createMany(a: Data<Record<string, unknown>[]>): Promise<unknown> }
  rendition: { deleteMany(a: { where: { titleId: string } }): Promise<unknown>; createMany(a: Data<Record<string, unknown>[]>): Promise<unknown> }
  textTrack: { deleteMany(a: { where: { titleId: string } }): Promise<unknown>; createMany(a: Data<Record<string, unknown>[]>): Promise<unknown> }
  descriptionCue: { deleteMany(a: { where: { titleId: string } }): Promise<unknown>; createMany(a: Data<Record<string, unknown>[]>): Promise<unknown> }
}
export interface ImportDb { $transaction<R>(fn: (tx: ImportTx) => Promise<R>, opts?: { timeout?: number }): Promise<R> }

export interface ImportSummary { titles: string[]; cues: number; hidden: number }

/**
 * Makes the hosted catalogue match the export, in one transaction. A title is matched by slug and keeps the hosted id, so
 * devices' progress and My list rows survive a re-seed; its child rows are replaced. A published hosted title missing from
 * the export goes back to draft (hidden, its device rows kept), as it is no longer published on the developer's side.
 */
export async function importCatalogue(db: ImportDb, input: unknown): Promise<ImportSummary> {
  const c = Catalogue.parse(input)
  const slugs = c.titles.map((t) => t.slug)
  const dup = slugs.find((s, i) => slugs.indexOf(s) !== i)
  if (dup) throw new Error(`catalogue: slug "${dup}" appears twice`)
  return db.$transaction(async (tx) => {
    let cues = 0
    for (const { assets, renditions, tracks, cues: cueRows, id, ...meta } of c.titles) {
      const { id: titleId } = await tx.title.upsert({ where: { slug: meta.slug }, create: { id, ...meta }, update: meta, select: { id: true } })
      for (const table of [tx.asset, tx.rendition, tx.textTrack, tx.descriptionCue]) await table.deleteMany({ where: { titleId } })
      const own = <T extends object>(rows: T[]) => rows.map((r) => ({ ...r, titleId }))
      if (assets.length) await tx.asset.createMany({ data: own(assets) })
      if (renditions.length) await tx.rendition.createMany({ data: own(renditions) })
      if (tracks.length) await tx.textTrack.createMany({ data: own(tracks) })
      if (cueRows.length) await tx.descriptionCue.createMany({ data: own(cueRows) })
      cues += cueRows.length
    }
    const { count: hidden } = await tx.title.updateMany({ where: { slug: { notIn: slugs }, status: 'published' }, data: { status: 'draft' } })
    return { titles: slugs, cues, hidden }
  }, { timeout: 60_000 })
}
