import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly'
import { execa } from 'execa'
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Ctx } from './index'
import { byStart, capExtended, introducesNew, leadText, shortenDeterministic, textClauses, type FitCue } from './05-fit'
import type { Shot } from './02-shots'
import { cueAudioFile } from '../cues'
import { meter, pollyUsd } from '../cost'
import { textSpans } from '../textClause'
import { EVENT_SPACING_MS, eventSpaced, plotEvent } from '../plotEvent'

/** A clip may run this far past its limit (its gap's end, or the next placed cue's start − NEXT_CUE_SPACING_MS) before it counts as an overrun. */
export const OVERRUN_TOLERANCE_MS = 200
/** fit's spacing between two cues in one gap (its cursor: end + 150 ms). */
export const NEXT_CUE_SPACING_MS = 150
/** work/{slug}/cue_{i}.json: what clip cue_{i}.mp3 says, in which voice, with which SSML (so a wrapper change re-synthesizes), and how long it is. */
export interface CueSidecar { text: string; voice: string; language: 'en' | 'de'; ssml: string; durationMs: number }
export const cueSidecarFile = (i: number) => `cue_${i}.json`
const CUE_FILE = /^cue_(\d+)\.(mp3|json)$/

/** Polly and ffprobe, injected so tests make no AWS call. */
export interface VoiceDeps {
  synthesize?: (text: string, voice: string, language: 'en' | 'de') => Promise<Uint8Array>
  /** Clip duration in ms. */
  measureMs?: (file: string) => Promise<number>
}

/** SSML: a 150 ms lead-in break, then the text at normal rate (W1-E's promptClips duplicates this wrapper on purpose). */
export const cueSsml = (text: string) => `<speak><break time="150ms"/><prosody rate="100%">${escape(text)}</prosody></speak>`

/**
 * Polly neural SynthesizeSpeech, MP3 — https://docs.aws.amazon.com/polly/latest/dg/API_SynthesizeSpeech.html
 * (Engine, VoiceId, OutputFormat mp3, TextType ssml, LanguageCode; AudioStream is the MP3). SSML tags are not billed.
 */
export const pollySynthesize = (signal?: AbortSignal): NonNullable<VoiceDeps['synthesize']> => {
  const polly = new PollyClient({ region: process.env.AWS_REGION ?? 'eu-central-1' })
  return async (text, voice, language) => {
    const r = await polly.send(new SynthesizeSpeechCommand({ Engine: 'neural', VoiceId: voice as never, OutputFormat: 'mp3', TextType: 'ssml', Text: cueSsml(text), LanguageCode: language === 'de' ? 'de-DE' : 'en-US' }), { abortSignal: signal })
    return r.AudioStream!.transformToByteArray()
  }
}
/** `ffprobe -v error -show_entries format=duration -of json <file>` — https://ffmpeg.org/ffprobe.html */
export const clipDurationArgs = (file: string) => ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file]
/** Pure (tested): ffprobe's JSON → whole ms; throws when format.duration is missing or not a positive number. */
export function parseClipDurationMs(stdout: string): number {
  const sec = parseFloat((JSON.parse(stdout) as { format?: { duration?: string } }).format?.duration ?? '')
  if (!Number.isFinite(sec) || sec <= 0) throw new Error(`ffprobe gave no clip duration: ${JSON.stringify(stdout)}`)
  return Math.round(sec * 1000)
}
export const ffprobeClipMs = (signal?: AbortSignal) => async (file: string) => parseClipDurationMs((await execa('ffprobe', clipDurationArgs(file), { cancelSignal: signal })).stdout)

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length

