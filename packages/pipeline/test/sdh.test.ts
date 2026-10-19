import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime'
import { parseVtt, serializeVtt } from '@moiz0309/vega-media-kit/core'
import type { Cue } from '@moiz0309/vega-media-kit/core'
import { replyCues, mergeSdh, chunkCaptions, sdhWithNovaLite, SDH_CHUNK_CAPTIONS, type SdhConverse, type SdhDescription } from '../src/prompts'
import type { FitCue } from '../src/steps/05-fit'
import { sdh, segment, parseMomentary, audibleFrom, loudnessFrames, AUDIBLE_LUFS } from '../src/steps/08-text'
import { metered, bedrockUsd } from '../src/cost'

const captions: Cue[] = [
  { trackId: 'captions', id: 'c1', start: 16.92, end: 23.729, text: 'This blade has a dark past', speaker: 'spk_0' },
  { trackId: 'captions', id: 'c2', start: 43.15, end: 46.38, text: "Um I'm searching for someone", speaker: 'spk_1' },
]
const plain = captions.map((c) => ({ ...c, trackId: 'sdh' }))
/** Evidence that grounds every sound the format tests use (a description over the whole timeline naming each source). */
const anySound = { descriptions: [{ start: 0, end: 1000, text: 'A fire crackles, a door slams, wind howls, thunder rolls, footsteps.' }] }

describe('replyCues', () => {
  const merged = (reply: unknown) => mergeSdh(captions, replyCues(reply)!, anySound)
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

  it('reads the object out of prose around it, fenced or not', () => {
    const cue = '{"cues":[{"id":"s1","start":24,"end":25,"text":"[fire crackles]","sound":true}]}'
    for (const reply of [`Here are the SDH cues:\n${cue}\nNothing else qualifies.`, `Here are the cues:\n\`\`\`json\n${cue}\n\`\`\`\nDone.`, `\`\`\`\n${cue}\n\`\`\``]) {
      expect(replyCues(reply)).toEqual([{ id: 's1', start: 24, end: 25, text: '[fire crackles]', sound: true }])
    }
  })

  it('accepts a toolUse input object as the reply', () => {
    const out = merged({ cues: [{ id: 'c1', start: 16.92, end: 23.729, text: 'This blade has a dark past' }, { id: 's1', start: 24, end: 25, text: '[fire crackles]', sound: true }] })
    expect(out.map((c) => c.id)).toEqual(['c1', 's1', 'c2'])
  })

  it('reads zero cues as a valid empty list (the merge is the plain captions)', () => {
    expect(replyCues({ cues: [] })).toEqual([])
    expect(merged('{"cues":[]}')).toEqual(plain)
  })

  it('coerces numeric strings, gives a zero-length sound cue 1 s, and drops one whose end is before its start', () => {
    const out = merged({ cues: [{ id: 's1', start: '24', end: '25.5', text: '[fire crackles]' }, { id: 's2', start: 30, end: 30, text: '[door slams]' }, { id: 's3', start: 36, end: 35, text: '[wind howls]' }] })
    expect(out.filter((c) => c.sound).map((c) => [c.start, c.end, c.text])).toEqual([[24, 25.5, '[fire crackles]'], [30, 31, '[door slams]']])
  })
})

