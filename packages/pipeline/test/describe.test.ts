import { parseDescription } from '../src/steps/04-describe'
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
