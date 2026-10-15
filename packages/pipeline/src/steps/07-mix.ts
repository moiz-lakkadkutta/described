import { cueAudioFile, trackClipFile } from '../cues'
import { execa } from 'execa'
import { readdir, readFile, rm } from 'node:fs/promises'
import type { Ctx } from './index'
import type { FitCue } from './05-fit'

/**
 * Build the AD rendition: narration placed at cue times, original ducked −9 dB under narration (sidechain, attack 10 ms,
 * release 300 ms), then loudness-normalised to −24 LUFS / −2 dBTP. Netflix AD spec: 6–12 dB dip, 2–15 ms attack.
 * Three ffmpeg passes: duck + mix → premix.wav; loudnorm measure (JSON); loudnorm apply (linear, two-pass) → audio_ad.m4a.
 * Filter docs: https://ffmpeg.org/ffmpeg-filters.html (#sidechaincompress, #aevalsrc, #apad, #amix, #loudnorm).
 */
export async function mix(ctx: Ctx) {
  const cues = (JSON.parse(await readFile(`${ctx.work}/cues.json`, 'utf8')) as FitCue[]).map((c, i) => ({ ...c, i })).filter((c) => !c.extended)
  const probe = JSON.parse(await readFile(`${ctx.work}/probe.json`, 'utf8')) as { format: { duration: string } }
  const durationS = parseFloat(probe.format.duration)
  await execa('ffmpeg', buildMixArgs(ctx.work, cues, durationS), { stdio: 'inherit' })
  await writeTrackClips(ctx.work, appliedGainDb(await normalise(ctx.work)))
}

/** Passes B and C on work/premix.wav → work/audio_ad.m4a; returns what the apply pass reports it did. */
export async function normalise(work: string): Promise<LoudnormReport> {
  const { stderr } = await execa('ffmpeg', buildLoudnormMeasureArgs(work))
  const applied = await execa('ffmpeg', buildLoudnormApplyArgs(work, parseLoudnorm(stderr)))
  return parseLoudnormReport(applied.stderr)
}

/**
 * The clips the app plays (Extended mode's pauses, the Title sample) at the level the narration has in the AD track: every
 * cue's Polly clip through the narration's own chain — the mix's 48 kHz stereo format, its limiter (NARRATION_LIMIT) and the
 * loudnorm gain the apply pass reported (appliedGainDb) — as work/{slug}/cue_{i}.track.mp3, which 10-publish uploads. The raw
 * Polly clip played ~7.5 dB louder than the same voice in the track (Sintel, measured against the published audio_ad), so a
 * pause sounded like a second narrator. All cues, extended or not, so a stale file from an earlier run never survives.
 * `gainDb` null (loudnorm ran dynamic, so the track has no one gain): stale clips are removed, none is written, and 10-publish
 * falls back to the Polly clips with its own warning.
 */
export async function writeTrackClips(work: string, gainDb: number | null) {
  const count = (JSON.parse(await readFile(`${work}/cues.json`, 'utf8')) as unknown[]).length
  for (const f of (await readdir(work)).filter((f) => /^cue_\d+\.track\.mp3$/.test(f))) await rm(`${work}/${f}`, { force: true })
  if (gainDb === null) {
    console.warn('mix: loudnorm normalised the AD track dynamically (its gain varies over the film), so no app clip can match it; no cue_{i}.track.mp3 written, publish uploads the Polly clips as they are')
    return
  }
  const have = new Set(await readdir(work))
  const todo = Array.from({ length: count }, (_, i) => i).filter((i) => have.has(cueAudioFile(i)))
  for (let k = 0; k < todo.length; k += 8) await Promise.all(todo.slice(k, k + 8).map((i) => execa('ffmpeg', buildTrackClipArgs(work, i, gainDb))))
  console.log(`mix: ${todo.length} app clips at the track's narration level (${gainDb.toFixed(2)} dB after the limiter)`)
}

/** The limiter on the summed narration. The app's clips go through it too (buildTrackClipArgs), so they sound as in the track. */
export const NARRATION_LIMIT = 'alimiter=limit=0.9'
export const DUCK = 'sidechaincompress=threshold=0.25:ratio=4:attack=10:release=300:knee=1:detection=peak:makeup=1' // 0 dBFS key is 12.04 dB over threshold × (1 − 1/4) = 9.03 dB

/**
 * Pass A (pure, tested). The sidechain key is a synthetic 0 dBFS envelope that is 1 during cues and 0 elsewhere, so the
 * reduction is a constant −9 dB rather than following the narration's own level. Every input is padded to the film's
 * duration (`apad=whole_dur`) and both mixes use `duration=first`, so the graph terminates; `-t` trims any overrun.
 */