describe('mergeSdh', () => {
  // Seven captions in the shape of sintel-90-150's captions.vtt.
  const seven: Cue[] = Array.from({ length: 7 }, (_, i) => ({ trackId: 'captions', id: `c${i + 1}`, start: 10 * i, end: 10 * i + 4, text: `Line ${i + 1}`, speaker: 'spk_0' }))
  const echo = (c: Cue, text = c.text) => ({ id: c.id, start: c.start, end: c.end, text })

  it('rebuilds caption cues from the input by id and ignores duplicates and unknown ids', () => {
    const reply = [...seven.slice(0, 4).map((c) => echo(c, `${c.text} (edited)`)), echo(seven[3]!), { id: 'x9', start: 70, end: 73, text: 'Made-up line' }, ...seven.slice(4).map((c) => echo(c))]
    const out = mergeSdh(seven, reply, anySound)
    expect(out.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'])
    expect(out.map((c) => c.text)).toEqual(seven.map((c) => c.text))
    expect(out.every((c) => c.trackId === 'sdh')).toBe(true)
  })

  // Nova Lite under the emit_sdh schema (2026-10-01) emitted these next to real sounds.
  it('keeps only bracketed sound cues that name a sound and fit 3 words; one inside a caption is dropped, one over 2 s is trimmed', () => {
    const reply = [
      { id: 's1', start: 5, end: 6, text: '[fire crackles]', sound: true },
      { id: 's2', start: 15, end: 16, text: '[rock formation]', sound: true },
      { id: 's3', start: 25, end: 26, text: '[words appear]' },
      { id: 's4', start: 35, end: 36, text: '[woman holds bowl]' },
      { id: 's5', start: 12, end: 13, text: '[wind]' }, // overlaps c2 (10–14)
      { id: 's6', start: 45, end: 46, text: '[wind howls through trees]' }, // 4 words
      { id: 's7', start: 55, end: 58, text: '[footsteps]' }, // 3 s: trimmed to its first 2 s
    ]
    const sounds = mergeSdh(seven, reply, anySound).filter((c) => c.sound)
    expect(sounds.map((c) => [c.text, c.start, c.end])).toEqual([['[fire crackles]', 5, 6], ['[footsteps]', 55, 57]])
    expect(sounds[0]).toMatchObject({ trackId: 'sdh' })
  })

  it('keeps one of two overlapping or duplicate sound cues', () => {
    const out = mergeSdh(seven, [
      { id: 'sa', start: 25, end: 26, text: '[door slams]' },
      { id: 'sb', start: 5, end: 6, text: '[fire crackles]' },
      { id: 'sc', start: 5, end: 6, text: '[fire crackles]' },
      { id: 'sd', start: 5.5, end: 6.5, text: '[wind howls]' },
    ], anySound).filter((c) => c.sound)
    expect(out.map((c) => [c.id, c.start, c.text])).toEqual([['s1', 5, '[fire crackles]'], ['s2', 25, '[door slams]']])
  })
  it('does not read a sound word in brackets as a speaker tag', () => {
    expect(mergeSdh(seven.slice(0, 1), [echo(seven[0]!, '[Wind] Line 1')], anySound)[0]!.text).toBe('Line 1')
  })
  it('applies a leading [Name] speaker tag from the reply to the matching input caption', () => {
    const two = [seven[0]!, { ...seven[1]!, text: 'Sintel, wait', speaker: 'spk_1' }] // the name is spoken in the dialogue
    const out = mergeSdh(two, [echo(seven[0]!, '[Sintel] Line 1 (edited)'), echo(two[1]!)], anySound)
    expect(out.map((c) => c.text)).toEqual(['[Sintel] Line 1', 'Sintel, wait'])
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
const fit = (startMs: number, text: string, endMs = startMs + 1500): FitCue => ({ startMs, endMs, text, extended: false, wordCount: text.split(' ').length, shotIndex: 0 })
/** A description over the whole test timeline that names every sound the window tests use. */
const everySound = [fit(0, 'A fire crackles, a door slams, wind howls, thunder rolls, footsteps.', 1_000_000)]
/** A text reply holding exactly `text`. */
const textReply = (text: string, usage = { inputTokens: 2400, outputTokens: 60, totalTokens: 2460 }) => ({ output: { message: { role: 'assistant' as const, content: [{ text }] } }, usage })
/** A plain-JSON text reply, as the SDH request asks for (no forced tool: Nova Lite answered that with ModelErrorException). */
const jsonReply = (cues: unknown[], usage = { inputTokens: 2400, outputTokens: 60, totalTokens: 2460 }) => textReply(JSON.stringify({ cues }), usage)
const userJson = (i: ConverseCommandInput) => JSON.parse(/Input:\n([\s\S]*)\n\nReply with/.exec(i.messages![0]!.content![0]!.text!)![1]!) as { captions: Array<{ id: string }>; descriptions: Array<{ start: number; end: number; text: string }> }

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
    const send = vi.fn<SdhConverse>(async () => jsonReply([]))
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
    expect(sys).toContain('Reply with one JSON object only, no prose, no code fence: {"cues":[')
    expect(a!.descriptions[0]).toEqual({ start: 10, end: 11.5, text: 'Snow falls.' }) // with its end: a sound must sit inside it
    for (const [i] of send.mock.calls) {
      // Greedy decoding: temperature 0 alone gave different replies to the same request (Sintel, 2026-10-14).
      expect(i.inferenceConfig).toEqual({ maxTokens: 4000, temperature: 0 })
      expect(i.additionalModelRequestFields).toEqual({ inferenceConfig: { topK: 1 } })
      // Plain JSON text, no forced tool: Nova Lite answered toolChoice { tool } with ModelErrorException (Tears of Steel, 4 captions).
      expect(i.toolConfig).toBeUndefined()
      expect(i.messages![0]!.content![0]!.text).toMatch(/\n\nReply with the JSON object only\.$/)
    }
  })

  it('a reply that omits unchanged captions keeps them from the input', async () => {
    const caps = many(5).map((c) => (c.id === 'c4' ? { ...c, text: 'Sintel, run', speaker: 'spk_1' } : c))
    const send = vi.fn<SdhConverse>(async () => jsonReply([{ id: 'c2', start: 2.5, end: 4.5, text: '[Sintel] Line 2' }]))
    const out = await sdhWithNovaLite(caps, [], 'en', send)
    expect(out.degraded).toBe(false)
    expect(out.added).toBe(1)
    expect(out.cues.map((c) => c.text)).toEqual(['Line 1', '[Sintel] Line 2', 'Line 3', 'Sintel, run', 'Line 5'])
    expect(out.cues.every((c) => c.trackId === 'sdh')).toBe(true)
    // A window with nothing to add is a valid empty reply, not a failure.
    expect(await sdhWithNovaLite(caps, [], 'en', async () => jsonReply([]))).toEqual({ cues: caps.map((c) => ({ ...c, trackId: 'sdh' })), degraded: false, calls: 1, added: 0 })
  })

  it('sound ids are numbered once across windows and overlaps at a window edge are dropped', async () => {
    const caps = many(60, 30).map((c) => (c.id === 'c1' ? { ...c, text: 'Sintel?', speaker: 'spk_1' } : c)) // c30 ends 74.5 s, c31 starts 79.5 s; c1 0–2 s, c2 2.5–4.5 s
    const replies = [
      [{ id: 's1', start: 2.1, end: 2.4, text: '[door slams]' }, { id: 's2', start: 75, end: 76.5, text: '[thunder]', sound: true }],
      [{ id: 's1', start: 76, end: 77, text: '[wind howls]' }, { id: 's2', start: 77.5, end: 78.5, text: '[footsteps]' }, { id: 'c40', start: 101.5, end: 103.5, text: '[Sintel] Line 40' }],
    ]
    let k = 0
    const out = await sdhWithNovaLite(caps, everySound, 'en', async () => jsonReply(replies[k++]!))
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
      ? jsonReply([{ id: 's1', start: 2.1, end: 2.4, text: '[door slams]' }])
      : { output: { message: { role: 'assistant' as const, content: [{ text: JSON.stringify({ language: 'en', captions: [] }) }] } }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }))
    const out = await sdhWithNovaLite(caps, everySound, 'en', send)
    warn.mockRestore()
    expect(out.degraded).toBe(true)
    expect(out.calls).toBe(2)
    // Window 1's sound survives; window 2's captions are the plain input.
    expect(out.cues.filter((c) => c.sound).map((c) => c.text)).toEqual(['[door slams]'])
    expect(out.cues.filter((c) => !c.sound).map((c) => c.text)).toEqual(caps.map((c) => c.text))
  })

  it('cost is metered per call', async () => {
    const usage = { inputTokens: 2400, outputTokens: 60, totalTokens: 2460 }
    const { value, costUsd } = await metered(() => sdhWithNovaLite(many(100), [], 'en', async () => jsonReply([], usage)))
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
    await writeFile(`${work}/cues.json`, JSON.stringify([fit(76_000, 'Night. Thunder over a rooftop.')]))
    let k = 0
    const send = vi.fn<SdhConverse>(async () => jsonReply(k++ === 0 ? [{ id: 's1', start: 75, end: 76.5, text: '[thunder]' }] : []))
    await sdh({ slug: 't', source: 's', language: 'en', voice: 'Joanna', work }, send, () => true)
    expect(send).toHaveBeenCalledTimes(2)
    expect(JSON.parse(await readFile(`${work}/sdh.json`, 'utf8'))).toEqual({ degraded: false, added: 1 })
    const vtt = await readFile(`${work}/sdh.vtt`, 'utf8')
    expect(vtt).toContain('00:01:15.000 --> 00:01:16.500\n[thunder]')
    expect(vtt).toContain('Line60.')
  })
  it('a title where no window added anything is not degraded: sdh.json says added 0 (09-package then omits Rich captions)', async () => {
    const work = await mkdtemp(join(tmpdir(), 'sdh-'))
    await writeFile(`${work}/words.json`, JSON.stringify([{ start: 0, end: 2, text: 'Hello.', speaker: 'spk_0' }, { start: 3, end: 5, text: 'Goodbye.', speaker: 'spk_0' }]))
    await writeFile(`${work}/cues.json`, JSON.stringify([]))
    // Valid replies that add nothing: an empty list, and a caption echoed without a speaker tag.
    await sdh({ slug: 't', source: 's', language: 'en', voice: 'Joanna', work }, async () => jsonReply([{ id: 'c1', start: 0, end: 2, text: 'Hello.' }]), () => true)
    expect(JSON.parse(await readFile(`${work}/sdh.json`, 'utf8'))).toEqual({ degraded: false, added: 0 })
    // A window that failed twice is degraded, whatever the others added.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await rm(`${work}/cache`, { recursive: true, force: true })
    await sdh({ slug: 't', source: 's', language: 'en', voice: 'Joanna', work }, async () => textReply('no'), () => true)
    warn.mockRestore()
    expect(JSON.parse(await readFile(`${work}/sdh.json`, 'utf8'))).toEqual({ degraded: true, added: 0 })
    // No dialogue at all: no call, not degraded (09-package advertises SDH only when there are captions).
    await writeFile(`${work}/words.json`, JSON.stringify([]))
    await sdh({ slug: 't', source: 's', language: 'en', voice: 'Joanna', work }, async () => { throw new Error('no call expected') })
    expect(JSON.parse(await readFile(`${work}/sdh.json`, 'utf8'))).toEqual({ degraded: false, added: 0 })
  })
  // DESC-010 follow-up: published VTTs carried `<v spk_0>`; the kit's parseVtt reads it as the speaker and CueOverlay draws "[spk_0] ".
  it('writes no voice spans: plain captions are text only, a speaker name stays the SDH bracket tag', async () => {
    const work = await mkdtemp(join(tmpdir(), 'sdh-'))
    const words = [
      { start: 0, end: 1, text: 'Proog,', speaker: 'spk_0' }, { start: 1, end: 2, text: 'wait.', speaker: 'spk_0' },
      { start: 3, end: 4, text: 'I', speaker: 'spk_1' }, { start: 4, end: 5, text: 'am', speaker: 'spk_1' }, { start: 5, end: 6, text: 'here.', speaker: 'spk_1' },
    ]
    await writeFile(`${work}/words.json`, JSON.stringify(words))
    await writeFile(`${work}/cues.json`, JSON.stringify([]))
    // the diarization rule still applies: "Proog" is said by spk_0, so it may name spk_1's caption
    await sdh({ slug: 't', source: 's', language: 'en', voice: 'Joanna', work }, async () => jsonReply([{ id: 'c2', start: 3, end: 6, text: '[Proog] I am here.' }]), () => true)
    const captionsVtt = await readFile(`${work}/captions.vtt`, 'utf8'), sdhVtt = await readFile(`${work}/sdh.vtt`, 'utf8')
    for (const vtt of [captionsVtt, sdhVtt]) { expect(vtt).not.toMatch(/<\/?v[\s.>]/); expect(vtt).not.toContain('spk_') }
    expect(captionsVtt).toContain('00:00:03.000 --> 00:00:06.000\nI am here.\n')
    expect(sdhVtt).toContain('00:00:03.000 --> 00:00:06.000\n[Proog] I am here.\n')
    expect(parseVtt(captionsVtt, { trackId: 'captions' }).map((c) => c.speaker)).toEqual([undefined, undefined])
    expect(parseVtt(sdhVtt, { trackId: 'sdh' }).map((c) => [c.speaker, c.text])).toEqual([[undefined, 'Proog, wait.'], ['Proog', 'I am here.']])
    expect(JSON.parse(await readFile(`${work}/sdh.json`, 'utf8'))).toEqual({ degraded: false, added: 1 })
  })
  it('the same reply tags nothing when both captions are one voice (the diarization rule reads the words, not the VTT)', async () => {
    const work = await mkdtemp(join(tmpdir(), 'sdh-'))
    await writeFile(`${work}/words.json`, JSON.stringify([{ start: 0, end: 2, text: 'Proog, wait.', speaker: 'spk_0' }, { start: 3, end: 6, text: 'I am here.', speaker: 'spk_0' }]))
    await writeFile(`${work}/cues.json`, JSON.stringify([]))
    await sdh({ slug: 't', source: 's', language: 'en', voice: 'Joanna', work }, async () => jsonReply([{ id: 'c2', start: 3, end: 6, text: '[Proog] I am here.' }]), () => true)
    expect(await readFile(`${work}/sdh.vtt`, 'utf8')).not.toContain('[Proog]')
  })
})

