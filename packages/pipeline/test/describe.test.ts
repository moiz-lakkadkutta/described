import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDescribeRequest, cachedDescribe, dedupe, describeCacheKey, describeConcurrency, keyframeArgs, keyframeTimes, knownNames, mapLimit, parseDescription, replyText, type Converse, type RawReply } from '../src/steps/04-describe'
import { wordsFromTranscribe, type Word } from '../src/steps/03-speech'
import { metered } from '../src/cost'
import { describeSystemPrompt } from '../src/prompts'

const p = 'Man holds large weapon.'

describe('parseDescription', () => {
  // sintel-90-150 shot 5: Nova replied "SAME. Woman holds bowl." and the pipeline voiced it.
  it('treats a bare SAME and "SAME. …" as nothing new', () => {
    for (const raw of ['SAME', 'SAME.', 'SAME. Woman holds bowl.']) expect(parseDescription(raw, p)).toEqual({ description: '', sameAsPrev: true })
  })
  it('treats a verbatim or near-verbatim repeat of the previous description as nothing new', () => {
    expect(parseDescription('Man holds large weapon.', p).sameAsPrev).toBe(true)
    expect(parseDescription('Man holds a large weapon', p).sameAsPrev).toBe(true) // Jaccard 4/5 = 0.8
    expect(parseDescription('Woman with red hair holds bowl in front of man.', p)).toEqual({ description: 'Woman with red hair holds bowl in front of man.', sameAsPrev: false })
  })
  it('strips quotes and fences and keeps the text otherwise', () => {
    expect(parseDescription('"Darkness. A faint red glow."', '')).toEqual({ description: 'Darkness. A faint red glow.', sameAsPrev: false })
    expect(parseDescription('```\nDarkness. A faint red glow.\n```', '').description).toBe('Darkness. A faint red glow.')
    expect(parseDescription('Woman holds bowl. Words appear:', '').description).toBe('Woman holds bowl.')
  })
  it('does not mark the first shot as same', () => {
    expect(parseDescription('A person stands in the snow.', '').sameAsPrev).toBe(false)
  })
  // sintel-90-150 shot 9 (near-black) came back as invented text and was promoted to an extended cue.
  it('strips a "Words appear:" clause longer than 8 words', () => {
    expect(parseDescription('Words appear: "You have no idea what you\'re dealing with here." Darkness.', '').description).toBe('Darkness.')
    expect(parseDescription('Words appear: You have no idea what you are dealing with here, girl', '')).toEqual({ description: '', sameAsPrev: false })
    expect(parseDescription('Words appear: "SINTEL". Person stands in snowy landscape holding a sword.', '').description).toBe('Words appear: "SINTEL". Person stands in snowy landscape holding a sword.')
  })
})

describe('describeSystemPrompt', () => {
  it('drops the SAME rule and asks for on-screen text only when it is legible', () => {
    const t = describeSystemPrompt({ maxWords: 8, knownNames: [], language: 'en' })
    expect(t).not.toContain('SAME')
    expect(t).toContain('Never invent text.')
    expect(t).toContain('"Darkness."')
    expect(t).toContain('Output: one line, at most 8 words, no preamble, no quotes.')
    expect(t).toContain('Reply in English.')
    expect(describeSystemPrompt({ maxWords: 8, knownNames: ['Sintel'], language: 'de' })).toMatch(/Reply in German\.[\s\S]*Known names so far: Sintel\./)
  })
})

describe('key frames', () => {
  it('samples 1 per second, at least 3 and at most 6, inside the shot', () => {
    for (const [a, b, n] of [[0, 1000, 3], [10000, 12400, 3], [0, 4000, 4], [5000, 10600, 6], [0, 20000, 6]] as const) {
      const t = keyframeTimes(a, b)
      expect(t).toHaveLength(n)
      for (const x of t) { expect(x).toBeGreaterThan(a); expect(x).toBeLessThan(b) }
      const d = t.slice(1).map((x, i) => x - t[i]!)
      for (const x of d) expect(Math.abs(x - d[0]!)).toBeLessThanOrEqual(1) // evenly spaced (rounded to whole ms)
    }
    expect(keyframeTimes(0, 4100)).toEqual([500, 1500, 2500, 3500]) // the 100 ms tail is new; frame count and (k+0.5)/n spacing are the bake-off's
  })
  // Gate C raters: cuts land ~2 frames late, so the tail of a shot can already show the next one.
  it('keeps clear of the last 100 ms so frames of the next shot are not sent', () => {
    for (const [a, b] of [[0, 1000], [0, 1500], [3000, 4600], [0, 8000], [0, 30000]] as const) expect(Math.max(...keyframeTimes(a, b))).toBeLessThan(b - 100)
  })
  it('builds a single-frame ffmpeg grab: seek before input, ≤ 1024 wide keeping aspect, JPEG q 3', () => {
    const args = keyframeArgs('work/x/mezz.mp4', 12.3456, 'work/x/frames/shot_3_0.jpg')
    const at = (k: string) => args.indexOf(k)
    expect(at('-ss')).toBeLessThan(at('-i'))
    expect(args[at('-ss') + 1]).toBe('12.346')
    expect(args[at('-i') + 1]).toBe('work/x/mezz.mp4')
    expect(args[at('-frames:v') + 1]).toBe('1')
    expect(args[at('-vf') + 1]).toBe("scale='min(1024,iw)':-2")
    expect(args[at('-q:v') + 1]).toBe('3')
    expect(args).toContain('-y')
    expect(args.at(-1)).toBe('work/x/frames/shot_3_0.jpg')
  })
})