/**
 * Polly neural, one voice per title, SSML with a 150 ms lead-in break. Extended cues are voiced too: 07-mix leaves them out
 * of the AD rendition, and the app plays their clip while the film is paused (DESC-007). File names: ../cues.
 *
 * Narration end from the clip (DESC-013), per cue i of cues.json, in order:
 * 1. Reuse cue_{i}.mp3 when cue_{i}.json says the same text, voice and language (no Polly call, no cost); else synthesize,
 *    measure with ffprobe and write the sidecar.
 * 2. A placed cue's limit is min(limitMs, start of the next placed cue in cues.json − NEXT_CUE_SPACING_MS): fit's start times are
 *    fixed by now, so a clip longer than fit's estimate must not run into the next cue of the same gap. A clip ending past
 *    limit + OVERRUN_TOLERANCE_MS is shortened deterministically to max(3, ⌊words × (limit − startMs) / durationMs⌋) words and
 *    synthesized once more (the shortening keeps on-screen text only beside at least half of the action's words). Still over and the
 *    text has on-screen text beside other words (human, 2026-10-10): split — the rest, shortened to fit, stays in this slot, and the
 *    text clause becomes its own extended cue TEXT_LEAD_MS before it (fit's leadText: never before the shot start from shots.json —
 *    the cue's own start when that file is missing — nor the previous kept cue's end; with no room, the action moves TEXT_LEAD_MS
 *    later when it still ends within its limit). Text cues are voiced after the loop and every cue re-slotted in start order
 *    (byStart). Still over: it becomes an extended cue
 *    when the text introduces something new (capped like fit's extended cues); else, when the cue's text carries a new plot event the
 *    previous voiced cue did not say (../plotEvent; DESC-020, human 2026-10-10) and no event cue — fit's, or one added here — starts
 *    within EVENT_SPACING_MS of it, it becomes an extended cue with `event: true` and the cue's full text (the slot shortening was for
 *    the slot; a pause has none; the on-screen text split off above stays in its own pause; capped like any extended cue), starting
 *    where the action would have (after the text cue's lead); else it is dropped. The plain AD track is unchanged by an event cue.
 *    The original clip is set aside before the slot shortening overwrites its slot, so a pause that voices it again costs no third call.
 * 3. cues.json is written back with endMs = startMs + durationMs for every kept cue; 07-mix and 08-text read those ends.
 * On-screen text already heard: a text clause ("Words appear: SINTEL.") that the previous voiced cue — its action cue and the text cue
 * split from it — said (same text, case and spacing aside) is not voiced again: the clause is cut from this cue's text and the rest
 * voiced; a cue that was only that clause is not voiced (sintel-90-150-r2: shots 0 and 1, the halves of one camera shot, both ended in
 * SINTEL). An extended cue never starts while a placed clip still speaks: fit's starts were estimates, so after the clips are
 * measured every extended cue moves to at least the measured end of every placed cue before it (afterClips; the event cap re-checked).
 * (The time taken from the action by a clause fit kept beside it and voice then removes — r2 shot 1 lost "Logo fades." that way — is
 * fit's: it does not know yet which cue will be voiced before.)
 * Clips keep following cues.json indices: a kept cue after a dropped one moves down (cue_{i} → cue_{j}), and every
 * cue_{k}.mp3|json with k ≥ the cue count is deleted (DESC-016), before synthesis and again after drops.
 * Cost: every Polly call is billed to the job's meter as soon as it returns (its text's characters; the SSML wrapper is not
 * billed), kept or discarded, so a run that fails later still counts what it paid for. Reused clips cost nothing.
 * After a drop, the later clips sit one slot lower; re-running from fit (which restores the dropped cue) finds their sidecars
 * no longer match their slots and re-synthesizes them — a cost only, the clips stay correct.
 */