// DESC-010 follow-up (2026-10-14): SDH degraded on every title with speech. Nova Lite, given only visual descriptions, returned
// sights as sounds ("fire glows", zero-length, unbracketed) and voice labels or placeholders as names ("[spk_1]", "[Name]"); the
// one run that "added" cues (Tears of Steel) published an invented "[footsteps]" and a literal "[Name]". Every addition now needs
// evidence: a sound, a description naming its source over audible audio; a speaker tag, a name spoken in the dialogue.
describe('SDH grounding (recorded Nova Lite replies, 2026-10-14)', () => {
  const fx = (f: string) => readFileSync(join(__dirname, 'fixtures/sdh', f), 'utf8')
  const replies = JSON.parse(fx('replies-2026-10-14.json')) as Record<string, { cues: Array<{ id: string; start: number; end: number; text: string; sound?: boolean }> }>
  const title = (slug: string) => ({
    captions: parseVtt(fx(`${slug}.captions.vtt`), { trackId: 'captions' }),
    descriptions: parseVtt(fx(`${slug}.descriptions.vtt`), { trackId: 'descriptions' }).map((d) => ({ start: d.start, end: d.end, text: d.text })),
  })
  const additions = (slug: string, reply: string, audible?: (s: number, e: number) => boolean) => {
    const { captions: caps, descriptions } = title(slug)
    const out = mergeSdh(caps, replies[reply]!.cues, { descriptions, audible })
    const plainText = new Map(caps.map((c) => [c.id, c.text]))
    return out.filter((c) => c.sound || plainText.get(c.id) !== c.text).map((c) => c.text)
  }

  it('adds nothing from the replies that held only sights, voice labels and placeholders', () => {
    // old-1's zero-length "old man pours" at 33.17 is grounded by "Old man pours broth." (33.17–34.826): since 2026-10-19 a
    // zero-length cue is read as 1 s (0018-sdh-trim), so it is kept. Its sights and voice labels still are not.
    expect(additions('sintel-90-150-r2', 'sintel-90-150-r2-old-1', () => true)).toEqual(['[old man pours]'])
    expect(mergeSdh(title('sintel-90-150-r2').captions, replies['sintel-90-150-r2-old-1']!.cues, { descriptions: title('sintel-90-150-r2').descriptions, audible: () => true }).filter((c) => c.sound).map((c) => [c.start, c.end])).toEqual([[33.17, 34.17]])
    expect(additions('sintel-90-150-r2', 'sintel-90-150-r2-old-2', () => true)).toEqual([])
    expect(additions('elephants-dream-0-60', 'elephants-dream-0-60-new', () => true)).toEqual([])
    expect(additions('tears-of-steel-40-100', 'tears-of-steel-40-100-new', () => true)).toEqual([])
  })
  it('drops the invented [footsteps] and the literal [Name] that the Tears of Steel re-run published', () => {
    expect(additions('tears-of-steel-40-100', 'tears-of-steel-40-100-published', () => true)).toEqual([])
  })
  it('keeps a sound whose source a description names, over audible audio only', () => {
    expect(additions('sintel-90-150-r2', 'sintel-90-150-r2-new', () => true)).toEqual(['[broth pours]']) // "Old man pours broth."
    expect(additions('sintel-90-150-r2', 'sintel-90-150-r2-new', () => false)).toEqual([])
  })

  const caps: Cue[] = [
    { trackId: 'captions', id: 'c1', start: 10, end: 12, text: 'Emo, wake up.', speaker: 'spk_0' },
    { trackId: 'captions', id: 'c2', start: 20, end: 22, text: "I'm awake.", speaker: 'spk_1' },
    { trackId: 'captions', id: 'c3', start: 30, end: 32, text: 'Get up.', speaker: 'spk_0' },
  ]
  const tag = (id: string, name: string) => { const c = caps.find((k) => k.id === id)!; return { id, start: c.start, end: c.end, text: `[${name}] ${c.text}` } }
  const texts = (reply: Parameters<typeof mergeSdh>[1]) => mergeSdh(caps, reply, { descriptions: [] }).map((c) => c.text)

  it('a speaker tag needs a name spoken in the dialogue, never a placeholder or a voice label', () => {
    expect(texts([tag('c2', 'Emo')])).toEqual(['Emo, wake up.', "[Emo] I'm awake.", 'Get up.'])
    expect(texts([tag('c2', 'Name'), tag('c3', 'Proog')])).toEqual(caps.map((c) => c.text)) // Proog is never said
    expect(texts([{ ...tag('c2', 'Emo'), text: "[spk_1] I'm awake." }])).toEqual(caps.map((c) => c.text))
  })
  it('drops speaker tags that give one voice two names or one name two voices', () => {
    // A third voice also says "Emo", so each tag alone passes; together they give spk_1 and spk_0 the same name.
    const four: Cue[] = [...caps, { trackId: 'captions', id: 'c4', start: 40, end: 42, text: 'Emo!', speaker: 'spk_2' }]
    const one = mergeSdh(four, [tag('c3', 'Emo')], { descriptions: [] }).map((c) => c.text)
    expect(one[2]).toBe('[Emo] Get up.')
    expect(mergeSdh(four, [tag('c2', 'Emo'), tag('c3', 'Emo')], { descriptions: [] }).map((c) => c.text)).toEqual(four.map((c) => c.text))
  })

  const quiet: Cue[] = [{ trackId: 'captions', id: 'c1', start: 0, end: 2, text: 'Hello.', speaker: 'spk_0' }]
  const sound = (start: number, text: string) => ({ id: 's1', start, end: start + 1, text, sound: true })
  const sounds = (reply: Parameters<typeof mergeSdh>[1], descriptions: SdhDescription[], audible?: (s: number, e: number) => boolean) => mergeSdh(quiet, reply, { descriptions, audible }).filter((c) => c.sound).map((c) => c.text)

  it('a sound needs a description overlapping its time (± 2 s) that names its source or action', () => {
    const fire = [{ start: 10, end: 13, text: 'Darkness. A faint fire glows in a stone pit.' }]
    expect(sounds([sound(11, '[fire crackling]')], fire)).toEqual(['[fire crackling]'])
    expect(sounds([sound(14.5, '[fire crackling]')], fire)).toEqual(['[fire crackling]']) // 1.5 s after it: fit places descriptions in gaps
    expect(sounds([sound(16, '[fire crackling]')], fire)).toEqual([]) // 3 s after it
    expect(sounds([sound(11, '[footsteps]')], [{ start: 10, end: 13, text: 'A man gestures while speaking.' }])).toEqual([])
    expect(sounds([sound(11, '[fire crackling]')], [])).toEqual([])
  })
  it('a sound over silent audio is dropped', () => {
    const door = [{ start: 5, end: 8, text: 'She slams the door.' }]
    expect(sounds([sound(6, '[door slams]')], door, (s, e) => s >= 6 && e <= 7)).toEqual(['[door slams]'])
    expect(sounds([sound(6, '[door slams]')], door, () => false)).toEqual([])
  })
})

