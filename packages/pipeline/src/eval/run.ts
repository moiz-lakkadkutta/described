import { execFileSync } from 'node:child_process'
import { constants } from 'node:fs'
import { access, copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { meter as currentMeter, metered as runMetered, type Meter } from '../cost'
import { ctxFor, SLUG_RE, type Ctx, type Step } from '../steps'

/**
 * DESC-030: a Gate C evaluation run — copy one work dir's step inputs into a new slug and run only the quality steps on it, under
 * the pipeline meter with a hard spend cap. Never publishes, never writes the DB: only describe/fit/edit/voice can be named, and
 * they read and write work/{slug}/ alone (the S3 upload, Title rows and publish are in speech/package/publish and the CLI).
 */

/** The steps an evaluation may run, in pipeline order. Anything else (mix, package, publish …) is refused. */
export const EVAL_STEPS = ['describe', 'fit', 'edit', 'voice'] as const satisfies readonly Step[]
export type EvalStep = typeof EVAL_STEPS[number]
export const DEFAULT_CAP_USD = 0.3

/**
 * What every evaluation copies: the products of probe, shots and speech (the transcript and its marker, so the copy is a complete
 * record of what the steps saw) and the mezzanine (every evaluation step reads mezz.mp4; source.mp4 only feeds probe, which is not re-run). Never `cache/` (a cached describe reply would hide a prompt change),
 * `frames/` (describe regenerates them), or any output of describe and later.
 */
export const BASE_INPUTS = ['probe.json', 'shots.json', 'gaps.json', 'words.json', 'transcript.json', 'transcript.src', 'mezz.mp4'] as const
/** Needed by every evaluation step; the rest of BASE_INPUTS is copied when present. */
const REQUIRED = new Set(['probe.json', 'shots.json', 'gaps.json', 'words.json', 'mezz.mp4'])
/** Outputs of an earlier eval step that a later first step reads (05b-edit starts from cues.fit.json; 06-voice reads cues.json). */
const CARRIED: Record<EvalStep, readonly string[]> = {
  describe: [],
  fit: ['described.json'],
  edit: ['described.json', 'cues.fit.json'],
  voice: ['cues.json'],
}

/** Pure (tested): `describe,fit` → steps in pipeline order; refuses unknown, non-evaluation, repeated or non-contiguous steps. */
export function parseSteps(arg: string): EvalStep[] {
  const names = arg.split(',').map((s) => s.trim()).filter(Boolean)
  if (!names.length) throw new Error('--steps is empty')
  for (const n of names) if (!(EVAL_STEPS as readonly string[]).includes(n)) throw new Error(`--steps: "${n}" is not an evaluation step; allowed: ${EVAL_STEPS.join(', ')} (nothing is published)`)
  if (new Set(names).size !== names.length) throw new Error('--steps: a step is named twice')
  const idx = names.map((n) => EVAL_STEPS.indexOf(n as EvalStep))
  for (let k = 1; k < idx.length; k++) if (idx[k] !== idx[k - 1]! + 1) throw new Error(`--steps must be consecutive and in order (${EVAL_STEPS.join(' → ')}); got ${names.join(',')}`)
  return names as EvalStep[]
}

export interface CopyItem { file: string; bytes: number }
export interface Plan { sourceDir: string; evalDir: string; steps: EvalStep[]; cap: number; copy: CopyItem[] }

/** Reads the source dir and lists what would be copied; throws on a missing input, an existing eval dir or a bad slug. Writes nothing. */
export async function planEval(o: { workRoot: string; sourceSlug: string; evalSlug: string; steps: EvalStep[]; cap: number }): Promise<Plan> {
  for (const s of [o.sourceSlug, o.evalSlug]) if (!SLUG_RE.test(s)) throw new Error(`invalid slug "${s}": must match ${SLUG_RE.source}`)
  if (o.sourceSlug === o.evalSlug) throw new Error('the eval slug must differ from the source slug (the source work dir is never written)')
  if (!(Number.isFinite(o.cap) && o.cap > 0)) throw new Error(`--cap must be a positive number of USD; got ${o.cap}`)
  const sourceDir = join(o.workRoot, o.sourceSlug), evalDir = join(o.workRoot, o.evalSlug)
  if (!(await stat(sourceDir).then((s) => s.isDirectory(), () => false))) throw new Error(`no work dir ${sourceDir}`)
  if (await access(evalDir).then(() => true, () => false)) throw new Error(`${evalDir} exists; pick a new eval slug (an evaluation never reuses or overwrites a work dir)`)
  const present = new Set(await readdir(sourceDir))
  const wanted = [...BASE_INPUTS, ...CARRIED[o.steps[0]!]]
  const missing = wanted.filter((f) => !present.has(f) && (REQUIRED.has(f) || CARRIED[o.steps[0]!].includes(f)))
  if (missing.length) throw new Error(`${sourceDir} lacks ${missing.join(', ')} (needed to start at ${o.steps[0]})`)
  const copy: CopyItem[] = []
  for (const file of wanted) if (present.has(file)) copy.push({ file, bytes: (await stat(join(sourceDir, file))).size })
  return { sourceDir, evalDir, steps: o.steps, cap: o.cap, copy }
}

/** Copies the plan's files (copy-on-write clone where the file system has it). The source dir is only read. */
export async function copyInputs(plan: Plan) {
  await mkdir(plan.evalDir, { recursive: false })
  for (const { file } of plan.copy) await copyFile(join(plan.sourceDir, file), join(plan.evalDir, file), constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)
}

export class CapExceeded extends Error {
  constructor(readonly spentUsd: number, readonly cap: number, readonly step: string) {
    super(`spend cap reached in ${step}: $${spentUsd.toFixed(4)} > cap $${cap.toFixed(2)}; stopped (no further AWS call is started)`)
  }
}

export interface EvalDeps {
  runStep: (step: Step, ctx: Ctx) => Promise<void>
  metered: typeof runMetered
  meter: typeof currentMeter
  log: (line: string) => void
}

export interface EvalResult { steps: { step: EvalStep; costUsd: number }[]; totalUsd: number }

/**
 * Runs the plan's steps on the eval dir. The cap is hard: every charge to the step's meter is checked as it is added; the first one
 * that takes the running total past the cap aborts the step's signal (steps pass it to Bedrock/Polly calls and ffmpeg, so no new
 * call starts) and the run ends with CapExceeded. Calls already in flight when the cap is crossed are still billed, so the bill can
 * pass the cap by at most those calls (describe runs a few shots at a time). Steps after a failed or capped one never run.
 */
export async function runEvalSteps(plan: Plan, ctx: Ctx, deps: EvalDeps): Promise<EvalResult> {
  const done: EvalResult['steps'] = []
  let total = 0
  for (const step of plan.steps) {
    const ac = new AbortController()
    let over: CapExceeded | undefined
    const run = deps.metered(async () => {
      const m = deps.meter()
      if (m) guard(m, () => total, plan.cap, (usd) => { over ??= new CapExceeded(usd, plan.cap, step); ac.abort(over) })
      await deps.runStep(step, { ...ctx, signal: ac.signal })
    }, ac.signal)
    let costUsd: number
    try { costUsd = (await run).costUsd } catch (e) {
      const spent = total + ((e as { costUsd?: number })?.costUsd ?? 0)
      if (over) throw Object.assign(new CapExceeded(spent, plan.cap, step), { steps: done })
      throw Object.assign(e as object, { costUsd: spent, steps: done })
    }
    total += costUsd
    done.push({ step, costUsd })
    deps.log(`${step}: $${costUsd.toFixed(4)}  (running $${total.toFixed(4)} of cap $${plan.cap.toFixed(2)})`)
    if (over || total > plan.cap) throw Object.assign(new CapExceeded(total, plan.cap, step), { steps: done })
  }
  return { steps: done, totalUsd: total }
}

/** Wraps the meter's two charge methods so each charge is checked against the cap the moment it is added. */
function guard(m: Meter, before: () => number, cap: number, onOver: (usd: number) => void) {
  const check = () => { const usd = before() + m.usd; if (usd > cap) onOver(usd) }
  const add = m.add.bind(m), bedrock = m.bedrock.bind(m)
  m.add = (usd) => { add(usd); check() }
  m.bedrock = (id, usage) => { bedrock(id, usage); check() }
}

/** The run's record, written next to the outputs: what was copied, which steps ran at what cost, on which commit. */
export async function writeManifest(plan: Plan, sourceSlug: string, result: Partial<EvalResult> & { error?: string }) {
  let commit: string | undefined
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { /* not a checkout */ }
  await writeFile(join(plan.evalDir, 'gate-c.json'), JSON.stringify({
    source: sourceSlug, steps: plan.steps, capUsd: plan.cap, copied: plan.copy.map((c) => c.file), commit,
    describeModel: process.env.DESCRIBE_MODEL_ID, verify: process.env.DESCRIBE_VERIFY,
    ran: result.steps ?? [], totalUsd: result.totalUsd, error: result.error, at: new Date().toISOString(),
  }, null, 2))
}

/** Pure (tested): the dry-run / pre-run listing. */
export function describePlan(plan: Plan, sourceSlug: string, evalSlug: string): string[] {
  const mb = (b: number) => `${(b / 1e6).toFixed(1)} MB`
  return [
    `copy ${plan.sourceDir} → ${plan.evalDir}`,
    ...plan.copy.map((c) => `  ${c.file.padEnd(16)} ${mb(c.bytes)}`),
    `  (not copied: cache/, frames/, cue clips and every other output)`,
    `run ${plan.steps.join(' → ')} on ${evalSlug} (from ${sourceSlug}); hard cap $${plan.cap.toFixed(2)}; no publish, no DB writes`,
  ]
}

export const evalCtx = (workRoot: string, evalSlug: string, voice: string): Ctx => ({ ...ctxFor({ slug: evalSlug, source: '', language: 'en', voice }), work: join(workRoot, evalSlug) })

/**
 * The whole `gate-c run`: plan, print, and — unless dryRun — copy the inputs, run the steps and write gate-c.json. A dry run reads the
 * source dir only: no copy, no eval dir, no step, $0.
 */
export async function runGateC(o: { workRoot: string; sourceSlug: string; evalSlug: string; steps: EvalStep[]; cap: number; dryRun?: boolean; voice: string }, deps: EvalDeps): Promise<EvalResult> {
  const plan = await planEval(o)
  for (const l of describePlan(plan, o.sourceSlug, o.evalSlug)) deps.log(l)
  if (o.dryRun) { deps.log('dry run: nothing copied, no AWS call, $0.00'); return { steps: [], totalUsd: 0 } }
  await copyInputs(plan)
  try {
    const r = await runEvalSteps(plan, evalCtx(o.workRoot, o.evalSlug, o.voice), deps)
    await writeManifest(plan, o.sourceSlug, r)
    return r
  } catch (e) {
    const spent = e instanceof CapExceeded ? e.spentUsd : (e as { costUsd?: number }).costUsd
    await writeManifest(plan, o.sourceSlug, { steps: (e as { steps?: EvalResult['steps'] }).steps, totalUsd: spent, error: (e as Error).message })
    throw e
  }
}
