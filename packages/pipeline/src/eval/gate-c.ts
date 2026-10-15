import { resolve } from 'node:path'
import { Command, InvalidArgumentError } from 'commander'
import { meter, metered } from '../cost'
import { runStep } from '../steps'
import { execa } from 'execa'
import { cutArgs } from '../own'
import { readFile } from 'node:fs/promises'
import { download, listKeys, upload } from '../s3'
import { resolveLanguageAndVoice } from '../steps/06-voice'
import { buildPackets } from './packets'
import { DEFAULT_PREPARE_CAP_USD, prepareGateC } from './prepare'
import { CapExceeded, DEFAULT_CAP_USD, EVAL_STEPS, parseSteps, runGateC } from './run'
import { parseShotList, scoreDir } from './score'

/**
 * `pnpm gate-c …` (root package.json → `pnpm --filter @described/pipeline gate-c`) — the Gate C evaluation, reproducible from the repo
 * (DESC-030, docs/evaluation.md). pnpm runs this in packages/pipeline, so work dirs are packages/pipeline/work/{slug} unless --work names
 * another root; a relative --work or out dir is resolved where the command was typed (INIT_CWD), the default `work` in packages/pipeline.
 * Bedrock Converse (describe, verify, fit/edit shortening) — https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
 * Polly SynthesizeSpeech (voice) — https://docs.aws.amazon.com/polly/latest/dg/API_SynthesizeSpeech.html
 * Transcribe StartTranscriptionJob and S3 PutObject/GetObject (prepare) — see ./prepare.ts
 * S3 ListObjectsV2 (prepare's slug check) — https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html
 */
const WORK_OPT = ['--work <dir>', 'the work root holding <slug>/ folders (default: packages/pipeline/work)'] as const
const workRoot = (o: { work?: string }) => (o.work ? here(o.work) : resolve('work'))
/** The catalogue (seeded into Title rows by apps/api seed:titles). */
const CATALOGUE = resolve('../../apps/api/prisma/titles.json')
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)
const usd = (v: string) => { const n = Number(v); if (!(Number.isFinite(n) && n > 0)) throw new InvalidArgumentError('a positive number of USD'); return n }
const int = (v: string) => { const n = Number(v); if (!Number.isInteger(n)) throw new InvalidArgumentError('an integer'); return n }

const program = new Command('gate-c').description('Gate C evaluation: run the quality steps on a copy, build blind rater packets, score them')

program.command('run <sourceSlug> <evalSlug>')
  .description(`copy work/<sourceSlug>'s step inputs into work/<evalSlug> and run only the named steps there (never publish, never the DB)`)
  .option('--steps <list>', `comma-separated, consecutive, from ${EVAL_STEPS.join(',')}`, EVAL_STEPS.join(','))
  .option('--cap <usd>', 'hard spend cap in USD', usd, DEFAULT_CAP_USD)
  .option('--dry-run', 'print what would be copied and run; copy nothing, call nothing')
  .option('--keep-gaps', 'keep the copied gaps.json; by default the copy\'s gaps are rebuilt from words.json with the voice-activity split (decision 0014; no Transcribe)')
  .option('--lang <en|de>', 'description language (as pnpm pipeline describe)')
  .option('--voice <name>', 'Polly voice (default POLLY_VOICE_EN/DE, else Joanna/Vicki)')
  .option(...WORK_OPT)
  .action(async (sourceSlug: string, evalSlug: string, o: { steps: string; cap: number; dryRun?: boolean; keepGaps?: boolean; work?: string; lang?: string; voice?: string }) => {
    const WORK_ROOT = workRoot(o)
    try {
      const r = await runGateC({ workRoot: WORK_ROOT, sourceSlug, evalSlug, steps: parseSteps(o.steps), cap: o.cap, dryRun: o.dryRun, keepGaps: o.keepGaps, ...resolveLanguageAndVoice(o) },
        { runStep, metered, meter, log: (l) => console.log(l) })
      if (!o.dryRun) console.log(`total: $${r.totalUsd.toFixed(4)}; next: pnpm gate-c packets ${evalSlug} <outDir> --raters 3`)
    } catch (e) {
      const spent = e instanceof CapExceeded ? e.spentUsd : (e as { costUsd?: number }).costUsd
      console.error(`stopped: ${(e as Error).message}${spent !== undefined ? ` (spent $${spent.toFixed(4)})` : ''}`)
      process.exitCode = e instanceof CapExceeded ? 2 : 1
    }
  })