describe('08-text loudness evidence', () => {
  // ffmpeg ebur128 framelog=verbose lines (-v verbose), trimmed.
  const stderr = [
    '[Parsed_ebur128_0 @ 0x1] t: 0.0999773  TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU',
    '[Parsed_ebur128_0 @ 0x1] t: 0.499977   TARGET:-23 LUFS    M: -30.4 S:-120.7     I: -30.4 LUFS       LRA:   0.0 LU',
    '[Parsed_ebur128_0 @ 0x1] t: 0.899977   TARGET:-23 LUFS    M: -58.1 S:-120.7     I: -30.4 LUFS       LRA:   0.0 LU',
    '[Parsed_ebur128_0 @ 0x1] t: 1.29998    TARGET:-23 LUFS    M:  -inf S:-120.7     I: -30.4 LUFS       LRA:   0.0 LU',
  ].join('\n')
  it('parses t and momentary loudness from the ebur128 frame log', () => {
    expect(parseMomentary(stderr)).toEqual([{ t: 0.0999773, m: -120.7 }, { t: 0.499977, m: -30.4 }, { t: 0.899977, m: -58.1 }, { t: 1.29998, m: -Infinity }])
  })
  it('a span is audible when a frame overlapping it reaches −55 LUFS', () => {
    const audible = audibleFrom(parseMomentary(stderr))
    expect(AUDIBLE_LUFS).toBe(-55)
    expect(audible(0.2, 0.4)).toBe(true) // the −30.4 frame covers 0.1–0.5 s
    expect(audible(0.6, 1.3)).toBe(false) // −58.1 and −inf only
    expect(audibleFrom([])(0, 10)).toBe(false)
  })
})

