import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { cacheControl, contentType, createInvalidation, upload as s3Upload } from '../s3'
import { clipHash, cueAudioKey, trackClipFile, writeClips } from '../cues'
import type { Ctx } from './index'
import type { PackageReport } from './09-package'
export interface PublishDeps { upload?: typeof s3Upload; invalidate?: (distributionId: string, paths: string[]) => Promise<void> }

/**
 * Upload HLS + whole-file VTTs + per-cue Polly audio + work/art/*.jpg (poster, hero; 01-probe) to S3 /published/{slug}/
 * (served by CloudFront), then write work/{slug}/clips.json (cues.json index → published key) for the DescriptionCue rows: the
 * worker writes them, with the Rendition and TextTrack rows and the art keys, in persist('finish') (src/jobs.ts), the CLI after
 * the run (ids and order in ../cues). Extended cues are not in the AD mix: the app plays their clip through
 * GET /titles/:slug/cues/d{n}/audio (DESC-007). The clip published is cue_{i}.track.mp3 (07-mix: at the track's narration
 * level) when the work dir has it, else the Polly clip.
 * Per object: ContentType by extension; CacheControl (../s3 cacheControl) 60 s for playlists, VTTs and art (CloudFront's
 * CachingOptimized policy honours the origin header), a year + immutable for segments, init files and MP3s. work/hls is
 * rebuilt from empty by 09-package, so no stale segment is uploaded. Re-runs reuse segment names, so use a fresh slug, or set
 * PUBLISH_INVALIDATE=1 with CLOUDFRONT_DISTRIBUTION_ID to invalidate `/published/<slug>/*` after the uploads (off by default:
 * invalidation paths beyond the free 1,000 a month are billed).
 * Whole-file VTTs are what the API's `GET /titles/:slug/descriptions.vtt` and the kit's `x-kit-text-urls` read.
 */
export async function publish(ctx: Ctx, { upload = s3Upload, invalidate = createInvalidation }: PublishDeps = {}) {
  const base = `s3://${process.env.S3_BUCKET_MEDIA!}/published/${ctx.slug}`
  const hls = `${ctx.work}/hls`
  const files = (await readdir(hls, { recursive: true, withFileTypes: true })).filter((d) => d.isFile()).map((d) => join(d.parentPath, d.name))
  const jobs = files.map((f) => () => upload(f, `${base}/${relative(hls, f)}`, { ContentType: contentType(f), CacheControl: cacheControl(f) }))
  // Only the text tracks 09-package advertised (package.json): a degraded sdh.vtt has no TextTrack row and is not in the master, so it
  // is not published either. Without package.json (tests that publish alone) all three go up.
  const advertised = (JSON.parse(await readFile(`${ctx.work}/package.json`, 'utf8').catch(() => '{}')) as Partial<PackageReport>).tracks
  for (const v of (['captions', 'sdh', 'descriptions'] as const).filter((k) => advertised?.[k] !== false).map((k) => `${k}.vtt`)) jobs.push(() => upload(`${ctx.work}/${v}`, `${base}/${v}`, { ContentType: contentType(v), CacheControl: cacheControl(v) }))
  const art = await readdir(`${ctx.work}/art`).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return [] as string[]; throw e })
  for (const a of art.filter((f) => f.endsWith('.jpg'))) jobs.push(() => upload(`${ctx.work}/art/${a}`, `${base}/art/${a}`, { ContentType: contentType(a), CacheControl: cacheControl(a) }))
  // Clip keys carry a hash of the bytes (../cues): immutable for a year, so a changed clip must get a new key.
  const clips = new Map<number, string>()
  // Only this run's cues: a cue_{i}.mp3 left over from an earlier, longer run (i ≥ cues.json length) is not published.
  const count = (JSON.parse(await readFile(`${ctx.work}/cues.json`, 'utf8')) as unknown[]).length
  // The app plays the clip at the track's narration level (07-mix cue_{i}.track.mp3), so a pause speaks in the voice the track
  // does. A levelled clip older than its Polly clip (voice re-ran after the mix) is stale and not used; with none, or a stale
  // one, the Polly clip goes up and publish says so (re-run --from mix to level it).
  const raw = (await readdir(ctx.work)).filter((f) => /^cue_\d+\.mp3$/.test(f) && Number(/\d+/.exec(f)![0]) < count)
  const mtime = (f: string) => stat(`${ctx.work}/${f}`).then((s) => s.mtimeMs, () => null)
  let unlevelled = 0
  for (const r of raw) {
    const i = Number(/\d+/.exec(r)![0]), levelled = await mtime(trackClipFile(i))
    const f = levelled !== null && levelled >= (await mtime(r))! ? trackClipFile(i) : r
    if (f === r) unlevelled++
    const key = cueAudioKey(ctx.slug, i, clipHash(await readFile(`${ctx.work}/${f}`)))
    clips.set(i, key)
    jobs.push(() => upload(`${ctx.work}/${f}`, `s3://${process.env.S3_BUCKET_MEDIA!}/${key}`, { ContentType: contentType(f), CacheControl: cacheControl(f) }))
  }
  if (unlevelled) console.warn(`publish: ${unlevelled} of ${raw.length} clips have no current cue_{i}.track.mp3 (missing, or older than the Polly clip) and go up as Polly made them (louder than the track); re-run --from mix to level them`)
  for (let i = 0; i < jobs.length; i += 8) await Promise.all(jobs.slice(i, i + 8).map((j) => j()))
  await writeClips(ctx.work, clips)
  const distribution = process.env.CLOUDFRONT_DISTRIBUTION_ID
  if (process.env.PUBLISH_INVALIDATE === '1') {
    if (distribution) await invalidate(distribution, [`/published/${ctx.slug}/*`])
    else console.warn('PUBLISH_INVALIDATE=1 but CLOUDFRONT_DISTRIBUTION_ID is not set: nothing invalidated')
  }
  console.log(`published: https://${process.env.CLOUDFRONT_DOMAIN}/published/${ctx.slug}/master.m3u8`)
}

