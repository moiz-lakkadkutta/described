import { execa } from 'execa'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LevelMeter, splitGaps, unlabelledSpeech, vadArgs, VAD, voicedSegments, type Levels } from '../src/voiceActivity'
import { gapsWithVoiceActivity, mezzMarker, speechMap } from '../src/steps/03-speech'

/** Levels for a clip of `ms` at 50 ms frames: background mid/side, then [startMs, endMs, midDb, sideDb] events on top. */
function levels(ms: number, bg: [number, number], events: Array<[number, number, number, number]> = []): Levels {
  const n = ms / 50
  const midDb = new Float64Array(n).fill(bg[0])
  const sideDb = new Float64Array(n).fill(bg[1])
  for (const [s, e, m, sd] of events) for (let i = s / 50; i < e / 50; i++) { midDb[i] = m; sideDb[i] = sd }
  return { frameMs: 50, midDb, sideDb }
}
const whole = (ms: number) => ({ startMs: 0, endMs: ms })

describe('splitGaps', () => {
  const gaps = [{ startMs: 0, endMs: 10_000 }, { startMs: 12_000, endMs: 20_000 }]
  it('leaves gaps alone when there is no unlabelled speech', () => {
    expect(splitGaps(gaps, [])).toEqual(gaps)
  })
  it('cuts around a segment with the 200 ms margin gapsFromWords uses', () => {
    expect(splitGaps(gaps, [{ startMs: 4000, endMs: 5000 }])).toEqual([{ startMs: 0, endMs: 3800 }, { startMs: 5200, endMs: 10_000 }, gaps[1]])
  })
  it('drops pieces under 1.2 s, as gapsFromWords does', () => {
    expect(splitGaps(gaps, [{ startMs: 1000, endMs: 2000 }])).toEqual([{ startMs: 2200, endMs: 10_000 }, gaps[1]]) // 0–800 is too short
    expect(splitGaps(gaps, [{ startMs: 13_300, endMs: 18_700 }])).toEqual([gaps[0]]) // 12000–13100 and 18900–20000 are too short
  })
  it('handles unsorted segments, segments across a gap edge, and segments outside every gap', () => {
    const speech = [{ startMs: 16_000, endMs: 16_500 }, { startMs: 9500, endMs: 12_500 }, { startMs: 10_500, endMs: 11_500 }, { startMs: 30_000, endMs: 31_000 }]
    expect(splitGaps(gaps, speech)).toEqual([{ startMs: 0, endMs: 9300 }, { startMs: 12_700, endMs: 15_800 }, { startMs: 16_700, endMs: 20_000 }])
  })
  it('ignores a segment whose margin only touches the gap', () => {
    expect(splitGaps([{ startMs: 1000, endMs: 5000 }], [{ startMs: 5200, endMs: 6000 }, { startMs: 0, endMs: 800 }])).toEqual([{ startMs: 1000, endMs: 5000 }])
  })
})

describe('voicedSegments', () => {
  const bg: [number, number] = [-40, -40] // wide noise: mid and side equal
  it('finds a loud centred burst at its frames', () => {
    expect(voicedSegments(levels(10_000, bg, [[2000, 2600, -30, -45]]), whole(10_000))).toEqual([{ startMs: 2000, endMs: 2600 }])
  })
  it('ignores a loud burst that is not centred (music and effects spread wide)', () => {
    expect(voicedSegments(levels(10_000, bg, [[2000, 3000, -30, -30]]), whole(10_000))).toEqual([])
    expect(voicedSegments(levels(10_000, bg, [[2000, 3000, -30, -37.9]]), whole(10_000))).toEqual([]) // 7.9 dB < centreDb 8
  })
  it('ignores a centred sound that is not well above the gap median', () => {
    expect(voicedSegments(levels(10_000, bg, [[2000, 3000, -34.5, -60]]), whole(10_000))).toEqual([]) // 5.5 dB < aboveMedianDb 6
    expect(voicedSegments(levels(10_000, bg, [[2000, 3000, -34, -60]]), whole(10_000))).toEqual([{ startMs: 2000, endMs: 3000 }])
  })
  it('the bar is the gap’s own median: the same burst in a loud gap is not speech', () => {
    expect(voicedSegments(levels(10_000, [-28, -40], [[2000, 3000, -25, -45]]), whole(10_000))).toEqual([])
  })
  it('drops a segment shorter than minSpeechMs (an impact, a knock)', () => {
    expect(voicedSegments(levels(10_000, bg, [[2000, 2450, -30, -45]]), whole(10_000))).toEqual([])
  })
  it('bridges holes up to bridgeMs', () => {
    expect(voicedSegments(levels(10_000, bg, [[2000, 2300, -30, -45], [2350, 2650, -30, -45]]), whole(10_000))).toEqual([{ startMs: 2000, endMs: 2650 }])
    expect(voicedSegments(levels(10_000, bg, [[2000, 2300, -30, -45], [2400, 2700, -30, -45]]), whole(10_000))).toEqual([]) // 100 ms hole: two 300 ms pieces
  })
  it('looks only inside the gap, and skips a gap shorter than minSpeechMs', () => {
    const l = levels(10_000, bg, [[1000, 2000, -30, -45], [6000, 7000, -30, -45]])
    expect(voicedSegments(l, { startMs: 3010, endMs: 9000 })).toEqual([{ startMs: 6000, endMs: 7000 }])
    expect(voicedSegments(l, { startMs: 6000, endMs: 6400 })).toEqual([])
    expect(voicedSegments(l, { startMs: 9000, endMs: 20_000 })).toEqual([]) // past the end of the levels
  })
  it('a mono source (no side at all) passes the centre test; only the level test applies', () => {
    expect(voicedSegments(levels(10_000, [-40, -120], [[2000, 3000, -30, -120]]), whole(10_000))).toEqual([{ startMs: 2000, endMs: 3000 }])
  })
})

