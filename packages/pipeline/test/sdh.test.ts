import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime'
import { serializeVtt } from '@moizp/vega-media-kit/core'
import type { Cue } from '@moizp/vega-media-kit/core'
import { replyCues, mergeSdh, chunkCaptions, sdhWithNovaLite, SDH_CHUNK_CAPTIONS, type SdhConverse } from '../src/prompts'
import type { FitCue } from '../src/steps/05-fit'
import { sdh } from '../src/steps/08-text'
import { metered, bedrockUsd } from '../src/cost'

const captions: Cue[] = [
  { trackId: 'captions', id: 'c1', start: 16.92, end: 23.729, text: 'This blade has a dark past', speaker: 'spk_0' },
  { trackId: 'captions', id: 'c2', start: 43.15, end: 46.38, text: "Um I'm searching for someone", speaker: 'spk_1' },
]
const plain = captions.map((c) => ({ ...c, trackId: 'sdh' }))

describe('replyCues', () => {
  const merged = (reply: unknown) => mergeSdh(captions, replyCues(reply)!)
  it('reads the requested {"cues":[…]} shape, fenced or not', () => {
    const reply = '```json\n{"cues":[{"id":"c1","start":16.92,"end":23.729,"text":"This blade has a dark past"},{"id":"s1","start":24,"end":25,"text":"[fire crackles]","sound":true}]}\n```'
    const out = merged(reply)
    expect(out.map((c) => c.text)).toEqual(['This blade has a dark past', '[fire crackles]', "Um I'm searching for someone"])
    expect(out.every((c) => c.trackId === 'sdh')).toBe(true)
    expect(out[1]).toMatchObject({ sound: true })
    expect(serializeVtt(out)).toContain('00:00:24.000 --> 00:00:25.000\n[fire crackles]')
  })

  // Nova Lite on Sintel 1:30–2:30 (2026-10-01) echoed the request envelope instead of {"cues":[…]}.
  it('reads nothing when the reply echoes the input envelope', () => {
    const reply = JSON.stringify({ language: 'en', captions: [{ id: 'c1', start: 16.92, end: 23.729, text: 'This blade has a dark past' }], descriptions: [{ start: 0, text: 'A person stands.' }] })
    expect(replyCues(reply)).toBeUndefined()
  })

  it('reads nothing on non-JSON and on cues missing timing or text', () => {
    expect(replyCues('Sorry, I cannot help with that.')).toBeUndefined()
    expect(replyCues('{"cues":[{"id":"c1","text":"no timing"}]}')).toBeUndefined()
  })

  it('accepts a toolUse input object as the reply', () => {
    const out = merged({ cues: [{ id: 'c1', start: 16.92, end: 23.729, text: 'This blade has a dark past' }, { id: 's1', start: 24, end: 25, text: '[fire crackles]', sound: true }] })
    expect(out.map((c) => c.id)).toEqual(['c1', 's1', 'c2'])
  })

  it('reads zero cues as a valid empty list (the merge is the plain captions)', () => {
    expect(replyCues({ cues: [] })).toEqual([])
    expect(merged('{"cues":[]}')).toEqual(plain)
  })

  it('coerces numeric strings and drops a sound cue whose start is not before its end', () => {
    const out = merged({ cues: [{ id: 's1', start: '24', end: '25.5', text: '[fire crackles]' }, { id: 's2', start: 30, end: 30, text: '[door slams]' }] })
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

// DESC-014: full-length titles. Captions are chunked into windows of ≤ 40 and each Nova Lite call returns additions only.
/** n captions, 3 s apart, 2 s long (a 1 s gap between each), with a 5 s pause after every `pauseEvery`-th caption. */
const many = (n: number, pauseEvery = 0): Cue[] => {
  let t = 0
  return Array.from({ length: n }, (_, i) => {
    const c: Cue = { trackId: 'captions', id: `c${i + 1}`, start: t, end: t + 2, text: `Line ${i + 1}`, speaker: 'spk_0' }
    t += pauseEvery && (i + 1) % pauseEvery === 0 ? 7 : 2.5 // 0.5 s gap normally, 5 s at a pause
    return c
  })
}
const fit = (startMs: number, text: string): FitCue => ({ startMs, endMs: startMs + 1500, text, extended: false, wordCount: text.split(' ').length, shotIndex: 0 })
/** A recorded-shape Nova Lite reply: the forced emit_sdh toolUse block. */
const toolReply = (cues: unknown[], usage = { inputTokens: 2400, outputTokens: 60, totalTokens: 2460 }) => ({ output: { message: { role: 'assistant' as const, content: [{ toolUse: { toolUseId: 't1', name: 'emit_sdh', input: { cues } as never } }] } }, usage })
const userJson = (i: ConverseCommandInput) => JSON.parse(/Input:\n([\s\S]*)\n\nUse the emit_sdh/.exec(i.messages![0]!.content![0]!.text!)![1]!) as { captions: Array<{ id: string }>; descriptions: Array<{ start: number; text: string }> }

describe('chunkCaptions', () => {
  it('chunkCaptions returns one window for ≤ 40 captions', () => {
    expect(chunkCaptions(many(40))).toEqual([many(40)])
    expect(chunkCaptions(many(3))).toHaveLength(1)
    expect(chunkCaptions([])).toEqual([])
  })
  it('chunkCaptions keeps ≤ 40 per window and prefers a ≥ 1 s gap', () => {
    // Pauses after captions 30 and 60: windows end there rather than at 40 mid-conversation; the last 40 fit one window.
    const ws = chunkCaptions(many(100, 30))
    expect(ws.map((w) => w.length)).toEqual([30, 30, 40])
    expect(ws.flat()).toEqual(many(100, 30))
    // No ≥ 1 s gap anywhere: hard split at 40.
    expect(chunkCaptions(many(100)).map((w) => w.length)).toEqual([40, 40, 20])
    expect(chunkCaptions(many(100, 30), 40, 10).map((w) => w.length)).toEqual([40, 40, 20]) // a 5 s pause is below a 10 s split gap
    expect(SDH_CHUNK_CAPTIONS).toBe(40)
  })
})

describe('sdhWithNovaLite (chunked, additions only)', () => {
  it('sdhWithNovaLite makes one call per window with only that window\'s captions and nearby descriptions', async () => {
    const caps = many(60, 30) // windows: c1–c30 (0–74.5 s), c31–c60 (79.5–154 s)
    const descs = [fit(10_000, 'Snow falls.'), fit(77_000, 'Night. A rooftop.'), fit(140_000, 'A dragon lands.'), fit(400_000, 'Far away.')]
    const send = vi.fn<SdhConverse>(async () => toolReply([]))
    const out = await sdhWithNovaLite(caps, descs, 'en', send)
    expect(send).toHaveBeenCalledTimes(2)
    expect(out.calls).toBe(2)
    const [a, b] = send.mock.calls.map(([i]) => userJson(i))
    expect(a!.captions.map((c) => c.id)).toEqual(caps.slice(0, 30).map((c) => c.id))
    expect(b!.captions.map((c) => c.id)).toEqual(caps.slice(30).map((c) => c.id))
    // ±5 s around each window: 77 s is within 5 s of both (74.5 s end, 79.5 s start); 400 s is in neither.
    expect(a!.descriptions.map((d) => d.text)).toEqual(['Snow falls.', 'Night. A rooftop.'])
    expect(b!.descriptions.map((d) => d.text)).toEqual(['Night. A rooftop.', 'A dragon lands.'])
    const sys = send.mock.calls[0]![0].system![0]!.text!
    expect(sys).toContain('Return only (a) sound cues to add and (b) captions that need a speaker tag — omit every caption you leave unchanged')
    expect(sys).not.toContain('keep every input caption unchanged')
    for (const [i] of send.mock.calls) {
      expect(i.inferenceConfig).toEqual({ maxTokens: 4000, temperature: 0 })
      expect(i.toolConfig?.toolChoice).toEqual({ tool: { name: 'emit_sdh' } })
    }
  })

  it('a reply that omits unchanged captions keeps them from the input', async () => {
    const caps = many(5)
    const send = vi.fn<SdhConverse>(async () => toolReply([{ id: 'c2', start: 2.5, end: 4.5, text: '[Sintel] Line 2' }]))
    const out = await sdhWithNovaLite(caps, [], 'en', send)
    expect(out.degraded).toBe(false)
    expect(out.added).toBe(1)
    expect(out.cues.map((c) => c.text)).toEqual(['Line 1', '[Sintel] Line 2', 'Line 3', 'Line 4', 'Line 5'])
    expect(out.cues.every((c) => c.trackId === 'sdh')).toBe(true)
    // A window with nothing to add is a valid empty reply, not a failure.
    expect(await sdhWithNovaLite(caps, [], 'en', async () => toolReply([]))).toEqual({ cues: caps.map((c) => ({ ...c, trackId: 'sdh' })), degraded: false, calls: 1, added: 0 })
  })

  it('sound ids are numbered once across windows and overlaps at a window edge are dropped', async () => {
    const caps = many(60, 30) // c30 ends 74.5 s, c31 starts 79.5 s; c1 0–2 s, c2 2.5–4.5 s
    const replies = [
      [{ id: 's1', start: 2.1, end: 2.4, text: '[door slams]' }, { id: 's2', start: 75, end: 76.5, text: '[thunder]', sound: true }],
      [{ id: 's1', start: 76, end: 77, text: '[wind howls]' }, { id: 's2', start: 77.5, end: 78.5, text: '[footsteps]' }, { id: 'c40', start: 101.5, end: 103.5, text: '[Sintel] Line 40' }],
    ]
    let k = 0
    const out = await sdhWithNovaLite(caps, [], 'en', async () => toolReply(replies[k++]!))
    const sounds = out.cues.filter((c) => c.sound)
    expect(sounds.map((c) => [c.id, c.start, c.text])).toEqual([['s1', 2.1, '[door slams]'], ['s2', 75, '[thunder]'], ['s3', 77.5, '[footsteps]']])
    expect(out.cues.find((c) => c.id === 'c40')!.text).toBe('[Sintel] Line 40')
    expect(out.cues.filter((c) => !c.sound)).toHaveLength(60)
    expect(out.added).toBe(4) // three sounds + one speaker tag
    expect(out.cues.map((c) => c.start)).toEqual([...out.cues.map((c) => c.start)].sort((x, y) => x - y))
  })

  it('one degraded window marks the title degraded', async () => {
    const caps = many(60, 30)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let k = 0
    // Window 2 echoes the request envelope (friction 2026-10-01 "nova-lite-json-echoes-input").
    const send = vi.fn<SdhConverse>(async () => (k++ === 0
      ? toolReply([{ id: 's1', start: 2.1, end: 2.4, text: '[door slams]' }])
      : { output: { message: { role: 'assistant' as const, content: [{ text: JSON.stringify({ language: 'en', captions: [] }) }] } }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }))
    const out = await sdhWithNovaLite(caps, [], 'en', send)
    warn.mockRestore()
    expect(out.degraded).toBe(true)
    expect(out.calls).toBe(2)
    // Window 1's sound survives; window 2's captions are the plain input.
    expect(out.cues.filter((c) => c.sound).map((c) => c.text)).toEqual(['[door slams]'])
    expect(out.cues.filter((c) => !c.sound).map((c) => c.text)).toEqual(caps.map((c) => c.text))
  })

  it('cost is metered per call', async () => {
    const usage = { inputTokens: 2400, outputTokens: 60, totalTokens: 2460 }
    const { value, costUsd } = await metered(() => sdhWithNovaLite(many(100), [], 'en', async () => toolReply([], usage)))
    expect(value.calls).toBe(3)
    expect(costUsd).toBeCloseTo(3 * bedrockUsd('amazon.nova-lite-v1:0', usage), 12)
    expect(costUsd).toBeGreaterThan(0)
  })
})

describe('08-text sdh step', () => {
  it('sdh.json degraded false for the two-window fixture', async () => {
    const work = await mkdtemp(join(tmpdir(), 'sdh-'))
    // 60 one-sentence lines with a 5 s pause after the 30th → segment() gives 60 captions → two windows.
    let t = 0
    const words = Array.from({ length: 60 }, (_, i) => { const w = { start: t, end: t + 2, text: `Line${i + 1}.`, speaker: 'spk_0' }; t += i === 29 ? 7 : 2.5; return w })
    await writeFile(`${work}/words.json`, JSON.stringify(words))
    await writeFile(`${work}/cues.json`, JSON.stringify([fit(76_000, 'Night. A rooftop.')]))
    let k = 0
    const send = vi.fn<SdhConverse>(async () => toolReply(k++ === 0 ? [{ id: 's1', start: 75, end: 76.5, text: '[thunder]' }] : []))
    await sdh({ slug: 't', source: 's', language: 'en', voice: 'Joanna', work }, send)
    expect(send).toHaveBeenCalledTimes(2)
    expect(JSON.parse(await readFile(`${work}/sdh.json`, 'utf8'))).toEqual({ degraded: false })
    const vtt = await readFile(`${work}/sdh.vtt`, 'utf8')
    expect(vtt).toContain('00:01:15.000 --> 00:01:16.500\n[thunder]')
    expect(vtt).toContain('Line60.')
  })
  it('a title where no window added anything is not advertised as Rich captions', async () => {
    const work = await mkdtemp(join(tmpdir(), 'sdh-'))
    await writeFile(`${work}/words.json`, JSON.stringify([{ start: 0, end: 2, text: 'Hello.', speaker: 'spk_0' }, { start: 3, end: 5, text: 'Goodbye.', speaker: 'spk_0' }]))
    await writeFile(`${work}/cues.json`, JSON.stringify([]))
    // Valid replies that add nothing: an empty list, and a caption echoed without a speaker tag.
    await sdh({ slug: 't', source: 's', language: 'en', voice: 'Joanna', work }, async () => toolReply([{ id: 'c1', start: 0, end: 2, text: 'Hello.' }]))
    expect(JSON.parse(await readFile(`${work}/sdh.json`, 'utf8'))).toEqual({ degraded: true })
    // No dialogue at all: no call, not degraded (09-package advertises SDH only when there are captions).
    await writeFile(`${work}/words.json`, JSON.stringify([]))
    await sdh({ slug: 't', source: 's', language: 'en', voice: 'Joanna', work }, async () => { throw new Error('no call expected') })
    expect(JSON.parse(await readFile(`${work}/sdh.json`, 'utf8'))).toEqual({ degraded: false })
  })
})
