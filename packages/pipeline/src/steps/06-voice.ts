import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly'
import { execa } from 'execa'
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Ctx } from './index'
import { byStart, capExtended, introducesNew, LATE_MS, leadText, shortenDeterministic, shortenKeepingAction, TAIL_SILENCE_MS, textClauses, type FitCue } from './05-fit'
import type { Shot } from './02-shots'
import { cueAudioFile, probeDurationMs } from '../cues'
import { meter, pollyUsd } from '../cost'
import { polishCue } from '../polishCue'
import { textSpans, withoutSpans } from '../textClause'
import { EVENT_SPACING_MS, eventSpaced, plotEvent } from '../plotEvent'

/**
 * A clip FILE may run this far past its limit (its gap's end, or the next placed cue's start − NEXT_CUE_SPACING_MS) — never past the next
 * placed cue's start — while its SPEECH ends by the limit (decision 0009): the extra is Polly's trailing silence.
 */
export const OVERRUN_TOLERANCE_MS = 200
/** fit's spacing between two cues in one gap (its cursor: end + 150 ms). */
export const NEXT_CUE_SPACING_MS = 150
/** work/{slug}/cue_{i}.json: what clip cue_{i}.mp3 says, in which voice, with which SSML (so a wrapper change re-synthesizes), and how long it is. */
export interface CueSidecar { text: string; voice: string; language: 'en' | 'de'; ssml: string; durationMs: number; /** The clip's speech: up to its trailing silence (decision 0009). */ speechMs?: number }
export const cueSidecarFile = (i: number) => `cue_${i}.json`
const CUE_FILE = /^cue_(\d+)\.(mp3|json)$/

