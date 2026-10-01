import { buildDescribeRequest, keyframeArgs, keyframeTimes, parseDescription, replyText } from '../src/steps/04-describe'
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
