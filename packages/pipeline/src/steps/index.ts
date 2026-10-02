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

export interface DescribeInput { slug: string; source: string; language: 'en' | 'de'; voice: string; fromStep?: string }
export const STEPS = ['probe', 'shots', 'speech', 'describe', 'fit', 'voice', 'mix', 'text', 'package', 'publish'] as const
const ORDER = STEPS
/** The slug names the work dir and S3 keys, so it is kept to a path-safe alphabet. */
export const SLUG_RE = /^[a-z0-9-]{1,64}$/

/** The whole product in one function. Each step reads/writes work/{slug}/ and is idempotent so --from works. */
export async function runDescribe(input: DescribeInput) {
  if (!SLUG_RE.test(input.slug)) throw new Error(`invalid slug "${input.slug}": must match ${SLUG_RE.source}`)
  const start = input.fromStep ? ORDER.indexOf(input.fromStep as typeof ORDER[number]) : 0
  if (start < 0) throw new Error(`unknown step "${input.fromStep}"; valid steps: ${ORDER.join(', ')}`)
  const ctx = { ...input, work: `work/${input.slug}` }
  const steps: Record<typeof ORDER[number], () => Promise<void>> = {
    probe: () => probe(ctx), shots: () => detectShots(ctx), speech: () => speechMap(ctx), describe: () => describeShots(ctx), fit: () => fitDescriptions(ctx),
    voice: () => voice(ctx), mix: () => mix(ctx), text: () => sdh(ctx), package: () => pack(ctx), publish: () => publish(ctx),
  }
  for (const s of ORDER.slice(start)) { console.time(s); await steps[s](); console.timeEnd(s) }
}
export type Ctx = DescribeInput & { work: string }