program.command('prepare <input> <slug>')
  .description('cut a NEW segment (https URL, s3:// URI or local file) and run probe → shots → speech into work/<slug>; a source for `run`')
  .requiredOption('--start <time>', 'segment start in the film (mm:ss, h:mm:ss or seconds)')
  .requiredOption('--end <time>', 'segment end in the film')
  .option('--cap <usd>', 'hard spend cap in USD', usd, DEFAULT_PREPARE_CAP_USD)
  .option('--dry-run', 'print the cut, the steps and the estimate; cut nothing, call nothing')
  .option('--lang <en|de>', 'transcript language')
  .option('--credit <text>', 'the film\'s credit, carried into the packets (default for the Tears of Steel download: its CC-BY credit)')
  .option(...WORK_OPT)
  .action(async (input: string, slug: string, o: { start: string; end: string; cap: number; dryRun?: boolean; work?: string; lang?: string; credit?: string }) => {
    const src = input.startsWith('s3://') || /^https:\/\//i.test(input) ? input : here(input)
    try {
      const r = await prepareGateC({ workRoot: workRoot(o), input: src, slug, start: o.start, end: o.end, cap: o.cap, dryRun: o.dryRun, credit: o.credit, ...resolveLanguageAndVoice(o) }, {
        runStep, metered, meter, log: (l) => console.log(l), env: process.env,
        cut: async (i, out, span) => { await execa('ffmpeg', cutArgs(i, out, span), { stdio: 'inherit' }) },
        download: (uri, file) => download(uri, file),
        upload: (file, uri) => upload(file, uri, { ContentType: 'video/mp4' }),
        catalogueSlugs: async () => (JSON.parse(await readFile(CATALOGUE, 'utf8')) as { slug: string }[]).map((t) => t.slug),
        titleInDb: async (s) => {
          const db = new (await import('@prisma/client')).PrismaClient()
          try { return !!(await db.title.findUnique({ where: { slug: s }, select: { id: true } })) } finally { await db.$disconnect() }
        },
        s3Keys: (prefix) => listKeys(process.env.S3_BUCKET_MEDIA!, prefix),
      })
      if (!o.dryRun) console.log(`total: $${r.totalUsd.toFixed(4)}; next: pnpm gate-c run ${slug} ${slug}-<run> --dry-run`)
    } catch (e) {
      const spent = e instanceof CapExceeded ? e.spentUsd : (e as { costUsd?: number }).costUsd
      console.error(`stopped: ${(e as Error).message}${spent !== undefined ? ` (spent $${spent.toFixed(4)})` : ''}`)
      process.exitCode = e instanceof CapExceeded ? 2 : 1
    }
  })

program.command('packets <evalSlug> <outDir>')
  .description('build N byte-identical blind rater packets from work/<evalSlug> into <outDir>/rater1 … raterN')
  .option('--raters <n>', 'number of raters (odd)', int, 3)
  .option('--offset <seconds>', 'where the segment starts in the film, for the timecodes on the sheets', Number, 0)
  .option('--title <text>', 'heading of shots.md (keep it free of model or run names: the packets are blind)', 'Gate C clip')
  .option('--credit <text>', 'credit line in shots.md (default: the one recorded by gate-c prepare)')
  .option(...WORK_OPT)
  .action(async (evalSlug: string, outDir: string, o: { raters: number; offset: number; title: string; work?: string; credit?: string }) => {
    const WORK_ROOT = workRoot(o)
    const out = here(outDir)
    const r = await buildPackets({ work: resolve(WORK_ROOT, evalSlug), outDir: out, raters: o.raters, offsetMs: Math.round(o.offset * 1000), title: o.title, credit: o.credit })
    console.log(`${o.raters} packets, ${r.shots} shots, identical (sha256 ${r.sha256.slice(0, 12)}) in ${out}; give each rater only their own rater<k>/ folder`)
  })

program.command('score <outDir>')
  .description('read <outDir>/rater*/scores.md and print usable counts, the majority-usable score, agreement and disagreements; with <outDir>/corrections.md, also the corrected result')
  .option('--skip <shots>', 'same-as-previous shots to leave unrated, for a packet.json written before skipShots (e.g. 16 or 3,16)', (v: string) => {
    try { return parseShotList(v) } catch (e) { throw new InvalidArgumentError((e as Error).message) }
  })
  .option('--corrections <file>', 'the scorer\'s corrections (default: <outDir>/corrections.md when it exists)')
  .action(async (outDir: string, o: { skip?: number[]; corrections?: string }) => {
    const r = await scoreDir(here(outDir), { skip: o.skip, corrections: o.corrections && here(o.corrections) })
    for (const l of r.lines) console.log(l)
    if (r.exitCode) process.exitCode = r.exitCode
  })

program.parseAsync().catch((e: unknown) => { console.error((e as Error).message); process.exit(1) })
