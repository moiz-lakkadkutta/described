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
