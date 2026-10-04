import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly'
import { execa } from 'execa'
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Ctx } from './index'
import { capExtended, introducesNew, shortenDeterministic, type FitCue } from './05-fit'
import { cueAudioFile } from '../cues'
import { meter, pollyUsd } from '../cost'

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
 *    synthesized once more. Still over: it becomes an extended cue
 *    when the text introduces something new (capped like fit's extended cues), else it is dropped.
 * 3. cues.json is written back with endMs = startMs + durationMs for every kept cue; 07-mix and 08-text read those ends.
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
  const kept: FitCue[] = []
  for (const [i, c] of cues.entries()) {
    ctx.signal?.throwIfAborted()
    let text = c.text
    let durationMs = (await reusable(ctx.work, i, { text, voice: ctx.voice, language, ssml: cueSsml(text) })) ?? await synth(i, text)
    let cue: FitCue | null = { ...c }
    const next = cues.slice(i + 1).find((x) => !x.extended)
    const limit = c.limitMs === undefined ? undefined : Math.min(c.limitMs, next ? next.startMs - NEXT_CUE_SPACING_MS : Infinity)
    if (limit !== undefined && c.startMs + durationMs > limit + OVERRUN_TOLERANCE_MS) {
      const maxWords = Math.max(3, Math.floor((words(text) * (limit - c.startMs)) / durationMs))
      const shorter = shortenDeterministic(text, maxWords)
      if (shorter !== text) { text = shorter; durationMs = await synth(i, text) }
      if (c.startMs + durationMs > limit + OVERRUN_TOLERANCE_MS) {
        if (introducesNew(text)) {
          const capped = (await capExtended(text, shortenDeterministic)).text
          if (capped !== text) { text = capped; durationMs = await synth(i, text) }
          const { limitMs: _, ...rest } = c
          cue = { ...rest, extended: true }
          console.log(`voice: cue ${i} at ${c.startMs} ms runs ${c.startMs + durationMs - limit} ms past its limit; now extended: ${JSON.stringify(text)}`)
        } else {
          cue = null
          console.log(`voice: cue ${i} at ${c.startMs} ms runs ${c.startMs + durationMs - limit} ms past its limit; dropped: ${JSON.stringify(text)}`)
        }
      }
    }
    if (!cue) continue
    const j = kept.length
    if (j !== i) for (const f of [cueAudioFile, cueSidecarFile]) await rename(`${ctx.work}/${f(i)}`, `${ctx.work}/${f(j)}`)
    kept.push({ ...cue, text, endMs: cue.startMs + durationMs, wordCount: words(text) })
  }
  await removeCueFilesFrom(ctx.work, kept.length)
  warnOverlaps(kept)
  await writeFile(`${ctx.work}/cues.json`, JSON.stringify(kept, null, 2))
}

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
