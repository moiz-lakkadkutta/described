import { execa } from 'execa'
import type { Ctx } from './index'
/** Sync HLS + VTT + per-cue Polly audio to S3 /published/{slug}/ (served by CloudFront); DB rows written by the worker (DESC-004). */
export async function publish(ctx: Ctx) {
  const bucket = process.env.S3_BUCKET_MEDIA!
  await execa('aws', ['s3', 'sync', `${ctx.work}/hls`, `s3://${bucket}/published/${ctx.slug}/`, '--delete', '--cache-control', 'public,max-age=31536000,immutable'], { stdio: 'inherit' })
  await execa('aws', ['s3', 'cp', `${ctx.work}/hls/master.m3u8`, `s3://${bucket}/published/${ctx.slug}/master.m3u8`, '--cache-control', 'public,max-age=60', '--content-type', 'application/vnd.apple.mpegurl'], { stdio: 'inherit' })
  await execa('bash', ['-c', `for f in ${ctx.work}/cue_*.mp3; do aws s3 cp "$f" s3://${bucket}/published/${ctx.slug}/cues/; done`], { stdio: 'inherit' })
  console.log(`published: https://${process.env.CLOUDFRONT_DOMAIN}/published/${ctx.slug}/master.m3u8`)
}
