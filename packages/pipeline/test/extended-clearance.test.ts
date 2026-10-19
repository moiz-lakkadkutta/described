import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PAUSE_CLEARANCE_MS, pauseStart, voice, type VoiceDeps } from '../src/steps/06-voice'
import type { FitCue } from '../src/steps/05-fit'
import type { Ctx } from '../src/steps/index'
import { polishCue } from '../src/polishCue'

/**
 * Decision 0007 amendment (2026-10-19): a pause moves earlier, to max(its shot's start, the measured end of every placed clip heard
 * before it + 150 ms), and keeps ≥ PAUSE_CLEARANCE_MS before the next placed clip or detected speech; when it cannot, it stays and
 * voice warns. Fixture: tears-of-steel-40-100 as voiced on main e46e1c7 (cues.json, shots.json, words.json; each clip's measured
 * length and speech from its sidecar). No AWS call: synthesize throws.
 */
const FIX = join(__dirname, 'fixtures')
const TOS_CLIPS: [number, number][] = [ // [durationMs, speechMs] of cue_0 … cue_13
  [6528, 6201], [2688, 2326], [3312, 2971], [3312, 2972], [5592, 5261], [3360, 3051], [2640, 2289],
  [6864, 6560], [2472, 2165], [4944, 4656], [3144, 2821], [7344, 7013], [3528, 3216], [3408, 3060],
]

let work: string
beforeEach(async () => { work = await mkdtemp(join(tmpdir(), 'clearance-')) })
afterEach(async () => { await rm(work, { recursive: true, force: true }) })

/** Voices the fixture's cues.json; `again`: the cues.json the last run wrote (what --from voice reads). */
async function voiceTos(again = false) {
  const fixture = JSON.parse(await readFile(join(FIX, 'tears-of-steel-40-100.cues.json'), 'utf8')) as FitCue[]
  const cues = again ? JSON.parse(await readFile(`${work}/cues.json`, 'utf8')) as FitCue[] : fixture
  await writeFile(`${work}/cues.json`, JSON.stringify(cues))
  await copyFile(join(FIX, 'tears-of-steel-40-100.shots.json'), `${work}/shots.json`)
  await copyFile(join(FIX, 'tears-of-steel-40-100.words.json'), `${work}/words.json`)
  const clip = new Map(fixture.map((c, i) => [polishCue(c.text, 'en'), TOS_CLIPS[i]!])) // the fake Polly writes what it was sent
  const synthesize = vi.fn(async (text: string) => new TextEncoder().encode(text))
  const deps: VoiceDeps = {
    synthesize,
    measureMs: async (file) => clip.get(await readFile(file, 'utf8'))![0],
    measureSpeechMs: async (file) => clip.get(await readFile(file, 'utf8'))![1],
  }
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const ctx: Ctx = { slug: 'tears-of-steel-40-100', source: 's.mp4', language: 'en', voice: 'Ruth', engine: 'generative', work }
  await voice(ctx, deps)
  const warnings = warn.mock.calls.map((a) => String(a[0]))
  warn.mockRestore()
  return { synthesize, before: cues, after: JSON.parse(await readFile(`${work}/cues.json`, 'utf8')) as FitCue[], warnings }
}

describe('extended cue clearance (decision 0007 amendment)', () => {
  it('tears-of-steel-40-100: d10 moves back into its newspaper shot, 150 ms after cue 8 measured end', async () => {
    const { before, after } = await voiceTos()
    const d10 = after.find((c) => c.text.startsWith('Words appear: "Dr Amstelwijk'))!
    expect(before.find((c) => c.text === d10.text)!.startMs).toBe(43226)
    expect(d10.startMs).toBe(41825 + 150) // 41.975: inside shot 10 (39375–42125), 1401 ms before d11
    expect(d10.endMs - d10.startMs).toBe(4944) // same clip
    const d11 = after.find((c) => c.text.startsWith('Man in dark jacket aims rifle'))!
    expect(d11.startMs - d10.startMs).toBeGreaterThanOrEqual(PAUSE_CLEARANCE_MS)
  })
  it('tears-of-steel-40-100: placed cues, texts and order are unchanged; only pauses move, and only earlier', async () => {
    const { before, after } = await voiceTos()
    expect(after.map((c) => c.text)).toEqual(before.map((c) => c.text))
    for (const [i, c] of after.entries()) {
      const b = before[i]!
      if (!c.extended) expect(c.startMs).toBe(b.startMs)
      else expect(c.startMs).toBeLessThanOrEqual(b.startMs)
    }
    // only d10 lacked the clearance; d14 (nothing after it) stays where fit put it
    expect(after.filter((c, i) => c.startMs !== before[i]!.startMs).map((c) => c.text)).toEqual([before[9]!.text])
    expect(after.at(-1)!.startMs).toBe(59573)
  })
  it('tears-of-steel-40-100: d1 at 0:00 cannot move (dialogue at 50 ms) and voice warns', async () => {
    const { after, warnings } = await voiceTos()
    expect(after[0]!.startMs).toBe(0)
    expect(warnings.some((w) => w.includes('pause at 0 ms') && w.includes(`${PAUSE_CLEARANCE_MS}`))).toBe(true)
  })
  it('tears-of-steel-40-100: a second run (--from voice) reuses every clip: no Polly call, the same cues', async () => {
    const first = await voiceTos()
    const second = await voiceTos(true)
    expect(second.synthesize).not.toHaveBeenCalled()
    expect(second.after).toEqual(first.after)
  })
})

