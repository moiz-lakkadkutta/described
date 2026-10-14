import { execa } from 'execa'
import { access, mkdir } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { persistForCli } from './cues'
import { cutArgs, isHttps, parseOwnArgs, probeArgs, runOwn, type OwnDeps } from './own'
import { listKeys, upload } from './s3'
import { runDescribe } from './steps'

/**
 * Entry for `pnpm describe …` (root package.json → `pnpm --filter @described/pipeline own`).
 * S3 PutObject via ../s3 upload — https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html
 * S3 ListObjectsV2 via ../s3 listKeys — https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html
 * CloudFront CreateInvalidation via 10-publish (PUBLISH_INVALIDATE=1) — https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_CreateInvalidation.html
 */

/** Pure (tested). pnpm runs the script in packages/pipeline, so a relative path is resolved where the command was typed (INIT_CWD, set by pnpm). */
export const resolveInput = (input: string, env: Record<string, string | undefined>, cwd: string) => (isHttps(input) ? input : resolve(env.INIT_CWD ?? cwd, input))

/** The y/N question; outside a terminal it never asks and answers no (a pipe or CI must pass --yes). */
export const confirmOn = (input: NodeJS.ReadableStream & { isTTY?: boolean }, output: NodeJS.WritableStream) => async (q: string) => {
  if (!input.isTTY) { output.write('not a terminal: add --yes to run without the question\n'); return false }
  const rl = createInterface({ input, output })
  try { return /^y(es)?$/i.test((await rl.question(q)).trim()) } finally { rl.close() }
}

const prisma = async () => new (await import('@prisma/client')).PrismaClient()

export const deps: OwnDeps = {
  env: process.env,
  log: (l) => console.log(l),
  async probe(input) {
    if (!isHttps(input)) await access(input).catch(() => { throw new Error(`no such file: ${input}`) })
    const { stdout } = await execa('ffprobe', probeArgs(input))
    const j = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type?: string }[] }
    const durationS = Number(j.format?.duration)
    if (!Number.isFinite(durationS) || durationS <= 0) throw new Error(`ffprobe found no duration in ${input}`)
    return { durationS, hasVideo: !!j.streams?.some((s) => s.codec_type === 'video'), hasAudio: !!j.streams?.some((s) => s.codec_type === 'audio') }
  },
  async slugInDb(slug, sourceKey) {
    const db = await prisma()
    try {
      const title = !!(await db.title.findUnique({ where: { slug }, select: { id: true } }))
      const owner = await db.asset.findFirst({ where: { s3Key: sourceKey, title: { slug: { not: slug } } }, select: { title: { select: { slug: true } } } })
      return { title, keyOwner: owner?.title.slug ?? null }
    } finally { await db.$disconnect() }
  },
  s3Keys: (prefix) => listKeys(process.env.S3_BUCKET_MEDIA!, prefix),
  confirm: confirmOn(process.stdin, process.stdout),
  async prepare(input, out, span) {
    if (!span && !isHttps(input) && extname(input).toLowerCase() === '.mp4') return input
    await mkdir(dirname(out), { recursive: true })
    await execa('ffmpeg', cutArgs(input, out, span), { stdio: 'inherit' })
    return out
  },
  upload: (file, uri) => upload(file, uri, { ContentType: 'video/mp4' }),
  async register(args) {
    const db = await prisma()
    try { await db.title.upsert(args) } finally { await db.$disconnect() }
  },
  describe: (input, how) => {
    if (how.invalidate) process.env.PUBLISH_INVALIDATE = '1' // read by 10-publish
    return runDescribe(input)
  },
  persist: (slug, work, spoken) => persistForCli(slug, work, spoken),
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const o = parseOwnArgs(process.argv.slice(2))
    o.input = resolveInput(o.input, process.env, process.cwd())
    await runOwn(o, deps)
    process.exit(0)
  } catch (e) {
    console.error((e as Error).message)
    process.exit(1)
  }
}
