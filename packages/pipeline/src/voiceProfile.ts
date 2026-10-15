/**
 * Polly voice + engine: the speaking rate fit (05-fit WPS) and the edit pass (05b-edit EDIT_WPS) budget with, and the price per
 * character. fit's WPS (2.67) and 05b's EDIT_WPS (2.2) were calibrated on Joanna neural (decision 0009); any other voice scales
 * them by its measured file rate over Joanna neural's, so a slower voice gets fewer words in the same pause.
 *
 * Measured rates: docs/spikes/narrative-pass-sintel.md "Voice" (2026-10-15, the same 6 Sintel cues 4:49–5:29, 06-voice's SSML,
 * decision 0009's silencedetect). Speech = words over speech length; file = words over the whole clip (lead break, tails included).
 * Docs: https://docs.aws.amazon.com/polly/latest/dg/generative-voices.html ·
 * https://docs.aws.amazon.com/polly/latest/dg/API_SynthesizeSpeech.html (Engine) ·
 * https://docs.aws.amazon.com/polly/latest/dg/supportedtags.html (SSML per engine) ·
 * https://aws.amazon.com/polly/pricing/ (neural $16, generative $30 per 1M characters; checked with the AWS Price List API,
 * `aws pricing get-products --service-code AmazonPolly`, eu-central-1, 2026-10-15).
 */
export const ENGINES = ['neural', 'generative'] as const
export type PollyEngine = typeof ENGINES[number]

export interface VoiceRate { speechWps: number; fileWps: number }
/** Measured per voice/engine. Joanna neural is the reference fit and the edit pass were calibrated on. */
export const VOICE_RATES: Record<string, VoiceRate> = {
  'Joanna/neural': { speechWps: 3.40, fileWps: 3.05 },
  'Ruth/generative': { speechWps: 2.98, fileWps: 2.79 },
}
export const REFERENCE_VOICE = 'Joanna/neural'

/**
 * fit's and the edit pass's words-per-second, as a factor of the Joanna neural calibration: the voice's file rate over Joanna's,
 * never above 1 (a faster voice keeps today's budgets: 06-voice measures every clip anyway). An unmeasured voice: 1, with no change.
 */
export function rateFactor(voice: string, engine: PollyEngine = 'neural'): number {
  const r = VOICE_RATES[`${voice}/${engine}`]
  if (!r) return 1
  return Math.min(1, r.fileWps / VOICE_RATES[REFERENCE_VOICE]!.fileWps)
}

/** USD per 1M characters (SSML tags are not billed). */
export const POLLY_PER_M_CHARS: Record<PollyEngine, number> = { neural: 16, generative: 30 }

/** Voices whose default engine is generative (the user's choice for descriptions, 2026-10-15); every other voice: neural. */
const GENERATIVE_BY_DEFAULT = new Set(['Ruth'])
/**
 * The engine for a run: --engine, else POLLY_ENGINE, else generative for a voice that ships generative (Ruth), else neural. A title
 * row stores only the voice, so the worker derives the same engine from it.
 */
export function resolveEngine(voice: string, explicit?: string, env: Record<string, string | undefined> = process.env): PollyEngine {
  const e = explicit || env.POLLY_ENGINE || (GENERATIVE_BY_DEFAULT.has(voice) ? 'generative' : 'neural')
  if (!(ENGINES as readonly string[]).includes(e)) throw new Error(`unknown Polly engine "${e}": use one of ${ENGINES.join(', ')}`)
  return e as PollyEngine
}