describe('pauseStart', () => {
  const placed = (startMs: number, endMs: number, shotIndex: number): FitCue => ({ startMs, endMs, text: 'x', extended: false, wordCount: 1, shotIndex })
  const pause = (startMs: number, shotIndex: number): FitCue => ({ startMs, endMs: startMs + 3000, text: 'Words appear: North.', extended: true, wordCount: 3, shotIndex })
  const shot = { start: 10_000 }
  it('moves a pause that lacks the clearance earlier, to max(shot start, previous measured end + 150 ms), when that has it', () => {
    const r = pauseStart(pause(14_000, 2), 14_000, { shotStart: shot.start, placed: [placed(9000, 12_000, 1), placed(14_100, 16_000, 3)], speech: [], floor: -Infinity })
    expect(r).toEqual({ startMs: 12_150 })
  })
  it('keeps a pause that has the clearance where it is', () => {
    expect(pauseStart(pause(14_000, 2), 14_000, { shotStart: shot.start, placed: [placed(9000, 12_000, 1), placed(14_500, 16_000, 3)], speech: [], floor: -Infinity })).toEqual({ startMs: 14_000 })
  })
  it('never before the shot start', () => {
    const r = pauseStart(pause(14_000, 2), 14_000, { shotStart: shot.start, placed: [placed(5000, 8000, 1), placed(14_100, 16_000, 3)], speech: [], floor: -Infinity })
    expect(r.startMs).toBe(10_000)
  })
  it('keeps the start when it is already the earliest', () => {
    expect(pauseStart(pause(12_000, 2), 12_000, { shotStart: shot.start, placed: [placed(9000, 12_000, 1), placed(20_000, 21_000, 3)], speech: [], floor: -Infinity })).toEqual({ startMs: 12_000 })
  })
  it('keeps the current start and warns when the earlier start is too close to the next placed clip', () => {
    const r = pauseStart(pause(12_300, 2), 12_300, { shotStart: shot.start, placed: [placed(9000, 12_000, 1), placed(12_450, 15_000, 3)], speech: [], floor: -Infinity })
    expect(r.startMs).toBe(12_300)
    expect(r.warning).toMatch(/150 ms/)
  })
  it('keeps the current start when the earlier start would land on detected speech, and warns when the current is too close too', () => {
    const r = pauseStart(pause(13_000, 2), 13_000, { shotStart: shot.start, placed: [placed(9000, 11_000, 1)], speech: [{ startMs: 11_000, endMs: 12_800 }], floor: -Infinity })
    expect(r.startMs).toBe(13_000)
    expect(r.warning).toBeUndefined()
    const s = pauseStart(pause(13_000, 2), 13_000, { shotStart: shot.start, placed: [placed(9000, 11_000, 1)], speech: [{ startMs: 11_000, endMs: 12_800 }, { startMs: 13_200, endMs: 14_000 }], floor: -Infinity })
    expect(s.startMs).toBe(13_000)
    expect(s.warning).toMatch(/200 ms/)
  })
  it('moves earlier when that gains the clearance the current start lacks', () => {
    const r = pauseStart(pause(13_000, 2), 13_000, { shotStart: shot.start, placed: [placed(9000, 11_000, 1)], speech: [{ startMs: 13_300, endMs: 14_000 }], floor: -Infinity })
    expect(r).toEqual({ startMs: 11_150 })
  })
  it('never before an earlier pause (floor)', () => {
    expect(pauseStart(pause(14_000, 2), 14_000, { shotStart: shot.start, placed: [], speech: [{ startMs: 14_200, endMs: 15_000 }], floor: 13_000 }).startMs).toBe(13_000)
  })
})
