import { probe } from './01-probe'
import { detectShots } from './02-shots'
import { speechMap } from './03-speech'
import { describeShots } from './04-describe'
import { fitDescriptions } from './05-fit'
import { editCues } from './05b-edit'
import { voice } from './06-voice'
import { mix } from './07-mix'
import { sdh } from './08-text'
import { pack } from './09-package'
import { publish } from './10-publish'
import { validateWork } from '../validate'
import { metered } from '../cost'

export interface DescribeInput { slug: string; source: string; language: 'en' | 'de'; voice: string; fromStep?: string }
/** `edit` (05b-edit.ts, DESC-018) revises fit's cue text with scene context before voice; file numbers stay, so --from names are stable. */
export const STEPS = ['probe', 'shots', 'speech', 'describe', 'fit', 'edit', 'voice', 'mix', 'text', 'package', 'validate', 'publish'] as const
export type Step = typeof STEPS[number]
/** The slug names the work dir and S3 keys, so it is kept to a path-safe alphabet. */
export const SLUG_RE = /^[a-z0-9-]{1,64}$/
export const ctxFor = (input: DescribeInput): Ctx => ({ ...input, work: `work/${input.slug}` })

const RUNNERS: Record<Step, (ctx: Ctx) => Promise<void>> = {
  probe, shots: detectShots, speech: speechMap, describe: (ctx) => describeShots(ctx), fit: fitDescriptions, edit: (ctx) => editCues(ctx),
  voice: (ctx) => voice(ctx), mix, text: sdh, package: pack, validate: async (ctx) => { await validateWork(ctx.work) }, publish,
}
/** One step, in-process. Each step reads/writes work/{slug}/ and overwrites its own outputs, so re-running it is safe. */
export const runStep = (step: Step, ctx: Ctx) => RUNNERS[step](ctx)

/** The whole product in one function (the CLI; the worker runs the same steps as pg-boss jobs, src/jobs.ts). --from resumes. */
export async function runDescribe(input: DescribeInput) {
  if (!SLUG_RE.test(input.slug)) throw new Error(`invalid slug "${input.slug}": must match ${SLUG_RE.source}`)
  const start = input.fromStep ? STEPS.indexOf(input.fromStep as Step) : 0
  if (start < 0) throw new Error(`unknown step "${input.fromStep}"; valid steps: ${STEPS.join(', ')}`)
  const ctx = ctxFor(input)
  let total = 0
  for (const s of STEPS.slice(start)) {
    console.time(s)
    const { costUsd } = await metered(() => runStep(s, ctx))
    console.timeEnd(s)
    if (costUsd) console.log(`${s}: $${costUsd.toFixed(4)}`)
    total += costUsd
  }
  console.log(`total: $${total.toFixed(4)}`)
}
/** signal: aborted when the job's time is up (src/jobs.ts); steps that loop or wait stop early, ffmpeg is killed. */
export type Ctx = DescribeInput & { work: string; signal?: AbortSignal }
