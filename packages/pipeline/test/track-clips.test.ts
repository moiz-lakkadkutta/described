import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { writeTrackClips } from '../src/steps/07-mix'

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
    await writeTrackClips(dir, { input_i: -18.69, input_tp: 0.07, input_lra: 18.1, input_thresh: -29.85 }) // gain −5.31 dB
    expect((await readdir(dir)).filter((f) => f.endsWith('.track.mp3')).sort()).toEqual(['cue_0.track.mp3', 'cue_1.track.mp3'])
    // −5.31 dB gain plus ~2.5 dB that the mix's own aformat takes when it spreads the mono clip over stereo, as it does for the
    // narration in audio_ad: Sintel's clips through this chain match the published track within 0.5 dB (the raw clip: +7.5 dB).
    const drop = (await meanDb(join(dir, 'cue_0.mp3'))) - (await meanDb(join(dir, 'cue_0.track.mp3')))
    expect(drop).toBeGreaterThan(7.3)
    expect(drop).toBeLessThan(8.3)
    const { stdout } = await execa('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate,channels', '-of', 'csv=p=0', join(dir, 'cue_0.track.mp3')])
    expect(stdout.trim()).toBe('48000,2')
  }, 30_000)
})