/** Polly and ffprobe, injected so tests make no AWS call. */
export interface VoiceDeps {
  synthesize?: (text: string, voice: string, language: 'en' | 'de') => Promise<Uint8Array>
  /** Clip duration in ms. */
  measureMs?: (file: string) => Promise<number>
  /**
   * The clip's speech in ms (up to its trailing silence), or undefined when it cannot be measured: then it is the clip's duration −
   * TAIL_SILENCE_MS. Default: ffmpeg silencedetect, unless measureMs is injected (tests), when the fallback is used.
   */
  measureSpeechMs?: (file: string) => Promise<number | undefined>
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
/** Decision 0009: `ffmpeg -af silencedetect=noise=-45dB:d=0.05` — https://ffmpeg.org/ffmpeg-filters.html#silencedetect */
export const silenceDetectArgs = (file: string) => ['-hide_banner', '-nostats', '-i', file, '-af', 'silencedetect=noise=-45dB:d=0.05', '-f', 'null', '-']
/**
 * Pure (tested): the speech length from silencedetect's log — the start of the last silence when it runs to the clip's end (no
 * silence_end after it, or one within 30 ms of durationMs); durationMs when the clip does not end in silence.
 */
export function parseSpeechMs(stderr: string, durationMs: number): number {
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => parseFloat(m[1]!))
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => parseFloat(m[1]!))
  if (!starts.length) return durationMs
  const trailing = ends.length < starts.length || ends.at(-1)! * 1000 >= durationMs - 30
  return trailing ? Math.min(durationMs, Math.round(starts.at(-1)! * 1000)) : durationMs
}
/** The speech length of a clip, or undefined when ffmpeg fails (the caller falls back to duration − TAIL_SILENCE_MS). */
export const ffmpegSpeechMs = (signal?: AbortSignal) => async (file: string, durationMs: number) => {
  try { return parseSpeechMs((await execa('ffmpeg', silenceDetectArgs(file), { cancelSignal: signal })).stderr, durationMs) } catch (e) { if (signal?.aborted) throw e; return undefined }
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
 *    fixed by now, so a clip longer than fit's estimate must not run into the next cue of the same gap. A clip whose speech ends past
 *    the limit, or whose file ends past limit + OVERRUN_TOLERANCE_MS or the next placed cue's start (decision 0009; the speech from
 *    ffmpeg silencedetect, stored in the sidecar, else duration − TAIL_SILENCE_MS), is shortened deterministically (shortenKeepingAction: unchanged when the shortening would be only a subject, end mid-phrase, become a
 *    noun list (DESC-028) or lose the action (g11: else the first sentence or clause with the action)) to max(3, ⌊words × (limit − startMs) / durationMs⌋) words and
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
 * A cue starting at or after the title's end (probe.json) is never voiced: left out before the loop, and dropped with its clip when
 * afterClips moves a pause there (beforeFilmEnd, dropPastEnd), so 07-mix, descriptions.vtt and the rows agree.
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
  const ffmpegSpeech = ffmpegSpeechMs(ctx.signal)
  const measureSpeech = deps.measureSpeechMs ? (f: string) => deps.measureSpeechMs!(f) : deps.measureMs ? async () => undefined : (f: string, d: number) => ffmpegSpeech(f, d)
  /**
   * Decision 0009: the measured speech (`measured`), else the clip minus its usual tail, with a warning. A measured 0 (an all-silent clip
   * at −45 dB) counts as a failed measurement.
   */
  const speechOf = async (file: string, durationMs: number): Promise<{ speechMs: number; measured: boolean }> => {
    const m = await measureSpeech(file, durationMs)
    if (m !== undefined && m > 0) return { speechMs: m, measured: true }
    const speechMs = Math.max(0, durationMs - TAIL_SILENCE_MS)
    console.warn(`voice: speech not measured for ${file}${m === 0 ? ' (all silent)' : ''}; using the clip length − TAIL_SILENCE_MS = ${speechMs} ms`)
    return { speechMs, measured: false }
  }
  const filmMs = await probeDurationMs(ctx.work)
  const cues = beforeFilmEnd(JSON.parse(await readFile(`${ctx.work}/cues.json`, 'utf8')) as FitCue[], filmMs)
  const language = ctx.language
  await removeCueFilesFrom(ctx.work, cues.length)
  for (const f of await readdir(ctx.work)) if (f.startsWith(MOVING)) await rm(`${ctx.work}/${f}`, { force: true }) // left by a crash in withTextCues
  const shotList = JSON.parse(await readFile(`${ctx.work}/shots.json`, 'utf8').catch(() => '[]')) as Shot[]
  const shotStart = new Map(shotList.map((x) => [x.index, x.startMs]))
  const shotEnd = new Map(shotList.map((x) => [x.index, x.endMs]))
  /** Synthesizes text into slot i (overwriting it) and returns the clip's duration and speech length. */
  const synth = async (i: number, text: string): Promise<Clip> => {
    const file = `${ctx.work}/${cueAudioFile(i)}`
    const audio = await synthesize(polishCue(text, language), ctx.voice, language) // DESC-033: capital letters and full stops, quotes untouched
    meter()?.add(pollyUsd(text.length))
    await writeFile(file, audio)
    const durationMs = await measureMs(file)
    const { speechMs, measured } = await speechOf(file, durationMs)
    // an estimated speech end is not stored: a later run measures it again
    await writeFile(`${ctx.work}/${cueSidecarFile(i)}`, JSON.stringify({ text, voice: ctx.voice, language, ssml: cueSsml(polishCue(text, language)), durationMs, ...(measured ? { speechMs } : {}) } satisfies CueSidecar))
    return { durationMs, speechMs }
  }
  /** The stored clip of slot i when its sidecar matches (its speech measured now when the sidecar predates decision 0009). */
  const reuse = async (i: number, text: string): Promise<Clip | undefined> => {
    const r = await reusable(ctx.work, i, { text, voice: ctx.voice, language, ssml: cueSsml(polishCue(text, language)) }) // the clip key is what Polly heard: a clip voiced before DESC-033 is re-voiced
    return r && { durationMs: r.durationMs, speechMs: r.speechMs ?? (await speechOf(`${ctx.work}/${cueAudioFile(i)}`, r.durationMs)).speechMs }
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
    let { durationMs, speechMs } = (await reuse(i, text)) ?? await synth(i, text)
    let cue: FitCue | null = { ...c }
    let startMs = c.startMs
    let aside: { text: string; durationMs: number; speechMs: number } | undefined
    const next = cues.slice(i + 1).find((x) => !x.extended)
    const limit = c.limitMs === undefined ? undefined : Math.min(c.limitMs, next ? next.startMs - NEXT_CUE_SPACING_MS : Infinity)
    /** Decision 0009: the speech ends by the limit; the file by limit + OVERRUN_TOLERANCE_MS and never past the next placed cue's start. */
    const overruns = (start: number) => limit !== undefined && (start + speechMs > limit || start + durationMs > Math.min(limit + OVERRUN_TOLERANCE_MS, next ? next.startMs : Infinity))
    if (limit !== undefined && overruns(c.startMs)) {
      const maxWords = Math.max(3, Math.floor((words(text) * (limit - c.startMs)) / durationMs))
      const shorter = shortenKeepingAction(text, maxWords, 'voice', ctx.language) // DESC-028: a shortening that is not sentences is no shortening; g11: nor one that drops the action
      if (shorter !== text) { await setAside(i); aside = { text, durationMs, speechMs }; text = shorter; ({ durationMs, speechMs } = await synth(i, text)) }
      const tc = overruns(c.startMs) ? textClauses(text) : undefined
      if (tc?.rest) {
        const fitWords = Math.max(3, Math.floor((words(text) * (limit - c.startMs)) / durationMs))
        const { limitMs: _, ...rest } = c
        const clause = (await capExtended(tc.clause, shortenDeterministic, ctx.language))?.text ?? tc.clause // the clause is never cut: whole when capExtended gives no cue
        texts.push({ ...rest, endMs: c.startMs + 100, text: clause, extended: true, wordCount: words(clause) })
        console.log(`voice: cue ${i} at ${c.startMs} ms: on-screen text split into its own extended cue: ${JSON.stringify(clause)}`)
        text = shortenKeepingAction(tc.rest, fitWords, 'voice', ctx.language)
        ;({ durationMs, speechMs } = await synth(i, text))
        const prevEnd = Math.max(shotStart.get(c.shotIndex) ?? c.startMs, ...kept.filter((k) => !k.extended).map((k) => k.endMs)) // every kept clip's measured end: one may run past this cue's start (within tolerance)
        const lead = leadText(c.startMs, prevEnd, (later) => !overruns(later))
        texts.at(-1)!.startMs = lead.textStart
        texts.at(-1)!.endMs = lead.textStart + 100
        startMs = lead.actionStart
      }
      if (overruns(startMs)) {
        if (introducesNew(text)) {
          const capped = (await capExtended(text, shortenDeterministic, ctx.language))?.text // DESC-028: undefined when no cut reads as sentences
          if (capped === undefined) {
            cue = null
            console.log(`voice: cue ${i} at ${c.startMs} ms runs past its limit and no extended cut reads as sentences; dropped: ${JSON.stringify(text)}`)
          } else {
            if (capped !== text) { text = capped; ({ durationMs, speechMs } = await synth(i, text)) }
            const { limitMs: _, ...rest } = c
            cue = { ...rest, extended: true }
            console.log(`voice: cue ${i} at ${c.startMs} ms runs ${c.startMs + durationMs - limit} ms past its limit; now extended: ${JSON.stringify(text)}`)
          }
        } else if (plotEvent(base, previousPlaced(kept)) && eventSpaced(eventStarts, startMs)) {
          // the full text (the rest, when the on-screen text was split off above — said once, in its own pause), not the slot shortening
          const full = (await capExtended(tc?.rest ? textClauses(base)!.rest : base, shortenDeterministic, ctx.language))?.text // DESC-028: undefined → dropped
          if (full === undefined) {
            cue = null
            console.log(`voice: cue ${i} at ${startMs} ms runs past its limit, a new plot event with no extended cut that reads as sentences; dropped: ${JSON.stringify(base)}`)
          } else {
            if (full === aside?.text) { await restore(i); text = full; durationMs = aside.durationMs; speechMs = aside.speechMs; aside = undefined }
            else if (full !== text) { text = full; ({ durationMs, speechMs } = await synth(i, text)) }
            const { limitMs: _, ...rest } = c
            cue = { ...rest, extended: true, event: true }
            eventStarts.push(startMs)
            console.log(`voice: cue ${i} at ${startMs} ms runs ${c.startMs + durationMs - limit} ms past its limit; a new plot event, now extended: ${JSON.stringify(text)}`)
          }
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
  if (texts.length) kept = await withTextCues(ctx.work, kept, texts, synth, reuse)
  /** Voices a shorter text for the placed cue in slot `from` (a spare slot first; moved in only when it is used): afterClips' on-time fix. */
  const reshorten = async (from: number, text: string): Promise<Clip | undefined> => {
    const spare = SPARE_SLOT + from
    const clip = await synth(spare, text)
    for (const f of [cueAudioFile, cueSidecarFile]) await rename(`${ctx.work}/${f(spare)}`, `${ctx.work}/${f(from)}`)
    return clip
  }
  kept = await afterClips(ctx.work, kept, { start: shotStart, end: shotEnd }, reshorten, language)
  kept = await dropPastEnd(ctx.work, kept, filmMs)
  await removeCueFilesFrom(ctx.work, kept.length)
  warnOverlaps(kept)
  await writeFile(`${ctx.work}/cues.json`, JSON.stringify(kept, null, 2))
}

/**
 * Merges split-off text cues into the kept cues in start order (a text cue before a kept cue of the same start), moves every kept
 * clip to its new slot (through temporary names, so no clip overwrites one not yet moved), then voices each text cue in its slot.
 */
async function withTextCues(work: string, kept: FitCue[], texts: FitCue[], synth: (i: number, text: string) => Promise<Clip>, reuse: (i: number, text: string) => Promise<Clip | undefined>): Promise<FitCue[]> {
  const all = [...kept.map((c, from) => ({ c, from })), ...texts.map((c) => ({ c, from: -1 }))]
  all.sort((a, b) => byStart(a.c, b.c))
  const moves = all.flatMap(({ from }, to) => (from >= 0 && from !== to ? [{ from, to }] : []))
  const files = [cueAudioFile, cueSidecarFile]
  for (const { from } of moves) for (const f of files) await rename(`${work}/${f(from)}`, `${work}/${MOVING}${f(from)}`)
  for (const { from, to } of moves) for (const f of files) await rename(`${work}/${MOVING}${f(from)}`, `${work}/${f(to)}`)
  for (const [to, x] of all.entries()) if (x.from < 0) x.c = { ...x.c, endMs: x.c.startMs + ((await reuse(to, x.c.text)) ?? await synth(to, x.c.text)).durationMs }
  return all.map((x) => x.c)
}

/** A slot index far past any title's cues, for afterClips' shortened re-voice before it replaces the clip. */
const SPARE_SLOT = 100_000
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
  return spans.length ? withoutSpans(text, spans) : text
}
/**
 * A pause must not start while a clip still speaks: every extended cue (on-screen text, event, introducesNew, scene) starts at or after
 * the measured end of every placed cue before it (`before`: an earlier shot's, or one that starts earlier) — fit's starts were estimates.
 * Decision 0012 amendment (2026-10-15, review): a pause that is not only on-screen text and would start more than LATE_MS after its
 * shot instead starts at max(its shot's start, the measured ends of the placed cues of earlier shots), at the first moment no clip speaks
 * — so it moves EARLIER when fit's estimate ran long (g10 shots 19 and 24, tos-390-510-g10 shot 13 were late only because of the
 * estimate). Other pauses keep their start or move later as before; a text cue keeps DESC-017's lead.
 * The on-time rule (LATE_MS after its shot's end, shots.json) is checked on every pause, moved or not: an event pause still late first
 * shortens the placed cue that blocks it (shortenKeepingAction, voiced in a spare slot, then put in that cue's slot) — the plot event
 * outranks the earlier cue's extra words (0007) — and is dropped only when that does not help. A pause that is only on-screen text is
 * never dropped (DESC-017: neither the text nor the action is dropped). The event cap holds after the moves: an event cue now within
 * EVENT_SPACING_MS of an earlier one (in start order) is dropped. Re-sorted (byStart) and the clips re-slotted. Pure apart from the clip
 * files (tested through voice).
 */
async function afterClips(work: string, cues: FitCue[], shots: { start: ReadonlyMap<number, number>; end: ReadonlyMap<number, number> } = { start: new Map(), end: new Map() }, reshorten?: (from: number, text: string) => Promise<Clip | undefined>, language: 'en' | 'de' = 'en'): Promise<FitCue[]> {
  const placed = cues.map((c, from) => ({ c, from })).filter((x) => !x.c.extended)
  /** The first start ≥ t at which no placed clip speaks. */
  /** The first start ≥ t at which no clip of an earlier shot than `shot` speaks. */
  const free = (t: number, shot: number) => { let at = t; for (let moved = true; moved;) { moved = false; for (const { c: p } of placed) if (p.shotIndex < shot && p.startMs <= at && at < p.endMs) { at = p.endMs; moved = true } } return at }
  /** Some clip of a later shot speaks at t. */
  const laterSpeaks = (t: number, shot: number) => placed.some(({ c: p }) => p.shotIndex > shot && p.startMs <= t && t < p.endMs)
  const startOf = (c: FitCue) => {
    const later = Math.max(c.startMs, ...placed.filter(({ c: p }) => before(p, c)).map(({ c: p }) => p.endMs))
    const shotStart = shots.start.get(c.shotIndex), shotEnd = shots.end.get(c.shotIndex)
    if (textOnly(c) || shotStart === undefined || shotEnd === undefined || later <= shotEnd + LATE_MS) return later
    // late only because fit's estimate ran long: as early as its shot and the measured clips of earlier cues allow
    const earlier = placed.filter(({ c: p }) => p.shotIndex < c.shotIndex || (p.shotIndex === c.shotIndex && byStart(p, c) < 0)).map(({ c: p }) => p.endMs)
    const at = free(Math.max(shotStart, ...earlier), c.shotIndex)
    return laterSpeaks(at, c.shotIndex) ? later : at // never onto a later shot's clip: then it stays where it was (and is checked late)
  }
  let changed = false
  const all = cues.map((c, from) => {
    if (!c.extended) return { c, from }
    const startMs = startOf(c)
    if (startMs === c.startMs) return { c, from }
    changed = true
    return { c: { ...c, startMs, endMs: startMs + (c.endMs - c.startMs) }, from }
  })
  // the on-time rule, on every pause: an event pause first shortens the placed cue that blocks it
  for (const x of all) {
    const c = x.c, end = shots.end.get(c.shotIndex)
    if (!c.extended || textOnly(c) || end === undefined || c.startMs <= end + LATE_MS) continue
    const block = placed.find(({ c: p }) => p.endMs === c.startMs && p.shotIndex < c.shotIndex) // only an earlier shot's cue is shortened
    if (!c.event || !block || !reshorten) continue
    const deadline = end + LATE_MS, p = block.c
    const n = Math.floor((words(p.text) * (deadline - p.startMs)) / (p.endMs - p.startMs))
    const shorter = n >= 3 ? shortenKeepingAction(p.text, n, 'voice', language) : p.text
    if (shorter === p.text) continue
    const clip = await reshorten(block.from, shorter)
    if (!clip) continue
    console.log(`voice: cue at ${p.startMs} ms shortened so the event pause of shot ${c.shotIndex} is on time: ${JSON.stringify(p.text)} → ${JSON.stringify(shorter)}`)
    const q = all.find((y) => y.from === block.from)!
    q.c = { ...p, text: shorter, wordCount: words(shorter), endMs: p.startMs + clip.durationMs }
    block.c = q.c
    const s = startOf(c)
    x.c = { ...c, startMs: s, endMs: s + (c.endMs - c.startMs) }
    changed = true
  }
  all.sort((a, b) => byStart(a.c, b.c))
  let lastEvent = -Infinity
  const dropped: number[] = []
  const out = all.filter(({ c, from }) => {
    const end = shots.end.get(c.shotIndex)
    if (c.extended && !textOnly(c) && end !== undefined && c.startMs > end + LATE_MS) { console.log(`voice: pause at ${c.startMs} ms starts ${c.startMs - end} ms after its shot ends (> ${LATE_MS}); dropped: ${JSON.stringify(c.text)}`); dropped.push(from); return false }
    if (!c.event) return true
    if (c.startMs - lastEvent < EVENT_SPACING_MS) { console.log(`voice: event cue moved to ${c.startMs} ms is within ${EVENT_SPACING_MS} ms of the one at ${lastEvent} ms; dropped: ${JSON.stringify(c.text)}`); dropped.push(from); return false }
    lastEvent = c.startMs
    return true
  })
  if (!changed && !dropped.length && out.every(({ from }, to) => from === to)) return cues
  for (const from of dropped) for (const f of [cueAudioFile, cueSidecarFile]) await rm(`${work}/${f(from)}`, { force: true })
  const moves = out.flatMap(({ from }, to) => (from !== to ? [{ from, to }] : []))
  for (const { from } of moves) for (const f of [cueAudioFile, cueSidecarFile]) await rename(`${work}/${f(from)}`, `${work}/${MOVING}${f(from)}`)
  for (const { from, to } of moves) for (const f of [cueAudioFile, cueSidecarFile]) await rename(`${work}/${MOVING}${f(from)}`, `${work}/${f(to)}`)
  return out.map((x) => x.c)
}
/**
 * Whether placed cue p is heard before pause e (decision 0009 review): by shot, then by start — a placed cue of an earlier shot comes
 * first even when fit started e's pause sooner (g9: shot 9's event pause at its shot start, inside shot 8's late clip); within one
 * shot by start (byStart: a text cue first on a shared start); a later shot's placed cue that starts before e still counts, so no
 * pause starts while any clip speaks.
 */
const before = (p: FitCue, e: FitCue) => p.shotIndex < e.shotIndex || (p.shotIndex === e.shotIndex ? byStart(p, e) < 0 : p.startMs < e.startMs)
/**
 * Cues starting before the title's end (probe.json; all of them when the duration is unknown). A cue at or after the end cannot be
 * heard — the mix ends with the film and the app has nothing left to pause — so it is left out before any Polly call, and the mix,
 * descriptions.vtt and the DescriptionCue rows agree (../cues filmEnds applies the same rule). Pure (tested through voice).
 */
function beforeFilmEnd(cues: FitCue[], filmMs: number | undefined): FitCue[] {
  if (filmMs === undefined) return cues
  for (const c of cues) if (c.startMs >= filmMs) console.log(`voice: cue at ${c.startMs} ms starts at or after the title's end (${filmMs} ms); not voiced: ${JSON.stringify(c.text)}`)
  return cues.filter((c) => c.startMs < filmMs)
}
/** After afterClips moved pauses later: drops any cue now starting at or after the title's end, its clip with it, and moves later clips down a slot. */
async function dropPastEnd(work: string, cues: FitCue[], filmMs: number | undefined): Promise<FitCue[]> {
  const out: FitCue[] = []
  for (const [from, c] of cues.entries()) {
    const files = [cueAudioFile, cueSidecarFile]
    if (filmMs !== undefined && c.startMs >= filmMs) {
      console.log(`voice: cue moved to ${c.startMs} ms starts at or after the title's end (${filmMs} ms); dropped: ${JSON.stringify(c.text)}`)
      for (const f of files) await rm(`${work}/${f(from)}`, { force: true })
      continue
    }
    if (out.length !== from) for (const f of files) await rename(`${work}/${f(from)}`, `${work}/${f(out.length)}`) // ascending: slot out.length is already free
    out.push(c)
  }
  return out
}
/** The previous placed cue's text — what the AD track said before this cue; '' when none. An event is new against that, whatever the mode. */
const previousPlaced = (kept: readonly FitCue[]) => [...kept].reverse().find((k) => !k.extended)?.text ?? ''

/** A voiced clip: its file length and its speech (up to the trailing silence), in ms. */
interface Clip { durationMs: number; speechMs: number }
/** The stored clip's duration (and speech, when the sidecar has it) when cue_{i}.mp3 exists and its sidecar matches; undefined otherwise. */
async function reusable(work: string, i: number, want: Omit<CueSidecar, 'durationMs' | 'speechMs'>): Promise<{ durationMs: number; speechMs?: number } | undefined> {
  const side = await readFile(`${work}/${cueSidecarFile(i)}`, 'utf8').then((t) => { try { return JSON.parse(t) as Partial<CueSidecar> } catch { return undefined } }, () => undefined)
  if (!side || side.text !== want.text || side.voice !== want.voice || side.language !== want.language || side.ssml !== want.ssml) return undefined
  if (typeof side.durationMs !== 'number' || !(side.durationMs > 0)) return undefined
  const speechMs = typeof side.speechMs === 'number' && side.speechMs > 0 ? side.speechMs : undefined
  return (await readFile(`${work}/${cueAudioFile(i)}`).then(() => true, () => false)) ? { durationMs: side.durationMs, ...(speechMs === undefined ? {} : { speechMs }) } : undefined
}

/** Deletes cue_{k}.mp3 and cue_{k}.json for every k ≥ from. */
async function removeCueFilesFrom(work: string, from: number) {
  for (const f of await readdir(work)) {
    const m = CUE_FILE.exec(f)
    if (m && Number(m[1]) >= from) await rm(`${work}/${f}`, { force: true })
  }
}

/** Two placed clips that overlap are both heard. Decision 0009 keeps every file before the next placed cue's start; warn if one still does. */
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
