import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shotsFromCuts, type Shot } from '../src/steps/02-shots'
import { dedupe, describeInParts, type Described, type RawReply } from '../src/steps/04-describe'
import { fit, safeShorten, type FitCue } from '../src/steps/05-fit'
import { voice } from '../src/steps/06-voice'
import type { Gap } from '../src/steps/03-speech'
import type { Ctx } from '../src/steps/index'

/**
 * Golden replay of sintel-90-150-r2 (DESC-017), the run the human watched on the Fire TV Stick: shots 0 and 1 were the two halves of
 * one 11.2 s camera shot and both were voiced, and 06-voice's overrun shortening cut "Words appear: SINTEL." from both cues.
 * Recorded Qwen replies (described.json), gaps and shot bounds; Polly and ffprobe are fakes (560 ms per word, about the recorded
 * clips' rate). No AWS call.
 */
const fx = <T>(n: string) => JSON.parse(readFileSync(new URL(`./fixtures/sintel-90-150-r2.${n}.json`, import.meta.url), 'utf8')) as T
const recordedShots = fx<Shot[]>('shots')
const recorded = fx<Described[]>('described')
const gaps = fx<Gap[]>('gaps')
const MS_PER_WORD = 560
const words = (t: string) => t.trim().split(/\s+/).length

let work: string
beforeEach(async () => { work = await mkdtemp(join(tmpdir(), 'r2-')) })
afterEach(async () => { await rm(work, { recursive: true, force: true }) })

/** fit (the model shortener fails, so the deterministic one runs), then voice with fake Polly / ffprobe; returns the voiced cues. */
async function fitAndVoice(described: Described[]): Promise<FitCue[]> {
  const cues = await fit(described, gaps, (t, n) => safeShorten(t, n, (x) => x))
  await writeFile(`${work}/cues.json`, JSON.stringify(cues))
  const ctx: Ctx = { slug: 'r2', source: 's.mp4', language: 'en', voice: 'Joanna', work }
  await voice(ctx, { synthesize: async (text) => new TextEncoder().encode(text), measureMs: async (f) => words(await readFile(f, 'utf8')) * MS_PER_WORD })
  return JSON.parse(await readFile(`${work}/cues.json`, 'utf8')) as FitCue[]
}

describe('sintel-90-150-r2 golden replay', () => {
  it('shots 0 and 1 are one split camera shot, and every other shot is unchanged', () => {
    const bounds = recordedShots.map((s) => s.startMs).filter((t) => t > 0 && t !== 5604) // 5604 = 11208 / 2: a split, not a cut
    const shots = shotsFromCuts(bounds, recordedShots.at(-1)!.endMs)
    expect(shots.map(({ index, startMs, endMs }) => ({ index, startMs, endMs }))).toEqual(recordedShots)
    expect(shots.slice(0, 2).map((s) => s.part)).toEqual([{ of: 2, i: 0 }, { of: 2, i: 1 }])
    expect(shots.slice(2).every((s) => s.part === undefined)).toBe(true)
  })

  it('SINTEL survives into the voiced cue and shot 1 is not a repeat of shot 0', async () => {
    const shots = shotsFromCuts(recordedShots.map((s) => s.startMs).filter((t) => t > 0 && t !== 5604), 60000)
    const asked: Array<string | undefined> = []
    const replies = await describeInParts(shots, 4, async (s, said): Promise<RawReply> => {
      asked[s.index] = said
      return { text: recorded[s.index]!.description, usage: { inputTokens: 0, outputTokens: 0 } }
    })
    expect(asked[1]).toBe(recorded[0]!.description) // shot 1 was asked only for what is new since shot 0
    expect(asked.filter((a) => a !== undefined)).toHaveLength(1)
    const described = dedupe(shots, replies)
    // even when the model repeats itself (the recorded reply), the continuation is not voiced
    expect(described[1]).toMatchObject({ sameAsPrev: true })
    expect(described.filter((d) => d.sameAsPrev).map((d) => d.index)).toEqual([1])
    const voiced = await fitAndVoice(described)
    expect(voiced.find((c) => c.shotIndex === 1)).toBeUndefined()
    expect(voiced.find((c) => c.shotIndex === 0)!.text).toBe('Snowy mountains. A lone figure walks left, carrying a spear. Words appear: SINTEL.')
  })

  it('the recorded r2 path (both halves placed, both clips over their limit) keeps SINTEL in each shortened cue', async () => {
    const voiced = await fitAndVoice(recorded)
    const head = voiced.filter((c) => c.shotIndex <= 1)
    expect(head).toHaveLength(2)
    for (const c of head) expect(c.text).toMatch(/Words appear: SINTEL\.$/)
    expect(head.map((c) => c.text)).toEqual(['Snowy mountains. Words appear: SINTEL.', 'Snowy mountains. A figure walks, falls. Words appear: SINTEL.'])
  })
})
