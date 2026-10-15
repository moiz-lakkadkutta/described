import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { appliedGainDb, normalise, writeTrackClips } from '../src/steps/07-mix'

/** Mean level in dBFS of a file, from ffmpeg's volumedetect. */
async function meanDb(file: string): Promise<number> {
  const { stderr } = await execa('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'])
  return Number(/mean_volume: (-?[\d.]+) dB/.exec(stderr)![1])
}

const hasFfmpeg = await execa('ffmpeg', ['-version']).then(() => true, () => false) // CI images may lack ffmpeg
describe.skipIf(!hasFfmpeg)('07-mix app clips (real ffmpeg)', () => {
  it('writes cue_{i}.track.mp3 for every cue at the loudnorm gain and drops stale ones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'track-clips-'))
    await writeFile(join(dir, 'cues.json'), JSON.stringify([{}, {}]))
    // A Polly-like clip: 24 kHz mono MP3, a tone well under the limiter's 0.9, so only the gain changes its level.
    for (const i of [0, 1]) await execa('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000:duration=2', '-af', 'volume=0.25', '-ac', '1', '-c:a', 'libmp3lame', join(dir, `cue_${i}.mp3`)])
    await writeFile(join(dir, 'cue_5.track.mp3'), 'stale')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await writeTrackClips(dir, -5.31) // Sintel's gain
    expect((await readdir(dir)).filter((f) => f.endsWith('.track.mp3')).sort()).toEqual(['cue_0.track.mp3', 'cue_1.track.mp3'])
    // −5.31 dB gain plus ~2.5 dB that the mix's own aformat takes when it spreads the mono clip over stereo, as it does for the
    // narration in audio_ad: Sintel's clips through this chain match the published track within 0.5 dB (the raw clip: +7.5 dB).
    const drop = (await meanDb(join(dir, 'cue_0.mp3'))) - (await meanDb(join(dir, 'cue_0.track.mp3')))
    expect(drop).toBeGreaterThan(7.3)
    expect(drop).toBeLessThan(8.3)
    const { stdout } = await execa('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate,channels', '-of', 'csv=p=0', join(dir, 'cue_0.track.mp3')])
    expect(stdout.trim()).toBe('48000,2')
  }, 30_000)

  /** A synthetic premix in a fresh work dir with one Polly-like clip; `expr` is the aevalsrc expression. */
  async function premix(expr: string) {
    const dir = await mkdtemp(join(tmpdir(), 'track-gain-'))
    await writeFile(join(dir, 'cues.json'), JSON.stringify([{}]))
    await execa('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000:duration=1', '-ac', '1', '-c:a', 'libmp3lame', join(dir, 'cue_0.mp3')])
    await execa('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=exprs='${expr}':s=48000:d=12`, '-ac', '2', '-c:a', 'pcm_s24le', join(dir, 'premix.wav')])
    return dir
  }
  it('a premix loudnorm can lift linearly gives the reported gain', async () => {
    const dir = await premix('0.05*(2*random(0))*(1+0.5*sin(2*PI*0.3*t))') // ≈ −27 LUFS, −16.5 dBTP: +3 dB keeps the peak under −2
    const r = await normalise(dir)
    expect(r.normalization_type).toBe('linear')
    expect(appliedGainDb(r)).toBeGreaterThan(2.5); expect(appliedGainDb(r)).toBeLessThan(3.5)
  }, 30_000)
  it('a quiet premix with peaks (−34 LUFS, −10.7 dBTP) runs dynamic: no levelled clip, a warning, stale clips gone', async () => {
    const dir = await premix('0.01*(2*random(0)-1)+0.4*sin(2*PI*1000*t)*lt(mod(t\\,2)\\,0.01)')
    await writeFile(join(dir, 'cue_0.track.mp3'), 'stale')
    const r = await normalise(dir)
    expect(r.normalization_type).toBe('dynamic')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await writeTrackClips(dir, appliedGainDb(r))
    expect((await readdir(dir)).filter((f) => f.endsWith('.track.mp3'))).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^mix: loudnorm normalised the AD track dynamically/))
  }, 30_000)
})
