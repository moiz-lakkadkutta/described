import { serializeVtt } from '@moizp/vega-media-kit/core'
import type { Cue } from '@moizp/vega-media-kit/core'
import { parseSdhReply, readSdhReply, mergeSdh } from '../src/prompts'

const captions: Cue[] = [
  { trackId: 'captions', id: 'c1', start: 16.92, end: 23.729, text: 'This blade has a dark past', speaker: 'spk_0' },
  { trackId: 'captions', id: 'c2', start: 43.15, end: 46.38, text: "Um I'm searching for someone", speaker: 'spk_1' },
]
const plain = captions.map((c) => ({ ...c, trackId: 'sdh' }))

describe('parseSdhReply', () => {
  it('reads the requested {"cues":[…]} shape, fenced or not', () => {
    const reply = '```json\n{"cues":[{"id":"c1","start":16.92,"end":23.729,"text":"This blade has a dark past"},{"id":"s1","start":24,"end":25,"text":"[fire crackles]","sound":true}]}\n```'
    const out = parseSdhReply(reply, captions)
    expect(out.map((c) => c.text)).toEqual(['This blade has a dark past', '[fire crackles]', "Um I'm searching for someone"])
    expect(out.every((c) => c.trackId === 'sdh')).toBe(true)
    expect(out[1]).toMatchObject({ sound: true })
    expect(serializeVtt(out)).toContain('00:00:24.000 --> 00:00:25.000\n[fire crackles]')
  })

  // Nova Lite on Sintel 1:30–2:30 (2026-10-01) echoed the request envelope instead of {"cues":[…]}.
  it('falls back to the plain captions when the reply echoes the input envelope', () => {
    const reply = JSON.stringify({ language: 'en', captions: [{ id: 'c1', start: 16.92, end: 23.729, text: 'This blade has a dark past' }], descriptions: [{ start: 0, text: 'A person stands.' }] })
    expect(readSdhReply(reply, captions)).toEqual({ cues: plain, degraded: true })
  })

  it('falls back on non-JSON and on cues missing timing or text', () => {
    expect(parseSdhReply('Sorry, I cannot help with that.', captions)).toHaveLength(2)
    expect(parseSdhReply('{"cues":[{"id":"c1","text":"no timing"}]}', captions).map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('accepts a toolUse input object as the reply', () => {
    const out = readSdhReply({ cues: [{ id: 'c1', start: 16.92, end: 23.729, text: 'This blade has a dark past' }, { id: 's1', start: 24, end: 25, text: '[fire crackles]', sound: true }] }, captions)
    expect(out.degraded).toBe(false)
    expect(out.cues.map((c) => c.id)).toEqual(['c1', 's1', 'c2'])
  })

  it('falls back when the reply has zero cues', () => {
    expect(readSdhReply({ cues: [] }, captions)).toEqual({ cues: plain, degraded: true })
    expect(readSdhReply('{"cues":[]}', captions)).toEqual({ cues: plain, degraded: true })
  })

  it('coerces numeric strings and drops a sound cue whose start is not before its end', () => {
    const out = parseSdhReply({ cues: [{ id: 's1', start: '24', end: '25.5', text: '[fire crackles]' }, { id: 's2', start: 30, end: 30, text: '[door slams]' }] }, captions)
    expect(out.filter((c) => c.sound).map((c) => [c.start, c.end, c.text])).toEqual([[24, 25.5, '[fire crackles]']])
  })
})

describe('mergeSdh', () => {
  // Seven captions in the shape of sintel-90-150's captions.vtt.
  const seven: Cue[] = Array.from({ length: 7 }, (_, i) => ({ trackId: 'captions', id: `c${i + 1}`, start: 10 * i, end: 10 * i + 4, text: `Line ${i + 1}`, speaker: 'spk_0' }))
  const echo = (c: Cue, text = c.text) => ({ id: c.id, start: c.start, end: c.end, text })

  it('rebuilds caption cues from the input by id and ignores duplicates and unknown ids', () => {
    const reply = [...seven.slice(0, 4).map((c) => echo(c, `${c.text} (edited)`)), echo(seven[3]!), { id: 'x9', start: 70, end: 73, text: 'Made-up line' }, ...seven.slice(4).map((c) => echo(c))]
    const out = mergeSdh(seven, reply)
    expect(out.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'])
    expect(out.map((c) => c.text)).toEqual(seven.map((c) => c.text))
    expect(out.every((c) => c.trackId === 'sdh')).toBe(true)
  })

  // Nova Lite under the emit_sdh schema (2026-10-01) emitted these next to real sounds.
  it('keeps only bracketed sound cues that name a sound, fit 3 words, and do not overlap a caption', () => {
    const reply = [
      { id: 's1', start: 5, end: 6, text: '[fire crackles]', sound: true },
      { id: 's2', start: 15, end: 16, text: '[rock formation]', sound: true },
      { id: 's3', start: 25, end: 26, text: '[words appear]' },
      { id: 's4', start: 35, end: 36, text: '[woman holds bowl]' },
      { id: 's5', start: 12, end: 13, text: '[wind]' }, // overlaps c2 (10–14)
      { id: 's6', start: 45, end: 46, text: '[wind howls through trees]' }, // 4 words
      { id: 's7', start: 55, end: 58, text: '[footsteps]' }, // 3 s
    ]
    const sounds = mergeSdh(seven, reply).filter((c) => c.sound)
    expect(sounds.map((c) => c.text)).toEqual(['[fire crackles]'])
    expect(sounds[0]).toMatchObject({ trackId: 'sdh', start: 5, end: 6 })
  })

  it('keeps one of two overlapping or duplicate sound cues', () => {
    const out = mergeSdh(seven, [
      { id: 'sa', start: 25, end: 26, text: '[door slams]' },
      { id: 'sb', start: 5, end: 6, text: '[fire crackles]' },
      { id: 'sc', start: 5, end: 6, text: '[fire crackles]' },
      { id: 'sd', start: 5.5, end: 6.5, text: '[wind howls]' },
    ]).filter((c) => c.sound)
    expect(out.map((c) => [c.id, c.start, c.text])).toEqual([['s1', 5, '[fire crackles]'], ['s2', 25, '[door slams]']])
  })
  it('does not read a sound word in brackets as a speaker tag', () => {
    expect(mergeSdh(seven.slice(0, 1), [echo(seven[0]!, '[Wind] Line 1')])[0]!.text).toBe('Line 1')
  })
  it('applies a leading [Name] speaker tag from the reply to the matching input caption', () => {
    const out = mergeSdh(seven.slice(0, 2), [echo(seven[0]!, '[Sintel] Line 1 (edited)'), echo(seven[1]!)])
    expect(out.map((c) => c.text)).toEqual(['[Sintel] Line 1', 'Line 2'])
    expect(out[0]!.speaker).toBe('spk_0')
  })
})