export async function voice(ctx: Ctx, deps: VoiceDeps = {}) {
  const synthesize = deps.synthesize ?? pollySynthesize(ctx.signal)
  const measureMs = deps.measureMs ?? ffprobeClipMs(ctx.signal)
  const cues = JSON.parse(await readFile(`${ctx.work}/cues.json`, 'utf8')) as FitCue[]
  const language = ctx.language
  await removeCueFilesFrom(ctx.work, cues.length)
  for (const f of await readdir(ctx.work)) if (f.startsWith(MOVING)) await rm(`${ctx.work}/${f}`, { force: true }) // left by a crash in withTextCues
  const shotStart = new Map((JSON.parse(await readFile(`${ctx.work}/shots.json`, 'utf8').catch(() => '[]')) as Shot[]).map((x) => [x.index, x.startMs]))
  /** Synthesizes text into slot i (overwriting it) and returns the clip's duration. */
  const synth = async (i: number, text: string) => {
    const file = `${ctx.work}/${cueAudioFile(i)}`
    const audio = await synthesize(text, ctx.voice, language)
    meter()?.add(pollyUsd(text.length))
    await writeFile(file, audio)
    const durationMs = await measureMs(file)
    await writeFile(`${ctx.work}/${cueSidecarFile(i)}`, JSON.stringify({ text, voice: ctx.voice, language, ssml: cueSsml(text), durationMs } satisfies CueSidecar))
    return durationMs
  }
  const files = [cueAudioFile, cueSidecarFile]
  /** The original clip of a cue, set aside (ORIG_ + its names) before the slot shortening overwrites its slot: an event pause may voice it again without a third Polly call. */
  const setAside = async (i: number) => { for (const f of files) await rename(`${ctx.work}/${f(i)}`, `${ctx.work}/${ORIG}${f(i)}`) }
  const restore = async (i: number) => { for (const f of files) await rename(`${ctx.work}/${ORIG}${f(i)}`, `${ctx.work}/${f(i)}`) }
  const discard = async (i: number) => { for (const f of files) await rm(`${ctx.work}/${ORIG}${f(i)}`, { force: true }) }
  let kept: FitCue[] = []
  const texts: FitCue[] = [] // extended on-screen text cues split off overrunning cues; voiced after the loop
  const eventStarts = cues.filter((c) => c.event).map((c) => c.startMs) // fit's event cues, then the ones added here: the cap counts both
  /** The on-screen text the previous voiced cue said: the last kept cue, the text cue split from it here, and fit's text cue before it (same shot). */
  const heardText = () => {
    const last = kept.at(-1)
    if (!last) return []
    const before = kept.at(-2)
    const group = [last, ...texts.filter((t) => t.shotIndex === last.shotIndex), ...(before && textOnly(before) && before.shotIndex === last.shotIndex ? [before] : [])]
    return group.flatMap((x) => bodies(x.text))
  }
  for (const [i, c] of cues.entries()) {
    ctx.signal?.throwIfAborted()
    const base = withoutSaidText(c.text, heardText())
    if (!base) { console.log(`voice: cue ${i} at ${c.startMs} ms is on-screen text the previous cue said; not voiced: ${JSON.stringify(c.text)}`); continue }
    let text = base
    let durationMs = (await reusable(ctx.work, i, { text, voice: ctx.voice, language, ssml: cueSsml(text) })) ?? await synth(i, text)
    let cue: FitCue | null = { ...c }
    let startMs = c.startMs
    let aside: { text: string; durationMs: number } | undefined
    const next = cues.slice(i + 1).find((x) => !x.extended)
    const limit = c.limitMs === undefined ? undefined : Math.min(c.limitMs, next ? next.startMs - NEXT_CUE_SPACING_MS : Infinity)
    if (limit !== undefined && c.startMs + durationMs > limit + OVERRUN_TOLERANCE_MS) {
      const maxWords = Math.max(3, Math.floor((words(text) * (limit - c.startMs)) / durationMs))
      const shorter = shortenDeterministic(text, maxWords)
      if (shorter !== text) { await setAside(i); aside = { text, durationMs }; text = shorter; durationMs = await synth(i, text) }
      const tc = c.startMs + durationMs > limit + OVERRUN_TOLERANCE_MS ? textClauses(text) : undefined
      if (tc?.rest) {
        const fitWords = Math.max(3, Math.floor((words(text) * (limit - c.startMs)) / durationMs))
        const { limitMs: _, ...rest } = c
        const clause = (await capExtended(tc.clause, shortenDeterministic)).text
        texts.push({ ...rest, endMs: c.startMs + 100, text: clause, extended: true, wordCount: words(clause) })
        console.log(`voice: cue ${i} at ${c.startMs} ms: on-screen text split into its own extended cue: ${JSON.stringify(clause)}`)
        text = shortenDeterministic(tc.rest, fitWords)
        durationMs = await synth(i, text)
        const prevEnd = Math.max(shotStart.get(c.shotIndex) ?? c.startMs, ...kept.filter((k) => !k.extended).map((k) => k.endMs)) // every kept clip's measured end: one may run past this cue's start (within tolerance)
        const lead = leadText(c.startMs, prevEnd, (later) => later + durationMs <= limit + OVERRUN_TOLERANCE_MS)
        texts.at(-1)!.startMs = lead.textStart
        texts.at(-1)!.endMs = lead.textStart + 100
        startMs = lead.actionStart
      }
      if (startMs + durationMs > limit + OVERRUN_TOLERANCE_MS) {
        if (introducesNew(text)) {
          const capped = (await capExtended(text, shortenDeterministic)).text
          if (capped !== text) { text = capped; durationMs = await synth(i, text) }
          const { limitMs: _, ...rest } = c
          cue = { ...rest, extended: true }
          console.log(`voice: cue ${i} at ${c.startMs} ms runs ${c.startMs + durationMs - limit} ms past its limit; now extended: ${JSON.stringify(text)}`)
        } else if (plotEvent(base, previousPlaced(kept)) && eventSpaced(eventStarts, startMs)) {
          // the full text (the rest, when the on-screen text was split off above — said once, in its own pause), not the slot shortening
          const full = (await capExtended(tc?.rest ? textClauses(base)!.rest : base, shortenDeterministic)).text
          if (full === aside?.text) { await restore(i); text = full; durationMs = aside.durationMs; aside = undefined }
          else if (full !== text) { text = full; durationMs = await synth(i, text) }
          const { limitMs: _, ...rest } = c
          cue = { ...rest, extended: true, event: true }
          eventStarts.push(startMs)
          console.log(`voice: cue ${i} at ${startMs} ms runs ${c.startMs + durationMs - limit} ms past its limit; a new plot event, now extended: ${JSON.stringify(text)}`)
        } else {
          cue = null
          console.log(`voice: cue ${i} at ${c.startMs} ms runs ${c.startMs + durationMs - limit} ms past its limit; dropped: ${JSON.stringify(text)}`)
        }
      }
    }
    if (aside) await discard(i)
    if (!cue) continue
    const j = kept.length
    if (j !== i) for (const f of [cueAudioFile, cueSidecarFile]) await rename(`${ctx.work}/${f(i)}`, `${ctx.work}/${f(j)}`)
    kept.push({ ...cue, startMs, text, endMs: startMs + durationMs, wordCount: words(text) })
  }
  if (texts.length) kept = await withTextCues(ctx.work, kept, texts, synth, (i, text) => reusable(ctx.work, i, { text, voice: ctx.voice, language, ssml: cueSsml(text) }))
  kept = await afterClips(ctx.work, kept)
  await removeCueFilesFrom(ctx.work, kept.length)
  warnOverlaps(kept)
  await writeFile(`${ctx.work}/cues.json`, JSON.stringify(kept, null, 2))
}