describe('buildDescribeRequest', () => {
  it('sends JPEG frames in time order, then the task, with temperature 0 and 120 max tokens', () => {
    const f = [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])]
    const r = buildDescribeRequest('SYS', f, 'qwen.qwen3-vl-235b-a22b')
    expect(r.modelId).toBe('qwen.qwen3-vl-235b-a22b')
    expect(r.system).toEqual([{ text: 'SYS' }])
    expect(r.messages).toHaveLength(1)
    const c = r.messages![0]!.content!
    expect(r.messages![0]!.role).toBe('user')
    expect(c).toHaveLength(4)
    c.slice(0, 3).forEach((b, i) => expect(b).toEqual({ image: { format: 'jpeg', source: { bytes: f[i] } } }))
    expect(c[3]).toEqual({ text: 'These are frames from one shot, in time order. Describe this shot.' })
    expect(r.inferenceConfig).toEqual({ maxTokens: 120, temperature: 0 })
  })
})

describe('replyText', () => {
  it('joins every text block and skips non-text blocks, as the bake-off read the reply', () => {
    expect(replyText({ message: { role: 'assistant', content: [{ reasoningContent: { reasoningText: { text: 'x' } } } as never, { text: 'Woman holds ' }, { text: 'bowl.' }] } })).toBe('Woman holds bowl.')
    expect(replyText({ message: { role: 'assistant', content: [] } })).toBe('')
    expect(replyText(undefined)).toBe('')
  })
})

describe('describe cache', () => {
  const frames = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]
  const reply = (text: string) => ({ output: { message: { role: 'assistant' as const, content: [{ text }] } }, usage: { inputTokens: 2000, outputTokens: 10, totalTokens: 2010 }, stopReason: 'end_turn' as const })
  it('keys on model id, system prompt and every key-frame byte', () => {
    const k = describeCacheKey('m', 'sys', frames)
    expect(k).toMatch(/^[0-9a-f]{64}$/)
    expect(describeCacheKey('m', 'sys', frames)).toBe(k)
    expect(describeCacheKey('m2', 'sys', frames)).not.toBe(k)
    expect(describeCacheKey('m', 'sys!', frames)).not.toBe(k)
    expect(describeCacheKey('m', 'sys', [frames[0]!, new Uint8Array([4, 6])])).not.toBe(k)
  })
  it('calls Bedrock once on a miss, then serves the stored reply at zero cost', async () => {
    const work = await mkdtemp(join(tmpdir(), 'desc-'))
    const send = vi.fn<Converse>(async () => reply('Woman holds bowl.'))
    const miss = await metered(() => cachedDescribe(work, 'qwen.qwen3-vl-235b-a22b', 'sys', frames, send))
    expect(miss.value).toEqual({ text: 'Woman holds bowl.', usage: { inputTokens: 2000, outputTokens: 10 }, stopReason: 'end_turn' })
    expect(miss.costUsd).toBeGreaterThan(0)
    expect(await readdir(join(work, 'cache/describe'))).toEqual([`${describeCacheKey('qwen.qwen3-vl-235b-a22b', 'sys', frames)}.json`])
    const hit = await metered(() => cachedDescribe(work, 'qwen.qwen3-vl-235b-a22b', 'sys', frames, send))
    expect(hit.value).toMatchObject({ text: 'Woman holds bowl.', cached: true })
    expect(hit.costUsd).toBe(0)
    expect(send).toHaveBeenCalledTimes(1)
    await cachedDescribe(work, 'qwen.qwen3-vl-235b-a22b', 'other prompt', frames, send) // new budget or names → new key
    expect(send).toHaveBeenCalledTimes(2)
    expect((await readdir(join(work, 'cache/describe'))).filter((f) => f.endsWith('.tmp'))).toEqual([]) // written via temp + rename
  })
  it('treats a truncated or malformed cache file as a miss and rewrites it', async () => {
    const work = await mkdtemp(join(tmpdir(), 'desc-'))
    const file = join(work, 'cache/describe', `${describeCacheKey('m', 'sys', frames)}.json`)
    await mkdir(join(work, 'cache/describe'), { recursive: true })
    const send = vi.fn<Converse>(async () => reply('Snow falls.'))
    for (const bad of ['{"text":"Snow fa', '{}']) {
      await writeFile(file, bad)
      expect(await cachedDescribe(work, 'm', 'sys', frames, send)).toMatchObject({ text: 'Snow falls.' })
    }
    expect(send).toHaveBeenCalledTimes(2)
    expect(await cachedDescribe(work, 'm', 'sys', frames, send)).toMatchObject({ cached: true })
  })
})