describe('SDH repeatability and model errors', () => {
  const caps = many(3)
  const reply = [{ id: 's1', start: 2.1, end: 2.4, text: '[door slams]' }]

  it('a re-run with the same input reads each window\'s reply from the cache: same SDH, no call, no cost', async () => {
    const cacheDir = join(await mkdtemp(join(tmpdir(), 'sdh-cache-')), 'cache/sdh')
    const first = await sdhWithNovaLite(caps, everySound, 'en', async () => jsonReply(reply), { cacheDir })
    const send = vi.fn<SdhConverse>(async () => jsonReply([]))
    const { value, costUsd } = await metered(() => sdhWithNovaLite(caps, everySound, 'en', send, { cacheDir }))
    expect(send).not.toHaveBeenCalled()
    expect(costUsd).toBe(0)
    expect(value).toEqual(first)
    expect(value.added).toBe(1)
    // Different input (another description inside the window's ± 5 s) is another key: a new call.
    await sdhWithNovaLite(caps, [...everySound, fit(3_000, 'Snow.')], 'en', send, { cacheDir })
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('an unreadable reply is not cached', async () => {
    const cacheDir = join(await mkdtemp(join(tmpdir(), 'sdh-cache-')), 'cache/sdh')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await sdhWithNovaLite(caps, everySound, 'en', async () => ({ output: { message: { role: 'assistant' as const, content: [{ text: 'no' }] } }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }), { cacheDir })
    warn.mockRestore()
    const send = vi.fn<SdhConverse>(async () => jsonReply(reply))
    expect((await sdhWithNovaLite(caps, everySound, 'en', send, { cacheDir })).added).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
  })

  const modelError = () => Object.assign(new Error('Model produced invalid sequence as part of ToolUse'), { name: 'ModelErrorException' })
  it('retries a ModelErrorException (424) once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let k = 0
    const out = await sdhWithNovaLite(caps, everySound, 'en', async () => { if (k++ === 0) throw modelError(); return jsonReply(reply) })
    warn.mockRestore()
    expect(k).toBe(2)
    expect(out).toMatchObject({ degraded: false, added: 1 })
  })
  it('a second ModelErrorException leaves the window plain and marks the title degraded instead of failing the step', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const send = vi.fn<SdhConverse>(async () => { throw modelError() })
    const out = await sdhWithNovaLite(caps, everySound, 'en', send)
    warn.mockRestore()
    expect(send).toHaveBeenCalledTimes(2)
    expect(out).toEqual({ cues: caps.map((c) => ({ ...c, trackId: 'sdh' })), degraded: true, calls: 1, added: 0 })
  })
  it('retries an unreadable reply once and keeps the second, readable one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const replies = [textReply('{"cues":[{"id":"s1","start":2.1,'), jsonReply(reply)]
    const send = vi.fn<SdhConverse>(async () => replies.shift()!)
    const { value, costUsd } = await metered(() => sdhWithNovaLite(caps, everySound, 'en', send))
    warn.mockRestore()
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]![0]).toEqual(send.mock.calls[0]![0]) // the same request again
    expect(value).toMatchObject({ degraded: false, added: 1, calls: 1 })
    expect(costUsd).toBeCloseTo(2 * bedrockUsd('amazon.nova-lite-v1:0', { inputTokens: 2400, outputTokens: 60 }), 12) // both calls metered
  })
  it('two unreadable replies leave the window plain and mark the title degraded (the existing fallback)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const send = vi.fn<SdhConverse>(async () => textReply('I cannot produce SDH for this.'))
    const out = await sdhWithNovaLite(caps, everySound, 'en', send)
    warn.mockRestore()
    expect(send).toHaveBeenCalledTimes(2)
    expect(out).toEqual({ cues: caps.map((c) => ({ ...c, trackId: 'sdh' })), degraded: true, calls: 1, added: 0 })
  })
  it('an unreadable reply then a ModelErrorException is two attempts: the window falls back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let k = 0
    const send = vi.fn<SdhConverse>(async () => { if (k++ === 0) return textReply('no'); throw modelError() })
    const out = await sdhWithNovaLite(caps, everySound, 'en', send)
    warn.mockRestore()
    expect(send).toHaveBeenCalledTimes(2)
    expect(out).toMatchObject({ degraded: true, added: 0 })
  })
  it('other errors still fail the step', async () => {
    await expect(sdhWithNovaLite(caps, everySound, 'en', async () => { throw Object.assign(new Error('denied'), { name: 'AccessDeniedException' }) })).rejects.toThrow('denied')
  })
})