/**
 * Merges split-off text cues into the kept cues in start order (a text cue before a kept cue of the same start), moves every kept
 * clip to its new slot (through temporary names, so no clip overwrites one not yet moved), then voices each text cue in its slot.
 */
async function withTextCues(work: string, kept: FitCue[], texts: FitCue[], synth: (i: number, text: string) => Promise<number>, reuse: (i: number, text: string) => Promise<number | undefined>): Promise<FitCue[]> {
  const all = [...kept.map((c, from) => ({ c, from })), ...texts.map((c) => ({ c, from: -1 }))]
  all.sort((a, b) => byStart(a.c, b.c))
  const moves = all.flatMap(({ from }, to) => (from >= 0 && from !== to ? [{ from, to }] : []))
  const files = [cueAudioFile, cueSidecarFile]
  for (const { from } of moves) for (const f of files) await rename(`${work}/${f(from)}`, `${work}/${MOVING}${f(from)}`)
  for (const { from, to } of moves) for (const f of files) await rename(`${work}/${MOVING}${f(from)}`, `${work}/${f(to)}`)
  for (const [to, x] of all.entries()) if (x.from < 0) x.c = { ...x.c, endMs: x.c.startMs + ((await reuse(to, x.c.text)) ?? await synth(to, x.c.text)) }
  return all.map((x) => x.c)
}

/** Prefix of withTextCues' temporary clip names; any left over are deleted when voice starts. */
const MOVING = 'moving_'
/** Prefix of a clip set aside during the overrun shortening (deleted with the MOVING ones when voice starts). */
const ORIG = `${MOVING}orig_`

/** An extended cue that is only on-screen text (fit's split, or withTextCues'). */
const textOnly = (c: FitCue) => c.extended && textClauses(c.text)?.rest === ''
/** On-screen text as said: case, spacing and the closing period aside ("The End." in quotes and bare "The End" are one text). */
const asSaid = (body: string) => body.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.!?]+$/, '')
/** The on-screen text of a line, each clause's text as said (label and quotes aside). */
const bodies = (t: string) => textSpans(t).map((s) => asSaid(s.body))
/** `text` without the on-screen text clauses whose text is in `said` (as `bodies` reads it); '' when nothing else was there. Pure (tested). */
export function withoutSaidText(text: string, said: readonly string[]): string {
  const spans = said.length ? textSpans(text).filter((s) => said.includes(asSaid(s.body))) : []
  if (!spans.length) return text
  let out = '', at = 0
  for (const s of spans) { out += text.slice(at, s.start); at = s.end }
  return (out + text.slice(at)).replace(/\s+/g, ' ').trim()
}
/**
 * A pause must not start while a clip still speaks: every extended cue (on-screen text, event, introducesNew) starts at or after the
 * measured end of every placed cue before it — fit's starts were estimates (a text cue TEXT_LEAD_MS before its action; an event cue at the
 * shot start, which can be inside the previous clip). Keeps its clip length. The cap holds after the move: an event cue that now starts
 * within EVENT_SPACING_MS of an earlier event cue (in start order) is dropped, deterministically. Re-sorted (byStart) and the clips
 * re-slotted when anything moved. Pure apart from the clip files (tested through voice).
 */
