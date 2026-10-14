import { execFileSync } from 'node:child_process'
import { constants } from 'node:fs'
import { access, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { editModelId, LITE } from '../prompts'
import { BEDROCK_PRICES, meter as currentMeter, metered as runMetered, type Meter } from '../cost'
import { ctxFor, SLUG_RE, STEPS, type Ctx, type Step } from '../steps'
import { DEFAULT_GLOSSARY_FILE, isEmpty, loadGlossary, type Glossary } from '../glossary'
import { scenesModelId } from '../scenePrompt'
import { CONTINUATION_CACHE_VERSION, DEFAULT_DESCRIBE_MODEL_ID, DESCRIBE_CACHE_VERSION, describeConcurrency } from '../steps/04-describe'
import { verifyEnabled, verifyModelId } from '../steps/04b-verify'
import { VERIFY_PROMPT_VERSION } from '../verifyPrompt'

/**
 * DESC-030: a Gate C evaluation run — copy one work dir's step inputs into a new slug and run only the quality steps on it, under
 * the pipeline meter with a hard spend cap. Never publishes, never writes the DB: only describe/fit/edit/voice can be named, and
 * they read and write work/{slug}/ alone (the S3 upload, Title rows and publish are in speech/package/publish and the CLI).
 *
 * DESC-029: EVAL_STEPS includes the `scenes` step (04c), and evalCtx carries the SOURCE slug's glossary (evalGlossary) — the eval slug
 * is a copy with no entry of its own, and a run without the glossary would describe with the old prompt.
 */

/** The steps an evaluation may run, in pipeline order. Anything else (mix, package, publish …) is refused. */
export const EVAL_STEPS = ['describe', 'scenes', 'fit', 'edit', 'voice'] as const satisfies readonly Step[]
export type EvalStep = typeof EVAL_STEPS[number]
export const DEFAULT_CAP_USD = 0.3

/**
 * What every evaluation copies: the products of probe, shots and speech (the transcript and its marker, so the copy is a complete
 * record of what the steps saw) and the mezzanine (every evaluation step reads mezz.mp4; source.mp4 only feeds probe, which is not
 * re-run). Never `cache/` (a cached describe reply would hide a prompt change), `frames/` (describe regenerates them), or any output
 * of describe and later.
 */
export const BASE_INPUTS = ['probe.json', 'shots.json', 'gaps.json', 'words.json', 'transcript.json', 'transcript.src', 'mezz.mp4'] as const
/** Needed by every evaluation step; the rest of BASE_INPUTS is copied when present. */
const REQUIRED = new Set(['probe.json', 'shots.json', 'gaps.json', 'words.json', 'mezz.mp4'])
/** Outputs of an earlier step that the first step reads (05b-edit starts from cues.fit.json). voice is never first (parseSteps). */
const CARRIED: Record<Exclude<EvalStep, 'voice'>, readonly string[]> = {
  describe: [],
  scenes: ['described.json'],
  fit: ['described.json'],
  edit: ['described.json', 'cues.fit.json'],
}
/** Copied when present: fit and edit read the scenes (04c-scenes). fit re-groups by itself when scenes.json is missing or stale. */
const CARRIED_IF_PRESENT: Record<Exclude<EvalStep, 'voice'>, readonly string[]> = { describe: [], scenes: [], fit: ['scenes.json'], edit: ['scenes.json'] }

/**
 * Pure (tested): `describe,fit` → steps in pipeline order; refuses unknown, non-evaluation, repeated or non-contiguous steps, and
 * `voice` first: 06-voice rewrites cues.json in place, so a voice-only run would voice whatever cues.json the source dir last held
 * (fit's, edit's or an earlier voice's) — voice runs only after edit in the same run.
 */
export function parseSteps(arg: string): EvalStep[] {
  const names = arg.split(',').map((s) => s.trim()).filter(Boolean)
  if (!names.length) throw new Error('--steps is empty')
  for (const n of names) if (!(EVAL_STEPS as readonly string[]).includes(n)) throw new Error(`--steps: "${n}" is not an evaluation step; allowed: ${EVAL_STEPS.join(', ')} (nothing is published)`)
  if (new Set(names).size !== names.length) throw new Error('--steps: a step is named twice')
  const idx = names.map((n) => EVAL_STEPS.indexOf(n as EvalStep))
  for (let k = 1; k < idx.length; k++) if (idx[k] !== idx[k - 1]! + 1) throw new Error(`--steps must be consecutive and in order (${EVAL_STEPS.join(' → ')}); got ${names.join(',')}`)
  if (names[0] === 'voice') throw new Error('--steps cannot start at voice: 06-voice rewrites cues.json, so it runs only after edit in the same run (use edit,voice)')
  return names as EvalStep[]
}

const priced = (id: string) => id.replace(/^(us|eu|apac|global)\./, '') in BEDROCK_PRICES

/** Every Bedrock model the steps will call, from the same functions the steps use (they read process.env). */
export function effectiveModels(steps: readonly EvalStep[]): { role: string; id: string }[] {
  const out: { role: string; id: string }[] = []
  if (steps.includes('describe')) {
    const describe = process.env.DESCRIBE_MODEL_ID ?? DEFAULT_DESCRIBE_MODEL_ID // 04-describe
    out.push({ role: 'describe', id: describe })
    if (verifyEnabled()) out.push({ role: 'verify', id: verifyModelId(describe) })
  }
  if (steps.includes('scenes')) out.push({ role: 'scenes', id: scenesModelId() }) // 04c-scenes
  if (steps.includes('fit') || steps.includes('edit')) out.push({ role: 'shorten (fit, edit)', id: LITE() })
  if (steps.includes('edit') && process.env.DESCRIBE_EDIT !== '0') out.push({ role: 'edit', id: editModelId() }) // 05b-edit skips its call on DESCRIBE_EDIT=0
  return out
}
/**
 * A model with no price in cost.ts BEDROCK_PRICES is metered as $0 (bedrockUsd warns and counts nothing), which would make the
 * cap blind; refuse such a run before anything is copied.
 */
export function assertPriced(steps: readonly EvalStep[]) {
  const missing = effectiveModels(steps).filter((m) => !priced(m.id))
  if (missing.length) throw new Error(`no price in src/cost.ts BEDROCK_PRICES for ${missing.map((m) => `${m.id} (${m.role})`).join(', ')}: the meter would count it as $0 and the cap could not stop it. Add the price first. Nothing was copied or spent.`)
}

export interface CopyItem { file: string; bytes: number }
export interface Plan { sourceDir: string; evalDir: string; steps: readonly Step[]; cap: number; copy: CopyItem[] }

/** Reads the source dir and lists what would be copied; throws on a missing input, an existing eval dir or a bad slug. Writes nothing. */
export async function planEval(o: { workRoot: string; sourceSlug: string; evalSlug: string; steps: EvalStep[]; cap: number }): Promise<Plan> {
  for (const s of [o.sourceSlug, o.evalSlug]) if (!SLUG_RE.test(s)) throw new Error(`invalid slug "${s}": must match ${SLUG_RE.source}`)
  if (o.sourceSlug === o.evalSlug) throw new Error('the eval slug must differ from the source slug (the source work dir is never written)')
  assertCap(o.cap)
  const first = o.steps[0]
  if (!first || first === 'voice') throw new Error('an evaluation starts at describe, fit or edit')
  const sourceDir = join(o.workRoot, o.sourceSlug), evalDir = join(o.workRoot, o.evalSlug)
  if (!(await stat(sourceDir).then((s) => s.isDirectory(), () => false))) throw new Error(`no work dir ${sourceDir}`)
  await assertNew(evalDir)
  const present = new Set(await readdir(sourceDir))
  const wanted = [...BASE_INPUTS, ...CARRIED[first], ...CARRIED_IF_PRESENT[first]]
  const missing = wanted.filter((f) => !present.has(f) && (REQUIRED.has(f) || CARRIED[first].includes(f)))
  if (missing.length) throw new Error(`${sourceDir} lacks ${missing.join(', ')} (needed to start at ${first})`)
  const copy: CopyItem[] = []
  for (const file of wanted) if (present.has(file)) copy.push({ file, bytes: (await stat(join(sourceDir, file))).size })
  return { sourceDir, evalDir, steps: o.steps, cap: o.cap, copy }
}
export function assertCap(cap: number) { if (!(Number.isFinite(cap) && cap > 0)) throw new Error(`--cap must be a positive number of USD; got ${cap}`) }
export async function assertNew(dir: string) {
  if (await access(dir).then(() => true, () => false)) throw new Error(`${dir} exists; pick a new eval slug (an evaluation never reuses or overwrites a work dir)`)
}

/** Copies the plan's files (copy-on-write clone where the file system has it). The source dir is only read. */
export async function copyInputs(plan: Plan) {
  await mkdir(plan.evalDir, { recursive: false })
  for (const { file } of plan.copy) await copyFile(join(plan.sourceDir, file), join(plan.evalDir, file), constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)
}

export class CapExceeded extends Error {
  constructor(readonly spentUsd: number, readonly cap: number, readonly step: string) {
    super(`spend cap reached in ${step}: $${spentUsd.toFixed(4)} > cap $${cap.toFixed(3)}; stopped (no further AWS call is started)`)
  }
}

export interface EvalDeps {
  runStep: (step: Step, ctx: Ctx) => Promise<void>
  metered: typeof runMetered
  meter: typeof currentMeter
  log: (line: string) => void
}

export interface EvalResult { steps: { step: Step; costUsd: number }[]; totalUsd: number }

/**
 * Runs the plan's steps on ctx.work. The cap is hard: every charge to the step's meter is checked as it is added; the first one
 * that takes the running total past the cap aborts the step's signal (steps pass it to Bedrock/Polly calls and ffmpeg, so no new
 * call starts) and the run ends with CapExceeded. Calls already in flight when the cap is crossed are still billed, so the bill can
 * pass the cap by at most those calls (describe runs DESCRIBE_CONCURRENCY shots at a time). Steps after a failed or capped one never run.
 */
export async function runEvalSteps(plan: Pick<Plan, 'steps' | 'cap'>, ctx: Ctx, deps: EvalDeps): Promise<EvalResult> {
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
    deps.log(`${step}: $${costUsd.toFixed(4)}  (running $${total.toFixed(4)} of cap $${plan.cap.toFixed(3)})`)
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

const git = (args: string[]) => { try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return undefined } }

/** Everything that decides what the steps do besides the inputs: commit (and whether the tree had uncommitted changes), models, switches, versions. */
export function runSettings(steps: readonly Step[], language: string, voice: string, env: Record<string, string | undefined> = process.env) {
  const status = git(['status', '--porcelain'])
  return {
    commit: git(['rev-parse', 'HEAD'])?.trim(), dirty: status === undefined ? undefined : status.trim().length > 0,
    language, voice,
    models: effectiveModels(steps.filter((s): s is EvalStep => (EVAL_STEPS as readonly string[]).includes(s))),
    env: Object.fromEntries(['DESCRIBE_MODEL_ID', 'VERIFY_MODEL_ID', 'EDIT_MODEL_ID', 'NOVA_LITE_MODEL_ID', 'DESCRIBE_EDIT', 'DESCRIBE_VERIFY', 'DESCRIBE_CONCURRENCY', 'BEDROCK_REGION', 'AWS_REGION'].map((k) => [k, env[k] ?? null])),
    describeConcurrency: describeConcurrency(), verifyEnabled: verifyEnabled(),
    versions: { VERIFY_PROMPT_VERSION, DESCRIBE_CACHE_VERSION, CONTINUATION_CACHE_VERSION },
  }
}

/** The run's record, written next to the outputs: what was copied, which steps ran at what cost, and runSettings. */
export async function writeManifest(dir: string, record: Record<string, unknown>, settings: ReturnType<typeof runSettings>, result: Partial<EvalResult> & { error?: string }) {
  await writeFile(join(dir, 'gate-c.json'), JSON.stringify({
    ...record, ...settings, ran: result.steps ?? [], totalUsd: result.totalUsd, error: result.error, at: new Date().toISOString(),
  }, null, 2))
}

/** Pure (tested): the dry-run / pre-run listing. */
export function describePlan(plan: Plan, sourceSlug: string, evalSlug: string): string[] {
  const mb = (b: number) => `${(b / 1e6).toFixed(1)} MB`
  return [
    `copy ${plan.sourceDir} → ${plan.evalDir}`,
    ...plan.copy.map((c) => `  ${c.file.padEnd(16)} ${mb(c.bytes)}`),
    `  (not copied: cache/, frames/, cue clips and every other output)`,
    `run ${plan.steps.join(' → ')} on ${evalSlug} (from ${sourceSlug}); hard cap $${plan.cap.toFixed(3)}; no publish, no DB writes`,
  ]
}

export const evalCtx = (workRoot: string, slug: string, language: 'en' | 'de', voice: string, source = '', glossary?: Glossary): Ctx =>
  ({ ...ctxFor({ slug, source, language, voice }), work: join(workRoot, slug), ...(glossary ? { glossary } : {}) })

/** Glossaries of evaluation segments that are not catalogue titles (sintel-90-210, the Gate C segment). */
export const EVAL_GLOSSARY_FILE = new URL('../../../../docs/eval/gate-c-glossary.json', import.meta.url)
/** The source slug's glossary: its titles.json entry, else its entry in EVAL_GLOSSARY_FILE (a warning when neither has one). */
export function evalGlossary(sourceSlug: string, files: readonly (string | URL)[] = [process.env.GLOSSARY_FILE ?? DEFAULT_GLOSSARY_FILE, EVAL_GLOSSARY_FILE]): Glossary {
  for (const f of files) { const g = loadGlossary(sourceSlug, f, { warn: false }); if (!isEmpty(g)) return g }
  return loadGlossary(sourceSlug, files[0]!)
}

/**
 * The whole `gate-c run`: plan, check every model has a price, print, and — unless dryRun — copy the inputs, run the steps and write
 * gate-c.json. A dry run reads the source dir only: no copy, no eval dir, no step, $0. A copy that fails part-way removes the eval dir.
 */
export async function runGateC(o: { workRoot: string; sourceSlug: string; evalSlug: string; steps: EvalStep[]; cap: number; dryRun?: boolean; language: 'en' | 'de'; voice: string }, deps: EvalDeps): Promise<EvalResult> {
  const plan = await planEval(o)
  assertPriced(o.steps)
  for (const l of describePlan(plan, o.sourceSlug, o.evalSlug)) deps.log(l)
  deps.log(`models: ${effectiveModels(o.steps).map((m) => `${m.role} ${m.id}`).join('; ')}; ${o.language}, voice ${o.voice}`)
  if (o.dryRun) { deps.log('dry run: nothing copied, no AWS call, $0.00'); return { steps: [], totalUsd: 0 } }
  const settings = runSettings(o.steps, o.language, o.voice)
  const prepared = await readFile(join(plan.sourceDir, 'gate-c.json'), 'utf8').then((t) => JSON.parse(t) as { credit?: string; input?: string; start?: string; end?: string }, () => undefined)
  const record = { source: o.sourceSlug, steps: plan.steps, capUsd: plan.cap, copied: plan.copy.map((c) => c.file), credit: prepared?.credit, segment: prepared?.input ? { input: prepared.input, start: prepared.start, end: prepared.end } : undefined }
  try { await copyInputs(plan) } catch (e) {
    await rm(plan.evalDir, { recursive: true, force: true })
    throw e
  }
  try {
    const r = await runEvalSteps(plan, evalCtx(o.workRoot, o.evalSlug, o.language, o.voice, '', evalGlossary(o.sourceSlug)), deps)
    await writeManifest(plan.evalDir, record, settings, r)
    return r
  } catch (e) {
    const spent = e instanceof CapExceeded ? e.spentUsd : (e as { costUsd?: number }).costUsd
    await writeManifest(plan.evalDir, record, settings, { steps: (e as { steps?: EvalResult['steps'] }).steps, totalUsd: spent, error: (e as Error).message })
    throw e
  }
}

/** The pipeline steps between describe and voice — EVAL_STEPS must stay equal to this (tested), so a new step there is noticed. */
export const pipelineQualitySteps = () => STEPS.slice(STEPS.indexOf('describe'), STEPS.indexOf('voice') + 1)
