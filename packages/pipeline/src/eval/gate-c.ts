import { resolve } from 'node:path'
import { Command, InvalidArgumentError } from 'commander'
import { meter, metered } from '../cost'
import { runStep } from '../steps'
import { buildPackets } from './packets'
import { CapExceeded, DEFAULT_CAP_USD, EVAL_STEPS, parseSteps, runGateC } from './run'
import { formatSummary, readRaters, summarise } from './score'

/**
 * `pnpm gate-c …` (root package.json → `pnpm --filter @described/pipeline gate-c`) — the Gate C evaluation, reproducible from the repo
 * (DESC-030, docs/evaluation.md). pnpm runs this in packages/pipeline, so work dirs are packages/pipeline/work/{slug} unless --work names
 * another root; a relative --work or out dir is resolved where the command was typed (INIT_CWD), the default `work` in packages/pipeline.
 * Bedrock Converse (describe, verify, fit/edit shortening) — https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
 * Polly SynthesizeSpeech (voice) — https://docs.aws.amazon.com/polly/latest/dg/API_SynthesizeSpeech.html
 */
const WORK_OPT = ['--work <dir>', 'the work root holding <slug>/ folders (default: packages/pipeline/work)'] as const
const workRoot = (o: { work?: string }) => (o.work ? here(o.work) : resolve('work'))
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)
const usd = (v: string) => { const n = Number(v); if (!(Number.isFinite(n) && n > 0)) throw new InvalidArgumentError('a positive number of USD'); return n }
const int = (v: string) => { const n = Number(v); if (!Number.isInteger(n)) throw new InvalidArgumentError('an integer'); return n }

const program = new Command('gate-c').description('Gate C evaluation: run the quality steps on a copy, build blind rater packets, score them')

program.command('run <sourceSlug> <evalSlug>')
  .description(`copy work/<sourceSlug>'s step inputs into work/<evalSlug> and run only the named steps there (never publish, never the DB)`)
  .option('--steps <list>', `comma-separated, consecutive, from ${EVAL_STEPS.join(',')}`, EVAL_STEPS.join(','))
  .option('--cap <usd>', 'hard spend cap in USD', usd, DEFAULT_CAP_USD)
  .option('--dry-run', 'print what would be copied and run; copy nothing, call nothing')
  .option(...WORK_OPT)
  .action(async (sourceSlug: string, evalSlug: string, o: { steps: string; cap: number; dryRun?: boolean; work?: string }) => {
    const WORK_ROOT = workRoot(o)
    try {
      const r = await runGateC({ workRoot: WORK_ROOT, sourceSlug, evalSlug, steps: parseSteps(o.steps), cap: o.cap, dryRun: o.dryRun, voice: process.env.POLLY_VOICE_EN ?? 'Joanna' },
        { runStep, metered, meter, log: (l) => console.log(l) })
      if (!o.dryRun) console.log(`total: $${r.totalUsd.toFixed(4)}; next: pnpm gate-c packets ${evalSlug} <outDir> --raters 3`)
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
  .option(...WORK_OPT)
  .action(async (evalSlug: string, outDir: string, o: { raters: number; offset: number; title: string; work?: string }) => {
    const WORK_ROOT = workRoot(o)
    const out = here(outDir)
    const r = await buildPackets({ work: resolve(WORK_ROOT, evalSlug), outDir: out, raters: o.raters, offsetMs: Math.round(o.offset * 1000), title: o.title })
    console.log(`${o.raters} packets, ${r.shots} shots, identical (sha256 ${r.sha256.slice(0, 12)}) in ${out}; give each rater only their own rater<k>/ folder`)
  })

program.command('score <outDir>')
  .description('read <outDir>/rater*/scores.md and print usable counts, the majority-usable score, agreement and disagreements')
  .action(async (outDir: string) => {
    const s = summarise(await readRaters(here(outDir)))
    for (const l of formatSummary(s)) console.log(l)
    if (s.perRater.some((r) => r.unrated.length)) process.exitCode = 1
  })

program.parseAsync().catch((e: unknown) => { console.error((e as Error).message); process.exit(1) })