async function afterClips(work: string, cues: FitCue[]): Promise<FitCue[]> {
  let end = -Infinity, moved = false
  const all = cues.map((c, from) => {
    if (!c.extended) { end = Math.max(end, c.endMs); return { c, from } }
    if (c.startMs >= end) return { c, from }
    moved = true
    return { c: { ...c, startMs: end, endMs: end + (c.endMs - c.startMs) }, from }
  })
  if (!moved) return cues
  all.sort((a, b) => byStart(a.c, b.c))
  let lastEvent = -Infinity
  const dropped: number[] = []
  const out = all.filter(({ c, from }) => {
    if (!c.event) return true
    if (c.startMs - lastEvent < EVENT_SPACING_MS) { console.log(`voice: event cue moved to ${c.startMs} ms is within ${EVENT_SPACING_MS} ms of the one at ${lastEvent} ms; dropped: ${JSON.stringify(c.text)}`); dropped.push(from); return false }
    lastEvent = c.startMs
    return true
  })
  for (const from of dropped) for (const f of [cueAudioFile, cueSidecarFile]) await rm(`${work}/${f(from)}`, { force: true })
  const moves = out.flatMap(({ from }, to) => (from !== to ? [{ from, to }] : []))
  for (const { from } of moves) for (const f of [cueAudioFile, cueSidecarFile]) await rename(`${work}/${f(from)}`, `${work}/${MOVING}${f(from)}`)
  for (const { from, to } of moves) for (const f of [cueAudioFile, cueSidecarFile]) await rename(`${work}/${MOVING}${f(from)}`, `${work}/${f(to)}`)
  return out.map((x) => x.c)
}
/** The previous placed cue's text — what the AD track said before this cue; '' when none. An event is new against that, whatever the mode. */
const previousPlaced = (kept: readonly FitCue[]) => [...kept].reverse().find((k) => !k.extended)?.text ?? ''

/** The stored clip's duration when cue_{i}.mp3 exists and its sidecar matches; undefined otherwise. */
async function reusable(work: string, i: number, want: Omit<CueSidecar, 'durationMs'>): Promise<number | undefined> {
  const side = await readFile(`${work}/${cueSidecarFile(i)}`, 'utf8').then((t) => { try { return JSON.parse(t) as Partial<CueSidecar> } catch { return undefined } }, () => undefined)
  if (!side || side.text !== want.text || side.voice !== want.voice || side.language !== want.language || side.ssml !== want.ssml) return undefined
  if (typeof side.durationMs !== 'number' || !(side.durationMs > 0)) return undefined
  return (await readFile(`${work}/${cueAudioFile(i)}`).then(() => true, () => false)) ? side.durationMs : undefined
}

/** Deletes cue_{k}.mp3 and cue_{k}.json for every k ≥ from. */
async function removeCueFilesFrom(work: string, from: number) {
  for (const f of await readdir(work)) {
    const m = CUE_FILE.exec(f)
    if (m && Number(m[1]) >= from) await rm(`${work}/${f}`, { force: true })
  }
}

/** Two placed clips that overlap are both heard. The limit keeps them apart, but up to OVERRUN_TOLERANCE_MS of overlap is allowed: warn about it. */
function warnOverlaps(cues: FitCue[]) {
  const placed = cues.filter((c) => !c.extended)
  for (let k = 1; k < placed.length; k++) {
    const a = placed[k - 1]!, b = placed[k]!
    if (a.endMs > b.startMs) console.warn(`voice: narration at ${a.startMs} ms ends at ${a.endMs} ms, after the next cue starts (${b.startMs} ms)`)
  }
}

export const LanguageSchema = z.enum(['en', 'de'])
/** Polly neural voice per language when --voice is not given; POLLY_VOICE_EN / POLLY_VOICE_DE (.env.example) override the built-ins. */
const DEFAULT_VOICES = { en: 'Joanna', de: 'Vicki' } as const
/** Pure (tested): validates --lang (zod enum, default en) and picks --voice, else POLLY_VOICE_{EN,DE}, else Joanna / Vicki. */
export function resolveLanguageAndVoice(o: { lang?: string; voice?: string }, env: Record<string, string | undefined> = process.env): { language: 'en' | 'de'; voice: string } {
  const language = LanguageSchema.parse(o.lang ?? 'en')
  return { language, voice: o.voice || env[`POLLY_VOICE_${language.toUpperCase()}`] || DEFAULT_VOICES[language] }
}
const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