// PR #38 review round 1.
describe('SDH grounding, review round 1', () => {
  const quiet: Cue[] = [{ trackId: 'captions', id: 'c1', start: 0, end: 2, text: 'Hello.', speaker: 'spk_0' }]
  const kept = (tag: string, description: string) => mergeSdh(quiet, [{ id: 's1', start: 11, end: 12, text: tag, sound: true }], { descriptions: [{ start: 10, end: 13, text: description }], audible: () => true }).filter((c) => c.sound).map((c) => c.text)

  // S1: a shared agent noun ("man", "robot") or a shared source noun with a sight ("tent glows") is not evidence of the sound.
  it.each([
    ['[man screams]', 'A man gestures while speaking.'],
    ['[woman gasps]', 'A woman holds a bowl.'],
    ['[robot footsteps]', 'A robot stands still.'],
    ['[tent rustles]', 'The tent glows.'],
    ['[glass shatters]', 'A door slams.'], // the sound's source is not the described one
    // Round 2: a source that only sometimes makes a sound, or a word that is not the action ("runs" of water, stone "steps").
    ['[dog barks]', 'A dog sleeps by the fire.'],
    ['[bell rings]', 'A bell hangs in the tower.'],
    ['[swords clash]', 'Two swords lie on a table.'],
    ['[panting]', 'The girl runs toward the gate.'],
    ['[footsteps]', 'Water runs down the wall.'],
    ['[footsteps]', 'Stone steps lead to a temple.'],
  ])('drops %s next to "%s"', (tag, description) => {
    expect(kept(tag, description)).toEqual([])
  })
  it.each([
    ['[broth pours]', 'Old man pours broth.'],
    ['[explosion]', 'An explosion rips through the bridge.'],
    ['[fire crackling]', 'A fire burns.'], // the prompt's own example: a source whose sound is known
    ['[door slams]', 'She slams the door.'],
    ['[man screams]', 'A man screams.'],
    ['[footsteps]', 'The girl walks across the ice.'],
    ['[dog barks]', 'A dog barks.'],
    ['[bell rings]', 'The bell rings.'],
    ['[swords clash]', 'Swords clash.'],
  ])('keeps %s next to "%s"', (tag, description) => {
    expect(kept(tag, description)).toEqual([tag])
  })

  // S2, N1, N2: a speaker tag's name must be said in another caption, by another voice; names may be non-ASCII or titled.
  const tagged = (caps: Cue[], id: string, name: string) => mergeSdh(caps, [{ id, start: 0, end: 0, text: `[${name}] ${caps.find((c) => c.id === id)!.text}` }], { descriptions: [] }).map((c) => c.text)
  it('drops a name said only in the tagged caption itself (it names the listener)', () => {
    const caps: Cue[] = [
      { trackId: 'captions', id: 'c1', start: 0, end: 2, text: 'Sintel, run!', speaker: 'spk_0' },
      { trackId: 'captions', id: 'c2', start: 3, end: 5, text: 'Where?', speaker: 'spk_1' },
    ]
    expect(tagged(caps, 'c1', 'Sintel')).toEqual(['Sintel, run!', 'Where?'])
  })
  it('drops a name said only by the same voice elsewhere', () => {
    const caps: Cue[] = [
      { trackId: 'captions', id: 'c1', start: 0, end: 2, text: 'Sintel, run!', speaker: 'spk_0' },
      { trackId: 'captions', id: 'c2', start: 3, end: 5, text: 'Go now.', speaker: 'spk_0' },
    ]
    expect(tagged(caps, 'c2', 'Sintel')).toEqual(['Sintel, run!', 'Go now.'])
  })
  it('accepts a non-ASCII name and a titled name said by another voice', () => {
    const caps: Cue[] = [
      { trackId: 'captions', id: 'c1', start: 0, end: 2, text: 'Jürgen, wo bist du?', speaker: 'spk_0' },
      { trackId: 'captions', id: 'c2', start: 3, end: 5, text: 'Hier.', speaker: 'spk_1' },
      { trackId: 'captions', id: 'c3', start: 6, end: 8, text: 'Dr. Ford is late.', speaker: 'spk_0' },
      { trackId: 'captions', id: 'c4', start: 9, end: 11, text: 'I am here.', speaker: 'spk_2' },
    ]
    expect(tagged(caps, 'c2', 'Jürgen')[1]).toBe('[Jürgen] Hier.')
    expect(tagged(caps, 'c4', 'Dr. Ford')[3]).toBe('[Dr. Ford] I am here.')
  })

  // S3: no frames means the measurement failed, not that the title is silent.
  it('loudness with no momentary frames throws instead of dropping every sound', () => {
    expect(() => loudnessFrames('Input #0, mov,mp4 … no ebur128 lines', 'mezz.mp4')).toThrow('ebur128: no momentary frames parsed from mezz.mp4')
    expect(loudnessFrames('[Parsed_ebur128_0 @ 0x1] t: 0.1  TARGET:-23 LUFS    M: -30.4 S:-120.7', 'mezz.mp4')).toEqual([{ t: 0.1, m: -30.4 }])
  })
})

