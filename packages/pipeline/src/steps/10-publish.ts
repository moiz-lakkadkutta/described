import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { cacheControl, contentType, upload } from '../s3'
import type { Ctx } from './index'
/**
 * Upload HLS + whole-file VTTs + per-cue Polly audio to S3 /published/{slug}/ (served by CloudFront); DB rows are written by the
 * worker (DESC-004). Per object: ContentType by extension; CacheControl 60 s for every playlist (CloudFront's CachingOptimized
 * policy honours the origin header) and a year + immutable for segments, init files, VTTs and MP3s. Re-runs reuse segment names,
 * so use a fresh slug or invalidate `/published/<slug>/*` by hand (CLOUDFRONT_DISTRIBUTION_ID).
 * Whole-file VTTs are what the API's `GET /titles/:slug/descriptions.vtt` and the kit's `x-kit-text-urls` read.
 */
export async function publish(ctx: Ctx) {
  const base = `s3://${process.env.S3_BUCKET_MEDIA!}/published/${ctx.slug}`
  const hls = `${ctx.work}/hls`
  const files = (await readdir(hls, { recursive: true, withFileTypes: true })).filter((d) => d.isFile()).map((d) => join(d.parentPath, d.name))
  const jobs = files.map((f) => () => upload(f, `${base}/${relative(hls, f)}`, { ContentType: contentType(f), CacheControl: cacheControl(f) }))
  for (const v of ['captions.vtt', 'sdh.vtt', 'descriptions.vtt']) jobs.push(() => upload(`${ctx.work}/${v}`, `${base}/${v}`, { ContentType: contentType(v), CacheControl: cacheControl(v) }))
  for (const f of (await readdir(ctx.work)).filter((f) => /^cue_\d+\.mp3$/.test(f))) jobs.push(() => upload(`${ctx.work}/${f}`, `${base}/cues/${f}`, { ContentType: contentType(f), CacheControl: cacheControl(f) }))
  for (let i = 0; i < jobs.length; i += 8) await Promise.all(jobs.slice(i, i + 8).map((j) => j()))
  console.log(`published: https://${process.env.CLOUDFRONT_DOMAIN}/published/${ctx.slug}/master.m3u8`)
}
