import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fit, safeShorten, type FitCue } from '../src/steps/05-fit'
import { voice } from '../src/steps/06-voice'
import { editBudgets, editScene } from '../src/steps/05b-edit'
import type { Described } from '../src/steps/04-describe'
import type { Gap, Word } from '../src/steps/03-speech'
import type { Shot } from '../src/steps/02-shots'
import type { Ctx } from '../src/steps/index'
import type { EditConverse } from '../src/prompts'

/**
 * Golden replay of sintel-90-210 run A2 (2026-10-10, the DESC-017 evaluation run, 22/29 usable): recorded Qwen descriptions, gaps, shot
 * bounds, fit's cues (cues.fit.json), the voiced cues (cues.json, DESCRIBE_EDIT=0) and the measured Polly clips (the cue_N.json sidecars).
 * No AWS call. DESC-020: in that run shots 8 "Red-haired girl accepts bowl." and 24 "Red-haired woman kneels beside bleeding creature on
 * cobblestones." were placed by fit and then dropped by 06-voice (the clip ran past its slot, 1.75 s / 3.3 s); both raters called the
 * events lost. They are now extended event cues; every other cue is as the run voiced it.
 */
const fx = <T>(n: string) => JSON.parse(readFileSync(new URL(`./fixtures/sintel-90-210.${n}.json`, import.meta.url), 'utf8')) as T
const described = fx<Described[]>('described')
const gaps = fx<Gap[]>('gaps')
const shots = fx<Shot[]>('shots')
const fitCues = fx<FitCue[]>('cues.fit')
const voiced = fx<FitCue[]>('cues')
const words = fx<Word[]>('words')
/** Measured clip durations (ms) of the run's kept cues, from their sidecars. */
const clips = fx<Record<string, number>>('clips')
/** Nova Lite's two shortenings in the run, recovered from cues.fit.json; every other cue is the description or its deterministic shortening. */
const MODEL: Record<string, string> = { 'Tent interior. Fire glows.': 'Tent glows.', 'Bearded man with red face paint speaks.': 'Bearded man speaks.' }
const shorten = (t: string, n: number) => safeShorten(t, n, (x) => MODEL[x] ?? x)
/**
 * A clip the run synthesized but did not keep (a text it shortened or dropped) was not recorded. When the text starts with a kept text
 * (voice's shortening cuts clauses from the end: shots 0, 18) the estimate is that clip's measured duration plus 54 ms per further
 * character; otherwise Joanna's rate on this run's kept clips, 560 ms + 54 ms per character, + 300 ms per further sentence. It
 * reproduces every keep / shorten / drop decision of the run (asserted below).
 */
const estimate = (t: string) => {
  const head = Object.entries(clips).find(([k]) => k !== t && t.startsWith(k.replace(/[.!?]$/, '')))
  return head ? head[1] + 54 * (t.length - head[0].length + 1) : 560 + 54 * t.length + 300 * (t.split(/[.!?]\s+/).length - 1)
}
const strip = (cs: readonly FitCue[]) => cs.map(({ startMs, endMs, text, extended, wordCount, shotIndex, limitMs }) => ({ startMs, endMs, text, extended, wordCount, shotIndex, ...(limitMs === undefined ? {} : { limitMs }) }))

let work: string
beforeEach(async () => { work = await mkdtemp(join(tmpdir(), 'r210-')) })
afterEach(async () => { await rm(work, { recursive: true, force: true }) })