// 2026-10-19 (docs/decisions/0018-sdh-trim.md): Nova Lite gives a sound cue the whole description's start–end, not the sound's own
// 0.5–2 s, so the merge rejected the only grounded, audible sounds any cached reply held (full Sintel: [creature roars] 6.6 s over
// c18, [woman gasps] 6.1 s over c24). A grounded sound is now trimmed to the first caption-free, audible 0.5–2 s slot inside its
// span and its grounding description's span ± 2 s. What counts as evidence is unchanged.
describe('SDH trims a grounded sound instead of rejecting it (cached replies, 2026-10-19)', () => {
  const fx = (f: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures/sdh/2026-10-19', f), 'utf8'))
  const replies = fx('replies.json') as Record<string, { message: { content: Array<{ text?: string; toolUse?: { input: unknown } }> } }>
  const title = (slug: string, key: string) => {
    const content = replies[`${slug}-${key}`]!.message.content
    return {
      captions: segment(fx(`${slug}.words.json`)),
      descriptions: (fx(`${slug}.cues.json`) as Array<{ startMs: number; endMs: number; text: string }>).map((d) => ({ start: d.startMs / 1000, end: d.endMs / 1000, text: d.text })),
      reply: replyCues(content.find((c) => c.toolUse)?.toolUse?.input ?? content.find((c) => c.text)?.text)!,
    }
  }
  const soundsOf = (slug: string, key: string, audible: (s: number, e: number) => boolean = () => true) => {
    const { captions: caps, descriptions, reply } = title(slug, key)
    const out = mergeSdh(caps, reply, { descriptions, audible })
    const plainText = new Map(caps.map((c) => [c.id, c.text]))
    expect(out.filter((c) => !c.sound && plainText.get(c.id) !== c.text)).toEqual([]) // no speaker tags in these replies
    return out.filter((c) => c.sound).map((c) => [c.text, c.start, c.end])
  }

  it('full Sintel (06e0a0df): keeps [creature roars] and [woman gasps], trimmed to 2 s clear of c18 and c24', () => {
    const { captions: caps } = title('sintel', '06e0a0df')
    expect(caps.find((c) => c.start > 206 && c.start < 207)).toMatchObject({ start: 206.05, end: 208.809 }) // c18
    expect(soundsOf('sintel', '06e0a0df')).toEqual([['[creature roars]', 203.125, 205.125], ['[woman gasps]', 333.745, 335.745]])
  })
  it('full Sintel: the slot moves to the first audible span, and a sound with no audible slot is dropped', () => {
    const out = soundsOf('sintel', '06e0a0df', (s) => s >= 204 && s < 300)
    expect(out).toHaveLength(1)
    expect(out[0]![0]).toBe('[creature roars]')
    expect(out[0]![1]).toBeCloseTo(204.025, 3)
    expect(out[0]![2]).toBeCloseTo(206.025, 3)
    expect(soundsOf('sintel', '06e0a0df', () => false)).toEqual([])
  })
  it('sintel-90-150-r2 (Oct 15, 3972ea6a): [fire crackling] trimmed to 2 s, [broth pours] trimmed past c3 and before c4', () => {
    // [broth pours] 30.042–31.962 overlapped c3 (27.67–30.37) by 0.33 s; c4 starts 31.329.
    expect(soundsOf('sintel-90-150-r2', '3972ea6a')).toEqual([['[fire crackling]', 11.208, 13.208], ['[broth pours]', 30.37, 31.329]])
  })
  it('Tears of Steel (a4c1daac): [console beeps] is still not grounded by "gestures at glowing console"', () => {
    expect(soundsOf('tears-of-steel-40-100', 'a4c1daac')).toEqual([])
  })

  const two: Cue[] = [
    { trackId: 'captions', id: 'c1', start: 10, end: 12, text: 'Hello.', speaker: 'spk_0' },
    { trackId: 'captions', id: 'c2', start: 13, end: 15, text: 'Goodbye.', speaker: 'spk_0' },
  ]
  const door = [{ start: 9, end: 16, text: 'She slams the door.' }]
  const trimmed = (start: number, end: number, descriptions: SdhDescription[] = door, audible: (s: number, e: number) => boolean = () => true) =>
    mergeSdh(two, [{ id: 's1', start, end, text: '[door slams]', sound: true }], { descriptions, audible }).filter((c) => c.sound).map((c) => [c.start, c.end])

  it('a slot is 0.5–2 s inside the cue, clear of captions', () => {
    expect(trimmed(9, 16)).toEqual([[9, 10]]) // 9–10 before c1 (1 s)
    expect(trimmed(11, 16)).toEqual([[12, 13]]) // starts inside c1: the first free time is c1's end, and c2 ends the slot
    expect(trimmed(14, 18)).toEqual([[15, 17]]) // after c2, at most 2 s
    expect(trimmed(11.8, 12.4)).toEqual([]) // only 0.4 s free between c1's end and the cue's end
    expect(trimmed(10.5, 14.5)).toEqual([[12, 13]])
  })
  it('a slot stays within the grounding description ± 2 s', () => {
    const late = [{ start: 20, end: 21, text: 'She slams the door.' }]
    expect(trimmed(15, 30, late)).toEqual([[18, 20]]) // the cue starts at 15; the description allows 18–23
    expect(trimmed(23.5, 26, late)).toEqual([]) // starts more than 2 s after it
  })
  it('a zero-length cue becomes 1 s under the same checks', () => {
    expect(trimmed(16, 16)).toEqual([[16, 17]])
    expect(trimmed(11, 11)).toEqual([]) // 11–12 is inside c1
    expect(trimmed(11.5, 11.5)).toEqual([[12, 12.5]]) // 11.5–12.5 → its caption-free 0.5 s
  })
  it('an ungrounded or silent sound is dropped whatever its length', () => {
    expect(trimmed(16, 20, [{ start: 15, end: 20, text: 'A man gestures.' }])).toEqual([])
    expect(trimmed(16, 20, door, () => false)).toEqual([])
  })
})
