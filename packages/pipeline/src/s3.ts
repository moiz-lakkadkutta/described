import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { extname } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/**
 * S3 via the SDK, not the CLI: one credential chain shared with Bedrock/Polly/Transcribe, per-object ContentType/CacheControl,
 * and no dependency on a binary being on PATH in the worker. One client per region (media eu-central-1, Nova ingest us-east-1).
 * GetObject: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/command/GetObjectCommand/
 * Upload (PutObject, multipart when large): https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-lib-storage/
 */
const clients = new Map<string, S3Client>()
export const s3 = (region = process.env.AWS_REGION ?? 'eu-central-1') => clients.get(region) ?? clients.set(region, new S3Client({ region })).get(region)!

export function parseS3Uri(uri: string): { Bucket: string; Key: string } {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri)
  if (!m) throw new Error(`not an s3:// uri: ${uri}`)
  return { Bucket: m[1]!, Key: m[2]! }
}

/** s3://… → local file, streamed (sources can be GBs). */
export async function download(uri: string, file: string, region?: string) {
  const r = await s3(region).send(new GetObjectCommand(parseS3Uri(uri)))
  await pipeline(r.Body as Readable, createWriteStream(file))
}

/** local file → s3://… with an explicit ContentType (Nova requires it on video) and optional CacheControl. */
export async function upload(file: string, uri: string, opts: { ContentType: string; CacheControl?: string; region?: string }) {
  const { region, ...meta } = opts
  await new Upload({ client: s3(region), params: { ...parseS3Uri(uri), Body: createReadStream(file), ...meta } }).done()
}

const CONTENT_TYPES: Record<string, string> = { '.m3u8': 'application/vnd.apple.mpegurl', '.m4s': 'video/iso.segment', '.mp4': 'video/mp4', '.vtt': 'text/vtt', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.json': 'application/json', '.jpg': 'image/jpeg' }
export const contentType = (file: string) => CONTENT_TYPES[extname(file)] ?? 'application/octet-stream'
/**
 * 60 s for whatever a re-run rewrites under the same name: playlists, VTTs (whole-file and segmented) and art. A year +
 * immutable for media segments, init files and MP3s (cue clips carry a hash of their bytes in the key, ../cues).
 */
const SHORT = new Set(['.m3u8', '.vtt', '.jpg'])
export const cacheControl = (file: string) => (SHORT.has(extname(file)) ? 'public,max-age=60' : 'public,max-age=31536000,immutable')

/**
 * CloudFront CreateInvalidation (opt-in from 10-publish: the first 1,000 paths a month are free, then $0.005 each; one
 * wildcard path per publish). CallerReference must be unique per request. CloudFront is a global service (us-east-1).
 * https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_CreateInvalidation.html
 * https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/cloudfront/command/CreateInvalidationCommand/
 * https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/PayingForInvalidation.html
 */
export async function createInvalidation(distributionId: string, paths: string[], client: Pick<CloudFrontClient, 'send'> = new CloudFrontClient({ region: 'us-east-1' })) {
  await client.send(new CreateInvalidationCommand({ DistributionId: distributionId, InvalidationBatch: { CallerReference: randomUUID(), Paths: { Quantity: paths.length, Items: paths } } }))
}
