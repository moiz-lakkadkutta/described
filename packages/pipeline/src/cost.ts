import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * On-demand prices in USD, the one place they live. Every number is a TODO(price): verify — aws.amazon.com is blocked from the
 * session that wrote this, so each was cross-checked against third-party price lists and our own Gate C bills, not the official page.
 * Bedrock (per 1M tokens, us-east-1): https://aws.amazon.com/bedrock/pricing/
 */
export const BEDROCK_PRICES: Record<string, { inputPerM: number; outputPerM: number }> = {
  // TODO(price): verify — Qwen3 VL 235B A22B; matches Gate C (61,495 input tokens ≈ $0.03)
  'qwen.qwen3-vl-235b-a22b': { inputPerM: 0.53, outputPerM: 2.66 },
  // TODO(price): verify — Nova Lite v1
  'amazon.nova-lite-v1:0': { inputPerM: 0.06, outputPerM: 0.24 },
}
/** Transcribe standard batch, tier 1, billed per second with a 15 s minimum — https://aws.amazon.com/transcribe/pricing/ TODO(price): verify (eu-central-1) */
export const TRANSCRIBE_PER_MIN = 0.024
/** Polly neural, per character; SSML tags are not billed — https://aws.amazon.com/polly/pricing/ TODO(price): verify (eu-central-1) */
export const POLLY_NEURAL_PER_M_CHARS = 16

/** Model ids may carry a cross-Region prefix (us./eu.). An unknown model warns and counts $0 — after the call, failing the job would only waste it. */
export function bedrockUsd(modelId: string, usage: { inputTokens?: number; outputTokens?: number } | undefined): number {
  const p = BEDROCK_PRICES[modelId.replace(/^(us|eu|apac|global)\./, '')]
  if (!p) { console.warn(`cost: no price for ${modelId} in src/cost.ts; counted as $0`); return 0 }
  return ((usage?.inputTokens ?? 0) * p.inputPerM + (usage?.outputTokens ?? 0) * p.outputPerM) / 1e6
}
export const transcribeUsd = (seconds: number) => (Math.max(15, Math.ceil(seconds)) / 60) * TRANSCRIBE_PER_MIN
export const pollyUsd = (chars: number) => (chars * POLLY_NEURAL_PER_M_CHARS) / 1e6

/**
 * Running cost of one job. Steps add to the meter of the job they run in (metered()); outside a job, meter() is undefined.
 * It also carries the job's abort signal to AWS calls made outside a step's ctx (the Nova Lite helpers in prompts.ts).
 */
export class Meter {
  usd = 0
  constructor(readonly signal?: AbortSignal) {}
  bedrock(modelId: string, usage: { inputTokens?: number; outputTokens?: number } | undefined) { this.usd += bedrockUsd(modelId, usage) }
  add(usd: number) { this.usd += usd }
}
const store = new AsyncLocalStorage<Meter>()
export const meter = () => store.getStore()
/** Runs fn with a fresh meter; the cost is returned even when fn throws (attached as err.costUsd). */
export async function metered<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<{ value: T; costUsd: number }> {
  const m = new Meter(signal)
  try { return { value: await store.run(m, fn), costUsd: m.usd } } catch (e) { if (e && typeof e === 'object') (e as { costUsd?: number }).costUsd = m.usd; throw e }
}

/**
 * Measured cost of the five DESC-010 titles (60 s each, CLI meter, first runs on 2026-10-14; Sintel is its re-run that day) —
 * docs/titles.md "Measured cost per title". The estimate before a run (DESC-025, src/own.ts) is built from these, not from the
 * unit prices alone: how many shots, cues and characters a minute of film produces is only known from real runs.
 * These five were measured before the verify pass (DESC-027, decision 0010). The describe step's meter now includes the verify call
 * (≈ +$0.020 / min, estimated), so a describe figure measured from now on is describe + verify and is not comparable with these.
 */
export const MEASURED_TITLES = [
  { slug: 'sintel-90-150-r2', seconds: 60, transcribe: 0.0240, describe: 0.0177, nova: 0.0004, polly: 0.0094, total: 0.0514 },
  { slug: 'big-buck-bunny-0-60', seconds: 60, transcribe: 0.0240, describe: 0.0198, nova: 0.0002, polly: 0.0112, total: 0.0553 },
  { slug: 'elephants-dream-0-60', seconds: 60, transcribe: 0.0240, describe: 0.0197, nova: 0.0004, polly: 0.0080, total: 0.0521 },
  { slug: 'caminandes-35-95', seconds: 60, transcribe: 0.0240, describe: 0.0218, nova: 0.0002, polly: 0.0125, total: 0.0586 },
  { slug: 'tears-of-steel-40-100', seconds: 60, transcribe: 0.0240, describe: 0.0166, nova: 0.0004, polly: 0.0148, total: 0.0557 },
] as const

/**
 * Per minute of film, from MEASURED_TITLES: the mean of each metered step except Transcribe (priced exactly by transcribeUsd), and
 * the lowest and highest per-title figure for everything but Transcribe (Qwen3-VL + Nova Lite + Polly), which sets the range.
 */
export function measuredPerMinute() {
  const perMin = (k: 'describe' | 'nova' | 'polly' | 'other') => MEASURED_TITLES.map((t) => (k === 'other' ? t.total - t.transcribe : t[k]) / (t.seconds / 60))
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const other = perMin('other')
  return { describe: mean(perMin('describe')), nova: mean(perMin('nova')), polly: mean(perMin('polly')), otherMean: mean(other), otherLow: Math.min(...other), otherHigh: Math.max(...other) }
}

/**
 * Estimated USD to describe `seconds` of film, before any AWS call: Transcribe exactly (per second, 15 s minimum), the rest as
 * minutes × the measured per-minute rates. `low`/`high` use the cheapest and dearest measured title. Excludes S3 storage,
 * CloudFront delivery and the machine running ffmpeg and Packager.
 */
export function estimateUsd(seconds: number) {
  const r = measuredPerMinute()
  const min = seconds / 60
  const transcribe = transcribeUsd(seconds)
  const describe = min * r.describe, nova = min * r.nova, polly = min * r.polly
  return { seconds, transcribe, describe, nova, polly, total: transcribe + describe + nova + polly, low: transcribe + min * r.otherLow, high: transcribe + min * r.otherHigh }
}
export type Estimate = ReturnType<typeof estimateUsd>
