import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { cacheControl, contentType, upload as s3Upload } from '../s3'
import { cueAudioKey, descriptionCueRows, type DescriptionCueRow } from '../cues'
import type { Ctx } from './index'
import type { FitCue } from './05-fit'
/** The DescriptionCue rows publish replaces, structurally (Prisma's client satisfies it). */
export interface CueDb {
  title: { findUnique(a: { where: { slug: string }; select: { id: true } }): Promise<{ id: string } | null> }
  descriptionCue: { deleteMany(a: { where: { titleId: string } }): unknown; createMany(a: { data: DescriptionCueRow[] }): unknown }
  $transaction(ops: unknown[]): Promise<unknown>
}
export interface PublishDeps { upload?: typeof s3Upload; db?: CueDb }

/**
 * Upload HLS + whole-file VTTs + per-cue Polly audio to S3 /published/{slug}/ (served by CloudFront), then replace the title's
 * DescriptionCue rows (one per cue, pollyKey = its published clip; ids and order in ../cues). Extended cues are not in the AD
 * mix: the app plays their clip through GET /titles/:slug/cues/d{n}/audio (DESC-007). Other rows (Rendition, TextTrack): DESC-004.
 * Per object: ContentType by extension; CacheControl 60 s for every playlist (CloudFront's CachingOptimized
 * policy honours the origin header) and a year + immutable for segments, init files, VTTs and MP3s. Re-runs reuse segment names,
 * so use a fresh slug or invalidate `/published/<slug>/*` by hand (CLOUDFRONT_DISTRIBUTION_ID).
 * Whole-file VTTs are what the API's `GET /titles/:slug/descriptions.vtt` and the kit's `x-kit-text-urls` read.
 */
export async function publish(ctx: Ctx, { upload = s3Upload, db }: PublishDeps = {}) {
  const base = `s3://${process.env.S3_BUCKET_MEDIA!}/published/${ctx.slug}`
  const hls = `${ctx.work}/hls`
  const files = (await readdir(hls, { recursive: true, withFileTypes: true })).filter((d) => d.isFile()).map((d) => join(d.parentPath, d.name))
  const jobs = files.map((f) => () => upload(f, `${base}/${relative(hls, f)}`, { ContentType: contentType(f), CacheControl: cacheControl(f) }))
  for (const v of ['captions.vtt', 'sdh.vtt', 'descriptions.vtt']) jobs.push(() => upload(`${ctx.work}/${v}`, `${base}/${v}`, { ContentType: contentType(v), CacheControl: cacheControl(v) }))
  const clips = (await readdir(ctx.work)).filter((f) => /^cue_\d+\.mp3$/.test(f))
  for (const f of clips) jobs.push(() => upload(`${ctx.work}/${f}`, `s3://${process.env.S3_BUCKET_MEDIA!}/${cueAudioKey(ctx.slug, Number(/\d+/.exec(f)![0]))}`, { ContentType: contentType(f), CacheControl: cacheControl(f) }))
  for (let i = 0; i < jobs.length; i += 8) await Promise.all(jobs.slice(i, i + 8).map((j) => j()))
  await writeDescriptionCues(ctx, new Set(clips), db)
  console.log(`published: https://${process.env.CLOUDFRONT_DOMAIN}/published/${ctx.slug}/master.m3u8`)
}

/** Replaces the title's DescriptionCue rows from cues.json, after the clips are up (a row's pollyKey must resolve). */
export async function writeDescriptionCues(ctx: Ctx, clips: ReadonlySet<string>, db?: CueDb) {
  if (!db && !process.env.DATABASE_URL) { console.warn('publish: no DATABASE_URL, DescriptionCue rows not written'); return }
  const own = db ? null : new (await import('@prisma/client')).PrismaClient()
  const client = db ?? (own as unknown as CueDb)
  try {
    const t = await client.title.findUnique({ where: { slug: ctx.slug }, select: { id: true } })
    if (!t) { console.warn(`publish: no Title row for ${ctx.slug}, DescriptionCue rows not written`); return }
    const cues = JSON.parse(await readFile(`${ctx.work}/cues.json`, 'utf8')) as FitCue[]
    const rows = descriptionCueRows(t.id, ctx.slug, cues, clips)
    await client.$transaction([client.descriptionCue.deleteMany({ where: { titleId: t.id } }), client.descriptionCue.createMany({ data: rows })])
  } finally { await own?.$disconnect() }
}
