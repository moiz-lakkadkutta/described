import { execa } from 'execa'
import { readFile } from 'node:fs/promises'
import type { Ctx } from './index'
import type { FitCue } from './05-fit'

/**
 * Build the AD rendition: narration placed at cue times, original ducked −9 dB under narration (sidechain, attack 10 ms,
 * release 300 ms), then loudness-normalised to −24 LUFS / −2 dBTP. Netflix AD spec: 6–12 dB dip, 2–15 ms attack.
 */
export async function mix(ctx: Ctx) {
  const cues = (JSON.parse(await readFile(`${ctx.work}/cues.json`, 'utf8')) as FitCue[]).map((c, i) => ({ ...c, i })).filter((c) => !c.extended)
  const args = buildMixArgs(ctx.work, cues)
  await execa('ffmpeg', args, { stdio: 'inherit' })
}

export function buildMixArgs(work: string, cues: Array<FitCue & { i: number }>): string[] {
  const inputs = ['-y', '-i', `${work}/mezz.mp4`]
  for (const c of cues) inputs.push('-i', `${work}/cue_${c.i}.mp3`)
  const delayed = cues.map((c, k) => `[${k + 1}:a]adelay=${c.startMs}|${c.startMs},apad[n${k}]`).join(';')
  const narrMix = cues.length ? `${cues.map((_, k) => `[n${k}]`).join('')}amix=inputs=${cues.length}:normalize=0,alimiter=limit=0.9[narr]` : 'anullsrc=r=48000:cl=stereo[narr]'
  const filter = [
    delayed, narrMix,
    '[narr]asplit=2[narrA][narrB]',
    '[0:a][narrB]sidechaincompress=threshold=0.02:ratio=6:attack=10:release=300:makeup=1[ducked]', // ≈ −9 dB during speech
    '[ducked][narrA]amix=inputs=2:normalize=0,loudnorm=I=-24:TP=-2:LRA=11[out]',
  ].filter(Boolean).join(';')
  return [...inputs, '-filter_complex', filter, '-map', '[out]', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-shortest', `${work}/audio_ad.m4a`]
}
