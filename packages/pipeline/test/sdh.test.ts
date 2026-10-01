import type { Cue } from '@moizp/vega-media-kit/core'
import { parseSdhReply } from '../src/prompts'

const captions: Cue[] = [
  { trackId: 'captions', id: 'c1', start: 16.92, end: 23.729, text: 'This blade has a dark past', speaker: 'spk_0' },
  { trackId: 'captions', id: 'c2', start: 43.15, end: 46.38, text: "Um I'm searching for someone", speaker: 'spk_1' },
]

describe('parseSdhReply', () => {
  it('reads the requested {"cues":[…]} shape, fenced or not', () => {
    const reply = '```json\n{"cues":[{"id":"c1","start":16.92,"end":23.729,"text":"This blade has a dark past"},{"id":"s1","start":24,"end":25,"text":"[fire crackles]","sound":true}]}\n```'
    const out = parseSdhReply(reply, captions)
    expect(out.map((c) => c.text)).toEqual(['This blade has a dark past', '[fire crackles]'])
    expect(out.every((c) => c.trackId === 'sdh')).toBe(true)
  })

  // Nova Lite on Sintel 1:30–2:30 (2026-10-01) echoed the request envelope instead of {"cues":[…]}.
  it('falls back to the plain captions when the reply echoes the input envelope', () => {
    const reply = JSON.stringify({ language: 'en', captions: [{ id: 'c1', start: 16.92, end: 23.729, text: 'This blade has a dark past' }], descriptions: [{ start: 0, text: 'A person stands. [sword unsheathed]' }] })
    const out = parseSdhReply(reply, captions)
    expect(out).toEqual(captions.map((c) => ({ ...c, trackId: 'sdh' })))
  })

  it('falls back on non-JSON and on cues missing timing or text', () => {
    expect(parseSdhReply('Sorry, I cannot help with that.', captions)).toHaveLength(2)
    expect(parseSdhReply('{"cues":[{"id":"c1","text":"no timing"}]}', captions).map((c) => c.id)).toEqual(['c1', 'c2'])
  })
})