describe('sintel-90-210 run A2 golden replay', () => {
  it('fit reproduces the run: 23 cues, none extended, and the shots it could not place carry no plot event', async () => {
    const cues = await fit(described, gaps, shorten)
    expect(strip(cues)).toEqual(fitCues)
    expect(cues.filter((c) => c.extended)).toEqual([])
    const placed = new Set(cues.map((c) => c.shotIndex))
    // 5 watches … stir; 6 blinks, expression; 10 opens eyes; 11 hands hold … face rises; 23 stares; 28 holds book — none is an event
    expect(described.filter((s) => !placed.has(s.index)).map((s) => s.index)).toEqual([5, 6, 10, 11, 23, 28])
  })

  it('voice: shots 8 and 24 become extended event cues; every other cue is as the run voiced it (golden list)', async () => {
    await writeFile(`${work}/shots.json`, JSON.stringify(shots))
    await writeFile(`${work}/cues.json`, JSON.stringify(fitCues))
    const ctx: Ctx = { slug: 'sintel-90-210', source: 's.mp4', language: 'en', voice: 'Joanna', work }
    const synthesized: string[] = []
    await voice(ctx, { synthesize: async (t) => { synthesized.push(t); return new TextEncoder().encode(t) }, measureMs: async (f) => { const t = await readFile(f, 'utf8'); return clips[t] ?? estimate(t) } })
    const out = JSON.parse(await readFile(`${work}/cues.json`, 'utf8')) as FitCue[]
    // the golden list: which sintel-90-210 shots become extended event cues. Their endMs are estimated (the run dropped these
    // clips, so their durations were not recorded); every other cue's endMs is the run's measured one.
    const events = out.filter((c) => c.event)
    expect(events.map((c) => c.shotIndex)).toEqual([8, 24])
    expect(events).toEqual([
      { startMs: 37240, endMs: 37240 + estimate('Red-haired girl accepts bowl.'), text: 'Red-haired girl accepts bowl.', extended: true, wordCount: 4, shotIndex: 8, event: true },
      { startMs: 103667, endMs: 103667 + estimate('Red-haired woman kneels beside bleeding creature on cobblestones.'), text: 'Red-haired woman kneels beside bleeding creature on cobblestones.', extended: true, wordCount: 8, shotIndex: 24, event: true },
    ])
    // everything else as the run voiced it: 20 cues, shot 19 the run's one extended cue (introducesNew), shot 27 "Red-haired woman smiles." still dropped
    expect(strip(out.filter((c) => !c.event))).toEqual(voiced)
    expect(out.filter((c) => c.extended && !c.event).map((c) => c.shotIndex)).toEqual([19])
    expect(out.some((c) => c.shotIndex === 27)).toBe(false)
    // the run's shortenings are reproduced: shots 4, 18 shortened once; the event cues' clips are the ones synthesized for their slots (no extra Polly call)
    expect(synthesized.filter((t) => t.startsWith('Bearded man holds'))).toEqual(['Bearded man holds ornate staff. Red-haired woman watches.', 'Bearded man holds staff.'])
    expect(synthesized.filter((t) => t.startsWith('Words appear: SINTEL')).length).toBe(2) // shot 0: 13 words, then 10
    expect(synthesized.filter((t) => t.includes('accepts bowl') || t.includes('kneels'))).toEqual(['Red-haired girl accepts bowl.', 'Red-haired woman kneels beside bleeding creature on cobblestones.'])
    // every clip sits in its cue's slot
    for (const [i, c] of out.entries()) expect(await readFile(`${work}/cue_${i}.mp3`, 'utf8')).toBe(c.text)
  })

  it('the edit pass treats an event cue like any extended cue: its own length as budget, its shot not listed as missed, timing untouched', async () => {
    const event: FitCue = { startMs: 37240, endMs: 39366, text: 'Red-haired girl accepts bowl.', extended: true, wordCount: 4, shotIndex: 8, event: true }
    const cues = fitCues.filter((c) => c.shotIndex !== 8).concat(event).sort((a, b) => a.startMs - b.startMs)
    const at = cues.findIndex((c) => c.event)
    expect(editBudgets(cues)[at]).toBe(4)
    const seen: string[] = []
    const send: EditConverse = async (i) => { seen.push((i.messages![0]!.content![0] as { text: string }).text); return { output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 't', name: 'emit_edits', input: { edits: [{ cue: at, text: 'Red-haired girl accepts the bowl.' }, { cue: at + 1, text: 'Tent glows. Girl accepts bowl.' }] } } }] } }, usage: { inputTokens: 1, outputTokens: 1 } } as unknown as Awaited<ReturnType<EditConverse>> }
    const r = await editScene(cues, described, words, 'en', send, undefined, (t) => t)
    const input = JSON.parse(seen[0]!.slice(seen[0]!.indexOf('{'), seen[0]!.lastIndexOf('}') + 1)) as { cues: Array<{ cue: number; missedJustBefore?: string[]; wordsYouMayAdd?: number }> }
    expect(input.cues[at]).toMatchObject({ cue: at, wordsYouMayAdd: 0 })
    expect(input.cues[at + 1]!.missedJustBefore).toBeUndefined() // shot 8 is voiced (as a pause): not a dropped shot for the next cue
    expect(r.rejected.map((x) => x.reason)).toEqual(['over budget (5 > 4 words)', 'over budget (5 > 2 words)']) // the event cue may not grow; the next cue may say what it said (continuity) but has no room
    expect(r.cues[at]).toEqual(event)
  })
})
