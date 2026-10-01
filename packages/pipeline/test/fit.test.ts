import { readFileSync } from 'node:fs'
import { fit, LATE_MS, WPS } from '../src/steps/05-fit'
import type { Described } from '../src/steps/04-describe'
import { mezzanineArgs } from '../src/steps/01-probe'
import { shotsFromCuts, sceneFilter } from '../src/steps/02-shots'
import { gapsFromWords, wordsFromTranscribe } from '../src/steps/03-speech'
import { segment, wrap } from '../src/steps/08-text'
import { buildMixArgs, buildLoudnormMeasureArgs, buildLoudnormApplyArgs, parseLoudnorm } from '../src/steps/07-mix'
import { buildPackagerArgs } from '../src/steps/09-package'
import { wordBudget, stripFence } from '../src/prompts'

const shorten = (t: string, n: number) => t.split(' ').slice(0, n).join(' ')

describe('shots', () => {
  it('merges short shots and splits long ones into equal parts', () => {
    const s = shotsFromCuts([1000, 1800, 20000], 30000)
    const even = (a: number, b: number, n: number) => Array.from({ length: n }, (_, k) => [Math.round(a + (k * (b - a)) / n), Math.round(a + ((k + 1) * (b - a)) / n)])
    expect(s.map((x) => [x.startMs, x.endMs])).toEqual([[0, 1800], ...even(1800, 20000, 3), ...even(20000, 30000, 2)])
  })
  // sintel-90-150: 11208→44042 was 4 × 8000 + an 834 ms tail (shot 6).
  it('never emits a shot shorter than minMs when splitting', () => {
    const s = shotsFromCuts([11208, 44042], 60000)
    for (const x of s) { expect(x.endMs - x.startMs).toBeGreaterThanOrEqual(1500); expect(x.endMs - x.startMs).toBeLessThanOrEqual(8000) }
    expect(s.at(-1)!.endMs).toBe(60000)
  })
  it('builds the scene filter with threshold 0.1', () => {
    expect(sceneFilter()).toContain('gt(scene,0.1)')
  })
})
describe('probe', () => {
  const pair = (args: string[], k: string) => args[args.indexOf(k) + 1]
  it('fits the mezzanine inside 1920x1080 without upscaling and encodes High Profile Level 4.0', () => {
    const args = mezzanineArgs('work/x', 24)
    expect(pair(args, '-vf')).toBe("scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2")
    for (const [k, v] of [['-profile:v', 'high'], ['-level:v', '4.0'], ['-maxrate', '16M'], ['-bufsize', '24M'], ['-force_key_frames', 'expr:gte(t,n_forced*4)'], ['-sc_threshold', '0']] as const) expect(pair(args, k)).toBe(v)
    expect(args.at(-1)).toBe('work/x/mezz.mp4')
  })
  it('maps only the first video and first audio stream and drops subtitle and data streams', () => {
    const args = mezzanineArgs('work/x', 24)
    expect(args.slice(0, 9)).toEqual(['-y', '-i', 'work/x/source.mp4', '-map', '0:v:0', '-map', '0:a:0', '-sn', '-dn'])
  })
  it('caps frame rate at 30 for sources above 30 fps so Level 4.0 holds', () => {
    expect(pair(mezzanineArgs('work/x', 60), '-vf')).toMatch(/,fps=30$/)
    expect(pair(mezzanineArgs('work/x', 25), '-vf')).not.toContain('fps=')
    expect(pair(mezzanineArgs('work/x', 0), '-vf')).toMatch(/,fps=30$/) // unknown rate: cap conservatively
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
  // sintel-90-150 gaps and shots (Gate C plan D1).
  const shot = (index: number, startMs: number, endMs: number, description: string): Described => ({ index, startMs, endMs, description, sameAsPrev: false, tokens: 0, outputTokens: 0 })
  it('places later shots inside a long opening gap after the cursor, not in the next gap', async () => {
    const cues = await fit([
      shot(0, 0, 8000, 'Words appear: SINTEL. A person stands in the snow, holding a sword.'),
      shot(1, 8000, 11208, 'Large white snowy rock.'),
      shot(2, 11208, 19208, 'A person stands by a fire.'),
    ], [{ startMs: 0, endMs: 16720 }, { startMs: 19509, endMs: 21209 }], shorten)
    expect(cues.map((c) => c.startMs).slice(0, 2)).toEqual([0, 8000])
    expect(cues[2]!.startMs).toBeGreaterThanOrEqual(11208)
    expect(cues[2]!.startMs).toBeLessThanOrEqual(16720)
    expect(cues.some((c) => c.startMs === 19509)).toBe(false)
  })
  it('tries the next gap inside the shot window when the first candidate is too small', async () => {
    const cues = await fit([shot(4, 27208, 35208, 'Woman drinks from bowl.')], [{ startMs: 24269, endMs: 27470 }, { startMs: 33170, endMs: 34820 }], shorten)
    expect(cues.map((c) => c.startMs)).toEqual([33170])
  })
  it('never voices a description more than 1 s after its shot ends', async () => {
    const late = [{ startMs: 19509, endMs: 21209 }]
    expect(LATE_MS).toBe(1000)
    expect(await fit([shot(1, 8000, 11208, 'Large white snowy rock.')], late, shorten)).toEqual([])
    expect(await fit([shot(1, 8000, 11208, 'Words appear: X')], late, shorten)).toEqual([expect.objectContaining({ extended: true, startMs: 8000 })])
  })
  it('keeps the 150 ms cursor spacing and sorts by start', async () => {
    const cues = await fit([shot(0, 0, 1000, 'Snow falls on the hills.'), shot(1, 1000, 3000, 'Smoke rises from the chimney.')], [{ startMs: 0, endMs: 10000 }], shorten)
    expect(cues.map((c) => c.shotIndex)).toEqual([0, 1])
    expect(cues[1]!.startMs).toBeGreaterThanOrEqual(cues[0]!.endMs + 150)
  })
  it('sintel-90-150 replay: every non-extended cue starts within its shot window', async () => {
    const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/sintel-90-150.${n}.json`, import.meta.url), 'utf8'))
    const described = fx('described') as Described[]
    const cues = await fit(described, fx('gaps'), shorten)
    const placed = cues.filter((c) => !c.extended)
    expect(placed.length).toBeGreaterThan(0)
    for (const c of placed) { const s = described.find((d) => d.index === c.shotIndex)!; expect(c.startMs).toBeGreaterThanOrEqual(s.startMs); expect(c.startMs).toBeLessThanOrEqual(s.endMs + LATE_MS) }
    // planner's fit-replay (Gate C plan D1): first placed cue per shot
    const first = (i: number) => placed.find((c) => c.shotIndex === i)?.startMs
    expect([0, 1, 2, 3, 4, 8, 9].map(first)).toEqual([0, 8000, 12575, 19509, 33170, 50869, 56125])
  })
  it('allows a start exactly LATE_MS after the shot ends', async () => {
    expect((await fit([shot(0, 0, 1000, 'Snow falls on the hills.')], [{ startMs: 2000, endMs: 5000 }], shorten)).map((c) => c.startMs)).toEqual([2000])
  })
})
describe('word budget', () => {
  it('8 words for a 3 s gap, min 4, extended 25', () => {
    expect(wordBudget({ index: 0, startMs: 0, endMs: 3000 }, [{ startMs: 0, endMs: 3000 }])).toBe(8)
    expect(wordBudget({ index: 0, startMs: 0, endMs: 1000 }, [{ startMs: 0, endMs: 500 }])).toBe(4)
    expect(wordBudget({ index: 0, startMs: 5000, endMs: 6000 }, [{ startMs: 0, endMs: 3000 }])).toBe(25)
  })
  it('uses the largest gap inside the shot window', () => {
    expect(wordBudget({ index: 4, startMs: 27208, endMs: 35208 }, [{ startMs: 24269, endMs: 27470 }, { startMs: 33170, endMs: 34820 }])).toBe(Math.floor(1.65 * WPS))
  })
  it('floors at 4 and returns 25 when no gap overlaps the window', () => {
    expect(wordBudget({ index: 0, startMs: 8000, endMs: 11208 }, [{ startMs: 8000, endMs: 8200 }])).toBe(4)
    expect(wordBudget({ index: 0, startMs: 8000, endMs: 11208 }, [{ startMs: 0, endMs: 7000 }, { startMs: 12208, endMs: 19000 }])).toBe(25)
  })
})
describe('captions', () => {
  it('segments at sentence ends and wraps to 2 × 42', () => {
    const words = 'I told you to wait. Twice. Now we are late for the train and it is raining again outside'.split(' ').map((t, i) => ({ start: i * 0.4, end: i * 0.4 + 0.3, text: t }))
    const cues = segment(words)
    expect(cues[0]!.text).toBe('I told you to wait.')
    for (const c of cues) { expect(c.text.split('\n').length).toBeLessThanOrEqual(2); for (const l of c.text.split('\n')) expect(l.length).toBeLessThanOrEqual(42) }
  })
  it('wrap respects limits', () => { expect(wrap('a '.repeat(40).trim(), 42, 2).split('\n').length).toBe(2) })
  it('wrap throws rather than drop text that needs more than maxLines lines', () => {
    expect(() => wrap('a '.repeat(50).trim(), 42, 2)).toThrow(/3 lines/)
  })
  const asTranscribe = (text: string) => wordsFromTranscribe({ results: { items: text.split(' ').map((w, i) => ({ type: 'pronunciation', start_time: String(i * 0.4), end_time: String(i * 0.4 + 0.3), alternatives: [{ content: w }] })) } })
  const checkCues = (cues: ReturnType<typeof segment>, maxLines = 2, maxChars = 42) => {
    for (const c of cues) { const lines = c.text.split('\n'); expect(lines.length).toBeLessThanOrEqual(maxLines); for (const l of lines) expect(l.length).toBeLessThanOrEqual(maxChars) }
  }
  it('keeps every word of a German line whose long compounds need three greedy lines', () => {
    const text = 'Selbstverständlich Bundesverfassungsgericht Entscheidungen Verantwortungsbewusstsein'
    const cues = segment(asTranscribe(text))
    expect(cues.map((c) => c.text.replace(/\n/g, ' ')).join(' ')).toBe(text)
    checkCues(cues)
  })
  it('keeps every word when a long English word lands on the line break', () => {
    const text = 'The minister said the agreement was fundamentally incomprehensible to all of them'
    const cues = segment(asTranscribe(text))
    expect(cues.map((c) => c.text.replace(/\n/g, ' ')).join(' ')).toBe(text)
    checkCues(cues)
  })
  it('never loses a word and never exceeds maxLines over 300 seeded random word sequences', () => {
    let seed = 0x5eed
    const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!
    for (let run = 0; run < 300; run++) {
      const n = 1 + Math.floor(rnd() * 40)
      const words = Array.from({ length: n }, (_, i) => {
        const len = rnd() < 0.15 ? 12 + Math.floor(rnd() * 14) : 1 + Math.floor(rnd() * 9)
        const text = Array.from({ length: len }, () => pick([...'abcdefghijklmnopqrstuvwxyzäöüß'])).join('') + (rnd() < 0.2 ? pick([',', ';', ':', '.', '!', '?']) : '')
        return { start: i * 0.3, end: i * 0.3 + 0.25, text, ...(rnd() < 0.5 ? { speaker: pick(['spk_0', 'spk_1']) } : {}) }
      })
      const cues = segment(words)
      expect(cues.map((c) => c.text.replace(/\n/g, ' ')).join(' ')).toBe(words.map((w) => w.text).join(' '))
      checkCues(cues)
    }
  })
  it('attaches Transcribe punctuation to the preceding word', () => {
    const item = (type: string, content: string, t?: number) => ({ type, alternatives: [{ content }], ...(t === undefined ? {} : { start_time: String(t), end_time: String(t + 0.2) }) })
    expect(wordsFromTranscribe({ results: { items: [item('pronunciation', 'past', 1), item('punctuation', '.'), item('pronunciation', 'It', 2)] } }).map((w) => w.text)).toEqual(['past.', 'It'])
  })
  it('segments the Sintel transcript at sentence ends', () => {
    const t = JSON.parse(readFileSync(new URL('./fixtures/sintel-90-150.transcript.json', import.meta.url), 'utf8'))
    expect(segment(wordsFromTranscribe(t)).slice(0, 3).map((c) => c.text)).toEqual(['This blade has a dark past.', 'It has shed much innocent blood.', "You're a fool for traveling alone,\nso completely unprepared."])
  })
  it('never drops words when a short clause opener precedes a long unpunctuated run', () => {
    const text = 'No, this blade has shed much innocent blood over the years and it will keep on shedding blood until somebody extraordinarily brave stops it.'
    const cues = segment(text.split(' ').map((t, i) => ({ start: i * 0.25, end: i * 0.25 + 0.2, text: t })))
    expect(cues.map((c) => c.text.replace(/\n/g, ' ')).join(' ')).toBe(text)
    for (let i = 1; i < cues.length; i++) expect(cues[i - 1]!.end).toBeLessThanOrEqual(cues[i]!.start)
  })
  it('breaks an overlong sentence at the last clause boundary, not mid-phrase', () => {
    const text = 'Twelve riders crossed the frozen river at dawn, then the scouts rode on north past the mill and the old stone bridge.'
    expect(text.indexOf(',')).toBeGreaterThan(40)
    const words = text.split(' ').map((t, i) => ({ start: i * 0.25, end: i * 0.25 + 0.2, text: t }))
    const cues = segment(words)
    expect(cues[0]!.text.endsWith(',')).toBe(true)
    expect(cues.map((c) => c.text.replace(/\n/g, ' ')).join(' ')).toBe(text)
  })
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
    const args = buildPackagerArgs('en', true, true, true)
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
    const text = buildPackagerArgs('de', false, false, true).filter((a) => a.includes('stream=text'))
    expect(text).toHaveLength(1)
    expect(text[0]).toContain('in=descriptions.vtt')
    expect(text[0]).toContain('language=de')
  })
  it('omits the SDH descriptor when the SDH step degraded to plain captions', () => {
    const args = buildPackagerArgs('en', true, false, true)
    expect(args.filter((a) => a.includes('stream=text')).map((a) => a.split(',')[0])).toEqual(['in=captions.vtt', 'in=descriptions.vtt'])
    expect(args.join('\n')).not.toContain('describes-music-and-sound')
  })
  it('omits the description text track when fit placed nothing', () => {
    const args = buildPackagerArgs('en', true, true, false)
    expect(args.filter((a) => a.includes('stream=text')).map((a) => a.split(',')[0])).toEqual(['in=captions.vtt', 'in=sdh.vtt'])
    expect(args.some((a) => a.includes('in=audio_ad.m4a'))).toBe(true)
  })
})
describe('prompts', () => {
  it('strips a ```json fence before parsing', () => {
    expect(JSON.parse(stripFence('```json\n{"cues":[]}\n```'))).toEqual({ cues: [] })
    expect(stripFence('{"cues":[]}')).toBe('{"cues":[]}')
  })
  it('strips a fence after leading prose and a trailing fence after a prefill', () => {
    expect(stripFence('Here is the JSON: ```json\n{"cues":[]}\n```')).toBe('{"cues":[]}')
    expect(stripFence('{"cues":[]}\n```')).toBe('{"cues":[]}')
    expect(stripFence('```json\n{"cues":[]}\n```\nHope this helps.')).toBe('{"cues":[]}')
  })
})