describe('concurrency', () => {
  it('runs at most n at once and keeps input order', async () => {
    let live = 0, peak = 0
    const out = await mapLimit([30, 5, 20, 1, 10, 2], 4, async (ms) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, ms)); live--; return ms })
    expect(out).toEqual([30, 5, 20, 1, 10, 2])
    expect(peak).toBe(4)
  })
  it('after a failure starts nothing new and settles every running item before rejecting', async () => {
    const started: number[] = [], finished: number[] = []
    const p = mapLimit([0, 1, 2, 3, 4, 5, 6, 7], 3, async (i) => {
      started.push(i)
      await new Promise((r) => setTimeout(r, i === 1 ? 5 : 30))
      if (i === 1) throw new Error('ThrottlingException')
      finished.push(i)
      return i
    })
    await expect(p).rejects.toThrow('ThrottlingException')
    expect(started).toEqual([0, 1, 2]) // 3…7 never called Bedrock
    expect(finished.sort()).toEqual([0, 2]) // in-flight calls finished before the step returned (and its meter was read)
  })
  it('stops starting items once the signal aborts', async () => {
    const ac = new AbortController()
    const seen: number[] = []
    await expect(mapLimit([0, 1, 2, 3], 1, async (i) => { seen.push(i); if (i === 1) ac.abort(); return i }, ac.signal)).rejects.toThrow()
    expect(seen).toEqual([0, 1])
  })
  it('reads DESCRIBE_CONCURRENCY, default 4', () => {
    vi.stubEnv('DESCRIBE_CONCURRENCY', '')
    expect(describeConcurrency()).toBe(4)
    vi.stubEnv('DESCRIBE_CONCURRENCY', '8')
    expect(describeConcurrency()).toBe(8)
    vi.unstubAllEnvs()
  })
  it('dedupes against the previous shot in time order, whatever order the replies arrived in', () => {
    const shots = [0, 1, 2, 3].map((index) => ({ index, startMs: index * 2000, endMs: index * 2000 + 2000 }))
    const r = (text: string): RawReply => ({ text, usage: { inputTokens: 100, outputTokens: 5 } })
    const d = dedupe(shots, [r('Man holds large weapon.'), r('Man holds a large weapon'), r('SAME'), r('Woman holds bowl.')])
    expect(d.map((x) => [x.description, x.sameAsPrev])).toEqual([['Man holds large weapon.', false], ['Man holds a large weapon', true], ['', true], ['Woman holds bowl.', false]])
    expect(d[0]).toMatchObject({ tokens: 100, outputTokens: 5 })
  })
})

describe('known names', () => {
  const said = (text: string, speakers: string[] = []) => text.split(' ').map((t, i): Word => ({ start: i, end: i + 0.5, text: t, speaker: speakers[i] ?? 'spk_0' }))
  it('collects names spoken before the shot, in order, once', () => {
    const w = said('Thank you, Sintel. Where is Scales? Sintel, wait.')
    expect(knownNames(w, 2500, 'en')).toEqual(['Sintel'])
    expect(knownNames(w, 1000, 'en')).toEqual([])
    expect(knownNames(w, 99000, 'en')).toEqual(['Sintel', 'Scales'])
  })
  it('skips sentence and turn openers, common capitalised words and words also heard lowercase', () => {
    expect(knownNames(said('Look. Dragons fly. So, What now? I see Mr. Smith.'), 99000, 'en')).toEqual(['Smith'])
    expect(knownNames(said('Hello there Hope. I hope so.'), 99000, 'en')).toEqual([])
    expect(knownNames(said('Run Fast', ['spk_0', 'spk_1']), 99000, 'en')).toEqual([])
  })
  it('finds no names in the sintel-90-150 transcript, and none for German', () => {
    const t = JSON.parse(readFileSync(new URL('./fixtures/sintel-90-150.transcript.json', import.meta.url), 'utf8'))
    expect(knownNames(wordsFromTranscribe(t), 60000, 'en')).toEqual([])
    expect(knownNames(said('Danke, Sintel.'), 99000, 'de')).toEqual([])
  })
})
