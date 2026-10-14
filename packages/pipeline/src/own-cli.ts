import { execa } from 'execa'
import { access, mkdir } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { persistForCli } from './cues'
import { parseOwnArgs, runOwn, cutArgs, type OwnDeps } from './own'
import { upload } from './s3'
import { runDescribe } from './steps'

/**
 * Entry for `pnpm describe …` (root package.json → `pnpm --filter @described/pipeline own`). pnpm runs this in packages/pipeline,
 * so a relative input path is resolved against the directory the command was typed in (INIT_CWD, set by pnpm).
 * S3 PutObject via ../s3 upload — https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html
 */
const isUrl = (s: string) => /^https:\/\//i.test(s)

const deps: OwnDeps = {
  env: process.env,
  log: (l) => console.log(l),
  async probe(input) {
    if (!isUrl(input)) await access(input).catch(() => { throw new Error(`no such file: ${input}`) })
    const { stdout } = await execa('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input])
    const j = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type?: string }[] }
    const durationS = Number(j.format?.duration)
    if (!Number.isFinite(durationS) || durationS <= 0) throw new Error(`ffprobe found no duration in ${input}`)
    return { durationS, hasVideo: !!j.streams?.some((s) => s.codec_type === 'video'), hasAudio: !!j.streams?.some((s) => s.codec_type === 'audio') }
  },
  async titleExists(slug) {
    const db = new (await import('@prisma/client')).PrismaClient()
    try { return !!(await db.title.findUnique({ where: { slug }, select: { id: true } })) } finally { await db.$disconnect() }
  },
  async confirm(q) {
    if (!process.stdin.isTTY) { console.log('not a terminal: add --yes to run without the question'); return false }
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try { return /^y(es)?$/i.test((await rl.question(q)).trim()) } finally { rl.close() }
  },
  async prepare(input, out, span) {
    if (!span && !isUrl(input) && extname(input).toLowerCase() === '.mp4') return input
    await mkdir(dirname(out), { recursive: true })
    await execa('ffmpeg', cutArgs(input, out, span), { stdio: 'inherit' })
    return out
  },
  upload: (file, uri) => upload(file, uri, { ContentType: 'video/mp4' }),
  async register(args) {
    const db = new (await import('@prisma/client')).PrismaClient()
    try { await db.title.upsert(args) } finally { await db.$disconnect() }
  },
  describe: (input) => runDescribe(input),
  persist: (slug, work, spoken) => persistForCli(slug, work, spoken),
}

try {
  const o = parseOwnArgs(process.argv.slice(2))
  if (!isUrl(o.input)) o.input = resolve(process.env.INIT_CWD ?? process.cwd(), o.input)
  await runOwn(o, deps)
  process.exit(0)
} catch (e) {
  console.error((e as Error).message)
  process.exit(1)
}
