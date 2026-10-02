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
import { readFile, stat } from 'node:fs/promises'
import { meter, metered, pollyUsd } from '../cost'
import type { FitCue } from './05-fit'
import { cueAudioFile } from '../cues'

export interface DescribeInput { slug: string; source: string; language: 'en' | 'de'; voice: string; fromStep?: string }
export const ORDER = ['probe', 'shots', 'speech', 'describe', 'fit', 'voice', 'mix', 'text', 'package', 'publish'] as const
export type Step = typeof ORDER[number]
export const ctxFor = (input: DescribeInput): Ctx => ({ ...input, work: `work/${input.slug}` })

const STEPS: Record<Step, (ctx: Ctx) => Promise<void>> = {
  probe, shots: detectShots, speech: speechMap, describe: (ctx) => describeShots(ctx), fit: fitDescriptions,
  voice: async (ctx) => { const since = Date.now(); try { await voice(ctx) } finally { meter()?.add(pollyUsd(await pollyChars(ctx.work, since))) } }, mix, text: sdh, package: pack, publish,
}
/** Characters Polly billed since `since`: the texts of cues whose clip (cueAudioFile; the hashed key only exists once published) 06-voice wrote by now (its SSML wrapper is not billed), so a failed run still counts what it paid for. */
export async function pollyChars(work: string, since = 0): Promise<number> {
  const cues = JSON.parse(await readFile(`${work}/cues.json`, 'utf8').catch(() => '[]')) as FitCue[]
  const written = await Promise.all(cues.map((_, i) => stat(`${work}/${cueAudioFile(i)}`).then((s) => s.mtimeMs >= since, () => false)))
  return cues.reduce((n, c, i) => n + (written[i] ? c.text.length : 0), 0)
}
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
/** signal: aborted when the job's time is up (src/jobs.ts); steps that loop or wait stop early, ffmpeg is killed. */
export type Ctx = DescribeInput & { work: string; signal?: AbortSignal }
