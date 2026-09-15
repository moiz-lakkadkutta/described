import { fit } from '../src/steps/05-fit'
import { shotsFromCuts } from '../src/steps/02-shots'
import { gapsFromWords } from '../src/steps/03-speech'
import { segment, wrap } from '../src/steps/08-text'
import { buildMixArgs, buildLoudnormMeasureArgs, buildLoudnormApplyArgs, parseLoudnorm } from '../src/steps/07-mix'
import { buildPackagerArgs } from '../src/steps/09-package'
import { wordBudget, stripFence } from '../src/prompts'

const shorten = (t: string, n: number) => t.split(' ').slice(0, n).join(' ')

describe('shots', () => {
  it('merges short shots and splits long ones', () => {
    const s = shotsFromCuts([1000, 1800, 20000], 30000)
    expect(s.map((x) => [x.startMs, x.endMs])).toEqual([[0, 1800], [1800, 9800], [9800, 17800], [17800, 20000], [20000, 28000], [28000, 30000]])
  })
})
describe('gaps', () => {
  it('finds gaps ≥ 1.2 s with 200 ms margins', () => {
    const g = gapsFromWords([{ start: 2, end: 2.5, text: 'Hi' }, { start: 2.6, end: 3, text: 'there' }, { start: 6, end: 6.4, text: 'Bye' }], 10000)
    expect(g).toEqual([{ startMs: 0, endMs: 1800 }, { startMs: 3200, endMs: 5800 }, { startMs: 6600, endMs: 10000 }])
  })
})
describe('fit', () => {
  const gaps = [{ startMs: 0, endMs: 3000 }, { startMs: 8000, endMs: 9500 }]
  it('places a description in the first gap at/after the shot and never over dialogue', async () => {
    const cues = await fit([{ index: 0, startMs: 0, endMs: 4000, description: 'A woman in a red coat crosses a bridge.', sameAsPrev: false, tokens: 0, outputTokens: 0 }], gaps, shorten)
    expect(cues).toHaveLength(1)
    expect(cues[0]!.startMs).toBe(0)
    expect(cues[0]!.endMs).toBeLessThanOrEqual(3000)
    expect(cues[0]!.extended).toBe(false)
  })
  it('shortens to fit', async () => {
    const long = 'Night. A rooftop. A tall man in an olive coat and a burgundy scarf leans over the railing and looks down at the empty street below.'
    const cues = await fit([{ index: 0, startMs: 8000, endMs: 12000, description: long, sameAsPrev: false, tokens: 0, outputTokens: 0 }], gaps, shorten)
    expect(cues[0]!.wordCount).toBeLessThanOrEqual(4) // 1.5 s gap → 4 words
  })
  it('marks extended when there is no gap and the shot introduces new information', async () => {
    const cues = await fit([{ index: 0, startMs: 20000, endMs: 24000, description: 'Words appear: Berlin, 1989.', sameAsPrev: false, tokens: 0, outputTokens: 0 }], gaps, shorten)
    expect(cues[0]).toMatchObject({ extended: true, startMs: 20000 })
  })
  it('skips SAME shots', async () => {
    expect(await fit([{ index: 0, startMs: 0, endMs: 1000, description: '', sameAsPrev: true, tokens: 0, outputTokens: 0 }], gaps, shorten)).toEqual([])
  })
})
describe('word budget', () => {
  it('8 words for a 3 s gap, min 3, extended 25', () => {
    expect(wordBudget({ index: 0, startMs: 0, endMs: 1000 }, [{ startMs: 0, endMs: 3000 }])).toBe(8)
    expect(wordBudget({ index: 0, startMs: 0, endMs: 1000 }, [{ startMs: 0, endMs: 500 }])).toBe(3)
    expect(wordBudget({ index: 0, startMs: 5000, endMs: 6000 }, [{ startMs: 0, endMs: 3000 }])).toBe(25)
  })
})
describe('captions', () => {
  it('segments at sentence ends and wraps to 2 × 42', () => {
    const words = 'I told you to wait. Twice. Now we are late for the train and it is raining again outside'.split(' ').map((t, i) => ({ start: i * 0.4, end: i * 0.4 + 0.3, text: t }))
    const cues = segment(words)
    expect(cues[0]!.text).toBe('I told you to wait.')
    for (const c of cues) { expect(c.text.split('\n').length).toBeLessThanOrEqual(2); for (const l of c.text.split('\n')) expect(l.length).toBeLessThanOrEqual(42) }
  })
  it('wrap respects limits', () => { expect(wrap('a '.repeat(50).trim(), 42, 2).split('\n').length).toBe(2) })
})
describe('mix', () => {
  const cue = { i: 0, startMs: 1000, endMs: 3000, text: 'x', extended: false, wordCount: 1, shotIndex: 0 }
  it('builds a constant −9 dB sidechain duck that terminates at the film duration', () => {
    const args = buildMixArgs('work/x', [cue], 60)
    const f = args[args.indexOf('-filter_complex') + 1]!
    expect(f).toContain('adelay=1000|1000')
    expect(f).toContain('aformat=sample_rates=48000:channel_layouts=stereo')
    expect(f).toContain('apad=whole_dur=60.000')
    expect(f).toContain("aevalsrc=exprs='between(t,1,3)|between(t,1,3)':s=48000:c=stereo:d=60.000[sc]")
    expect(f).toContain('[0:a][sc]sidechaincompress=threshold=0.25:ratio=4:attack=10:release=300:knee=1:detection=peak:makeup=1[ducked]')
    expect(f).toContain('[ducked][narr]amix=inputs=2:duration=first:normalize=0[out]')
    expect(f).not.toContain('loudnorm') // two-pass loudnorm is its own invocation
    expect(args.slice(-3)).toEqual(['-t', '60.000', 'work/x/premix.wav'])
  })
  it('sums the envelope over several cues and pads a silent narration when there are none', () => {
    const f = buildMixArgs('work/x', [cue, { ...cue, i: 2, startMs: 5000, endMs: 8500 }], 20).find((a) => a.includes('aevalsrc'))!
    expect(f).toContain("exprs='between(t,1,3)+between(t,5,8.5)|between(t,1,3)+between(t,5,8.5)'")
    expect(f).toContain('[n0][n1]amix=inputs=2:duration=first:normalize=0')
    const none = buildMixArgs('work/x', [], 20).find((a) => a.includes('aevalsrc'))!
    expect(none).toContain("exprs='0|0'")
    expect(none).toContain('anullsrc=r=48000:cl=stereo:d=20.000[narr]')
  })
  it('measures then applies loudnorm linearly with the measured values', () => {
    const measure = buildLoudnormMeasureArgs('work/x')
    expect(measure).toContain('loudnorm=I=-24:TP=-2:LRA=11:print_format=json')
    expect(measure.slice(-2)).toEqual(['null', '-'])
    const m = parseLoudnorm('[Parsed_loudnorm_0 @ 0x1] \n{\n\t"input_i" : "-27.21",\n\t"input_tp" : "-6.13",\n\t"input_lra" : "13.40",\n\t"input_thresh" : "-37.50",\n\t"output_i" : "-24.00",\n\t"target_offset" : "0.10"\n}\n')
    expect(m).toEqual({ input_i: -27.21, input_tp: -6.13, input_lra: 13.4, input_thresh: -37.5 })
    const apply = buildLoudnormApplyArgs('work/x', m)
    const af = apply[apply.indexOf('-af') + 1]!
    expect(af).toContain('loudnorm=I=-24:TP=-2:LRA=14:measured_I=-27.21:measured_TP=-6.13:measured_LRA=13.4:measured_thresh=-37.5:linear=true')
    expect(af).toContain('aresample=48000')
    expect(apply).toEqual(expect.arrayContaining(['-ar', '48000', '-ac', '2']))
    expect(apply.at(-1)).toBe('work/x/audio_ad.m4a')
    expect(buildLoudnormApplyArgs('work/x', { ...m, input_lra: 4 })[4]).toContain(':LRA=11:') // never below the −24 LUFS target's LRA
    expect(() => parseLoudnorm('no json here')).toThrow(/loudnorm/)
  })
})
describe('package', () => {
  it('signals the AD rendition and uses real spaces and ;-separated characteristics', () => {
    const args = buildPackagerArgs('en', true)
    const ad = args.find((a) => a.includes('in=audio_ad.m4a'))!
    expect(ad).toContain('hls_characteristics=public.accessibility.describes-video')
    expect(ad).toContain('hls_name=Audio description')
    expect(ad).toContain('roles=description')
    expect(args.join('\n')).not.toContain('%20')
    for (const a of args) for (const m of a.matchAll(/hls_characteristics=([^,]+)/g)) expect(m[1]).not.toContain(',')
    expect(args.find((a) => a.includes('in=sdh.vtt'))).toContain('hls_characteristics=public.accessibility.transcribes-spoken-dialog;public.accessibility.describes-music-and-sound')
    expect(args.filter((a) => a.includes('stream=text'))).toHaveLength(3)
    expect(args.slice(-4)).toEqual(['--segment_duration', '4', '--hls_master_playlist_output', 'hls/master.m3u8'])
    for (const a of args) expect(a).not.toMatch(/=\//) // relative paths only; packager runs with cwd = work dir
  })
  it('omits the caption tracks when there is no dialogue (Packager rejects zero-cue VTT)', () => {
    const text = buildPackagerArgs('de', false).filter((a) => a.includes('stream=text'))
    expect(text).toHaveLength(1)
    expect(text[0]).toContain('in=descriptions.vtt')
    expect(text[0]).toContain('language=de')
  })
})
describe('prompts', () => {
  it('strips a ```json fence before parsing', () => {
    expect(JSON.parse(stripFence('```json\n{"cues":[]}\n```'))).toEqual({ cues: [] })
    expect(stripFence('{"cues":[]}')).toBe('{"cues":[]}')
  })
})