describe('LevelMeter', () => {
  const pcm = (frames: number, mid: number, side: number) => {
    const b = Buffer.alloc(frames * 8)
    for (let i = 0; i < frames; i++) { b.writeFloatLE(mid, i * 8); b.writeFloatLE(side, i * 8 + 4) }
    return b
  }
  it('gives the mean-square level of each 50 ms frame of interleaved mid/side f32le, −120 dB for silence', () => {
    const m = new LevelMeter(8000, 50) // 400 samples a frame
    m.push(pcm(400, 0.5, 0))
    m.push(pcm(400, 0.1, 0.1))
    m.push(pcm(100, 1, 1)) // a partial frame is dropped
    const l = m.levels()
    expect(l.midDb.length).toBe(2)
    expect(l.midDb[0]).toBeCloseTo(-6.02, 2)
    expect(l.sideDb[0]).toBe(-120)
    expect(l.midDb[1]).toBeCloseTo(-20, 2)
  })
  it('does not depend on how the stream is chunked (chunks split mid-sample)', () => {
    const b = Buffer.concat([pcm(400, 0.5, 0.01), pcm(400, 0.2, 0.3)])
    const one = new LevelMeter(8000, 50)
    one.push(b)
    const many = new LevelMeter(8000, 50)
    for (let o = 0; o < b.length; o += 13) many.push(b.subarray(o, o + 13))
    expect(many.levels()).toEqual(one.levels())
  })
})

describe('vadArgs', () => {
  it('mid and side from the stereo mix, band-passed 300–3400 Hz, 8 kHz f32le to stdout', () => {
    expect(vadArgs('w/mezz.mp4')).toEqual(['-v', 'error', '-nostdin', '-i', 'w/mezz.mp4', '-vn', '-af',
      'pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0-0.5*c1,highpass=f=300,highpass=f=300,lowpass=f=3400,lowpass=f=3400',
      '-ar', '8000', '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'])
  })
})

describe('gapsWithVoiceActivity', () => {
  const fromWords = [{ startMs: 0, endMs: 10_000 }]
  it('splits Transcribe’s gaps around what the check finds and records it', async () => {
    const detect = vi.fn(async () => [{ startMs: 4000, endMs: 5000 }])
    const r = await gapsWithVoiceActivity('m.mp4', fromWords, { detect })
    expect(detect).toHaveBeenCalledWith('m.mp4', fromWords, undefined)
    expect(r).toMatchObject({ source: 'transcribe+vad', transcribeGaps: fromWords, unlabelledSpeech: [{ startMs: 4000, endMs: 5000 }], gaps: [{ startMs: 0, endMs: 3800 }, { startMs: 5200, endMs: 10_000 }], gapMs: { transcribe: 10_000, final: 8600, lost: 1400 } })
    expect(r.options).toEqual(VAD)
  })
  it('SPEECH_VAD=0 (on: false): Transcribe’s gaps, no check run', async () => {
    const detect = vi.fn()
    expect(await gapsWithVoiceActivity('m.mp4', fromWords, { on: false, detect })).toMatchObject({ source: 'transcribe', note: 'SPEECH_VAD=0', gaps: fromWords, gapMs: { lost: 0 } })
    expect(detect).not.toHaveBeenCalled()
  })
  it('an ffmpeg failure keeps Transcribe’s gaps and says so; an abort is still thrown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await gapsWithVoiceActivity('m.mp4', fromWords, { detect: async () => { throw new Error('ffmpeg: Invalid data\nmore') } })
    expect(r).toMatchObject({ source: 'transcribe', note: 'voice-activity check failed: ffmpeg: Invalid data', gaps: fromWords })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
    const ac = new AbortController()
    ac.abort()
    await expect(gapsWithVoiceActivity('m.mp4', fromWords, { signal: ac.signal, detect: async () => { throw new Error('aborted') } })).rejects.toThrow('aborted')
  })
})