export function buildMixArgs(work: string, cues: Array<FitCue & { i: number }>, durationS: number): string[] {
  const D = durationS.toFixed(3)
  const inputs = ['-y', '-i', `${work}/mezz.mp4`]
  for (const c of cues) inputs.push('-i', `${work}/${cueAudioFile(c.i)}`)
  // Polly MP3 is 24 kHz mono → 48 kHz stereo before mixing.
  const delayed = cues.map((c, k) => `[${k + 1}:a]adelay=${c.startMs}|${c.startMs},aformat=sample_rates=48000:channel_layouts=stereo,apad=whole_dur=${D}[n${k}]`).join(';')
  const narrMix = cues.length ? `${cues.map((_, k) => `[n${k}]`).join('')}amix=inputs=${cues.length}:duration=first:normalize=0,${NARRATION_LIMIT}[narr]` : `anullsrc=r=48000:cl=stereo:d=${D}[narr]`
  const envelope = cues.length ? cues.map((c) => `between(t,${c.startMs / 1000},${c.endMs / 1000})`).join('+') : '0'
  const filter = [
    delayed, narrMix,
    `aevalsrc=exprs='${envelope}|${envelope}':s=48000:c=stereo:d=${D}[sc]`, // one expression per channel; quoted so its commas stay inside the option
    `[0:a][sc]${DUCK}[ducked]`,
    '[ducked][narr]amix=inputs=2:duration=first:normalize=0[out]',
  ].filter(Boolean).join(';')
  return [...inputs, '-filter_complex', filter, '-map', '[out]', '-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '2', '-t', D, `${work}/premix.wav`]
}

export interface Loudness { input_i: number; input_tp: number; input_lra: number; input_thresh: number }
const TARGET = 'loudnorm=I=-24:TP=-2'

/** Pass B: measure only; the JSON block lands on stderr. */
export function buildLoudnormMeasureArgs(work: string): string[] {
  return ['-hide_banner', '-nostats', '-i', `${work}/premix.wav`, '-af', `${TARGET}:LRA=11:print_format=json`, '-f', 'null', '-']
}

/** Pass C: linear (two-pass) normalisation, reporting what it did as JSON on stderr (parseLoudnormReport); loudnorm falls back to dynamic mode if the target LRA is below the source's, so LRA = max(11, source). */
export function buildLoudnormApplyArgs(work: string, m: Loudness): string[] {
  const lra = Math.min(50, Math.max(11, Math.ceil(m.input_lra)))
  const af = `${TARGET}:LRA=${lra}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:linear=true:print_format=json,aresample=48000`
  return ['-y', '-i', `${work}/premix.wav`, '-af', af, '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', `${work}/audio_ad.m4a`]
}

/** What the apply pass reports (print_format=json): its own input and output loudness and the mode it ran in. */
export interface LoudnormReport { input_i: number; output_i: number; normalization_type: string; target_offset: number }
export function parseLoudnormReport(stderr: string): LoudnormReport {
  const m = /\{[^{}]*"normalization_type"[^{}]*\}/.exec(stderr)
  if (!m) throw new Error(`loudnorm: no report JSON from the apply pass:\n${stderr.slice(-2000)}`)
  const j = JSON.parse(m[0]) as Record<string, string>
  return { input_i: +j.input_i!, output_i: +j.output_i!, normalization_type: j.normalization_type!, target_offset: +j.target_offset! }
}

/**
 * The one gain the apply pass gave the premix, in dB, read from its report rather than predicted: in linear mode loudnorm applies a
 * constant offset (af_loudnorm.c LINEAR_MODE), so output I − input I is it. loudnorm falls back to dynamic mode when the offset
 * would push the true peak over the TP target (or the measurement is degenerate); its gain then rides the programme (on a quiet
 * premix it applied +8 to +10 dB where the peak-limited offset is +6), so no constant matches and this returns null.
 * https://ffmpeg.org/ffmpeg-filters.html#loudnorm
 */
export function appliedGainDb(r: LoudnormReport): number | null {
  return r.normalization_type === 'linear' ? r.output_i - r.input_i : null
}

/**
 * One cue's app clip (cue_{i}.track.mp3) from its Polly clip: the narration path of buildMixArgs (48 kHz stereo, NARRATION_LIMIT)
 * and then the loudnorm gain, so the clip matches the voice in audio_ad (Sintel cues 10, 12, 50: within 0.5 dB, was −7.5 dB).
 * MP3, as the Polly clip and the published key (cueAudioKey) are. https://ffmpeg.org/ffmpeg-filters.html#alimiter, #volume
 */
export function buildTrackClipArgs(work: string, i: number, gainDb: number): string[] {
  const af = `aformat=sample_rates=48000:channel_layouts=stereo,${NARRATION_LIMIT},volume=${gainDb.toFixed(2)}dB`
  return ['-v', 'error', '-y', '-i', `${work}/${cueAudioFile(i)}`, '-af', af, '-ar', '48000', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', `${work}/${trackClipFile(i)}`]
}

export function parseLoudnorm(stderr: string): Loudness {
  const m = /\{[^{}]*"input_i"[^{}]*\}/.exec(stderr)
  if (!m) throw new Error(`loudnorm: no measurement JSON in ffmpeg output:\n${stderr.slice(-2000)}`)
  const j = JSON.parse(m[0]) as Record<string, string>
  return { input_i: +j.input_i!, input_tp: +j.input_tp!, input_lra: +j.input_lra!, input_thresh: +j.input_thresh! }
}
