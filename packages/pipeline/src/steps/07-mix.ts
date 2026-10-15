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
  const { stderr } = await execa('ffmpeg', buildLoudnormMeasureArgs(ctx.work))
  const measured = parseLoudnorm(stderr)
  await execa('ffmpeg', buildLoudnormApplyArgs(ctx.work, measured), { stdio: 'inherit' })
  await writeTrackClips(ctx.work, measured)
}

/**
 * The clips the app plays (Extended mode's pauses, the Title sample) at the level the narration has in the AD track: every
 * cue's Polly clip through the narration's own chain — the mix's 48 kHz stereo format, its limiter (NARRATION_LIMIT) and the
 * loudnorm gain the apply pass used (loudnormGainDb) — as work/{slug}/cue_{i}.track.mp3, which 10-publish uploads. The raw
 * Polly clip played ~7.5 dB louder than the same voice in the track (Sintel, measured against the published audio_ad), so a
 * pause sounded like a second narrator. All cues, extended or not, so a stale file from an earlier run never survives.
 */
export async function writeTrackClips(work: string, measured: Loudness) {
  const count = (JSON.parse(await readFile(`${work}/cues.json`, 'utf8')) as unknown[]).length
  for (const f of (await readdir(work)).filter((f) => /^cue_\d+\.track\.mp3$/.test(f))) await rm(`${work}/${f}`, { force: true })
  const gainDb = loudnormGainDb(measured)
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
const TARGET_I = -24, TARGET_TP = -2
const TARGET = `loudnorm=I=${TARGET_I}:TP=${TARGET_TP}`

/** Pass B: measure only; the JSON block lands on stderr. */
export function buildLoudnormMeasureArgs(work: string): string[] {
  return ['-hide_banner', '-nostats', '-i', `${work}/premix.wav`, '-af', `${TARGET}:LRA=11:print_format=json`, '-f', 'null', '-']
}

/** Pass C: linear (two-pass) normalisation; loudnorm falls back to dynamic mode if the target LRA is below the source's, so LRA = max(11, source). */
export function buildLoudnormApplyArgs(work: string, m: Loudness): string[] {
  const lra = Math.min(50, Math.max(11, Math.ceil(m.input_lra)))
  const af = `${TARGET}:LRA=${lra}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:linear=true:print_format=summary,aresample=48000`
  return ['-y', '-i', `${work}/premix.wav`, '-af', af, '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', `${work}/audio_ad.m4a`]
}

/**
 * The gain the apply pass gives the premix, in dB. Linear loudnorm (af_loudnorm.c, LINEAR_MODE) applies one constant offset,
 * target I − measured I, when the measured true peak plus that offset stays at or under the TP target (the LRA condition always
 * holds: buildLoudnormApplyArgs sets LRA ≥ the measured LRA). Otherwise loudnorm falls back to dynamic mode, whose gain varies;
 * the offset that keeps the peak at the target is the nearest constant. https://ffmpeg.org/ffmpeg-filters.html#loudnorm
 */
export function loudnormGainDb(m: Loudness): number {
  const offset = TARGET_I - m.input_i
  return m.input_tp + offset <= TARGET_TP ? offset : TARGET_TP - m.input_tp
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
