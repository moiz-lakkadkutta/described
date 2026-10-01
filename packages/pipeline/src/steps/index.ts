import { probe } from './01-probe'
import { detectShots } from './02-shots'
import { speechMap } from './03-speech'
import { describeShots } from './04-describe'
import { fitDescriptions } from './05-fit'
import { voice } from './06-voice'
import { mix } from './07-mix'
import { sdh } from './08-text'
import { pack } from './09-package'
import { publish } from './10-publish'
import { readFile } from 'node:fs/promises'
import { meter, metered, pollyUsd } from '../cost'
import type { FitCue } from './05-fit'

export interface DescribeInput { slug: string; source: string; language: 'en' | 'de'; voice: string; fromStep?: string }
export const ORDER = ['probe', 'shots', 'speech', 'describe', 'fit', 'voice', 'mix', 'text', 'package', 'publish'] as const
export type Step = typeof ORDER[number]
export const ctxFor = (input: DescribeInput): Ctx => ({ ...input, work: `work/${input.slug}` })

const STEPS: Record<Step, (ctx: Ctx) => Promise<void>> = {
  probe, shots: detectShots, speech: speechMap, describe: (ctx) => describeShots(ctx), fit: fitDescriptions,
  voice: async (ctx) => { await voice(ctx); meter()?.add(pollyUsd(await pollyChars(ctx.work))) }, mix, text: sdh, package: pack, publish,
}
/** Characters Polly bills for: the cue texts (06-voice's SSML wrapper is not billed). */
export const pollyChars = async (work: string) => (JSON.parse(await readFile(`${work}/cues.json`, 'utf8')) as FitCue[]).reduce((n, c) => n + c.text.length, 0)
/** One step, in-process. Each step reads/writes work/{slug}/ and overwrites its own outputs, so re-running it is safe. */
export const runStep = (step: Step, ctx: Ctx) => STEPS[step](ctx)

/** The whole product in one function (the CLI; the worker runs the same steps as pg-boss jobs, src/jobs.ts). --from resumes. */
export async function runDescribe(input: DescribeInput) {
  const start = input.fromStep ? ORDER.indexOf(input.fromStep as Step) : 0
  if (start < 0) throw new Error(`unknown step ${input.fromStep}; one of ${ORDER.join(', ')}`)
  const ctx = ctxFor(input)
  let total = 0
  for (const s of ORDER.slice(start)) {
    console.time(s)
    const { costUsd } = await metered(() => runStep(s, ctx))
    console.timeEnd(s)
    if (costUsd) console.log(`${s}: $${costUsd.toFixed(4)}`)
    total += costUsd
  }
  console.log(`total: $${total.toFixed(4)}`)
}
export type Ctx = DescribeInput & { work: string }