const hasFfmpeg = await execa('ffmpeg', ['-version']).then(() => true, () => false) // CI images may lack ffmpeg
describe.skipIf(!hasFfmpeg)('voice activity on synthetic audio (real ffmpeg)', () => {
  /**
   * 10 s stereo, 48 kHz: uncorrelated white noise in each channel (wide, like music and effects) at 0.05, plus 600 Hz tones at 0.3:
   * centred (same in both channels) at 2.0–3.0 s (speech-like: found) and 5.0–5.3 s (too short: not found); anti-phase (wide) at
   * 7.0–8.0 s (not centred: not found).
   */
  const fixture = async (dir: string) => {
    const tone = '0.3*sin(2*PI*600*t)'
    const centred = `${tone}*(between(t,2,3)+between(t,5,5.3))`
    const wide = `${tone}*between(t,7,8)`
    const file = join(dir, 'mezz.mp4') // a WAV under the mezzanine's name: ffmpeg reads the content, not the extension
    await execa('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=exprs='0.05*(2*random(0)-1)+${centred}+${wide}|0.05*(2*random(1)-1)+${centred}-${wide}':s=48000:d=10`, '-c:a', 'pcm_s16le', '-f', 'wav', file])
    return file
  }
  it('finds the centred burst only, at its time (±100 ms)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vad-'))
    const found = await unlabelledSpeech(await fixture(dir), [{ startMs: 0, endMs: 10_000 }])
    expect(found).toHaveLength(1)
    expect(Math.abs(found[0]!.startMs - 2000)).toBeLessThanOrEqual(100)
    expect(Math.abs(found[0]!.endMs - 3000)).toBeLessThanOrEqual(100)
  })
  it('speechMap writes split gaps.json and gaps.vad.json; SPEECH_VAD=0 writes Transcribe’s gaps', async () => {
    const work = await mkdtemp(join(tmpdir(), 'vad-speech-'))
    await fixture(work)
    await writeFile(join(work, 'probe.json'), JSON.stringify({ format: { duration: '10' } }))
    await writeFile(join(work, 'transcript.json'), JSON.stringify({ results: { items: [] } })) // no words: the whole clip is one gap
    await writeFile(join(work, 'transcript.src'), await mezzMarker(work, 'en'))
    const ctx = { slug: 'x', source: '', language: 'en' as const, voice: 'Joanna', work }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await speechMap(ctx)
    const gaps = JSON.parse(await readFile(join(work, 'gaps.json'), 'utf8'))
    expect(gaps).toHaveLength(2)
    expect(gaps[0].startMs).toBe(0)
    expect(gaps[0].endMs).toBeGreaterThanOrEqual(1700)
    expect(gaps[0].endMs).toBeLessThanOrEqual(1900)
    expect(gaps[1].startMs).toBeGreaterThanOrEqual(3100)
    expect(gaps[1].startMs).toBeLessThanOrEqual(3300)
    expect(gaps[1].endMs).toBe(10_000)
    const vad = JSON.parse(await readFile(join(work, 'gaps.vad.json'), 'utf8'))
    expect(vad).toMatchObject({ source: 'transcribe+vad', transcribeGaps: [{ startMs: 0, endMs: 10_000 }], gaps })
    process.env.SPEECH_VAD = '0'
    try { await speechMap(ctx) } finally { delete process.env.SPEECH_VAD }
    expect(JSON.parse(await readFile(join(work, 'gaps.json'), 'utf8'))).toEqual([{ startMs: 0, endMs: 10_000 }])
    expect(JSON.parse(await readFile(join(work, 'gaps.vad.json'), 'utf8'))).toMatchObject({ source: 'transcribe', note: 'SPEECH_VAD=0' })
    warn.mockRestore()
  })
})
