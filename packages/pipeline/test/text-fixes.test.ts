import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripDarkness, textSpans } from '../src/textClause'
import { fit, introducesNew, safeShorten, textClauses, type FitCue } from '../src/steps/05-fit'
import { voice } from '../src/steps/06-voice'
import { parseDescription, type Described } from '../src/steps/04-describe'
import { describeSystemPrompt } from '../src/prompts'
import type { Ctx } from '../src/steps/index'

/**
 * DESC-010 follow-ups (docs/titles.md, "Follow-ups from this batch"), with the real strings of the five-title batch (2026-10-14):
 * tears-of-steel-40-100 d8, its newspaper headline cue, and the "Darkness." prefixes on d10 and d12.
 */
const TITLE = 'Darkness. Words appear: "TEARS OF STEEL" in metallic silver, centered.' // the description d7 + d8 were split from
const HEADLINE = 'Hand holds crumpled newspaper headline: ROBOTICIST CREATES KILLER ROBOTS' // dropped by voice, 741 ms over
const D10 = 'Darkness. A figure kneels beside a prone body, candles flicker nearby.'
const D12 = 'Darkness. A mechanical airship with glowing lights hovers over a foggy city viewed through a circular window.'

const startsLower = (t: string) => /^\p{Ll}/u.test(t.trim())

describe('on-screen text: a trailing modifier goes with its clause (Tears of Steel d8)', () => {
  it('a modifier after the closing quote is part of the clause, so the rest never starts with a lowercase fragment', () => {
    const c = textClauses(TITLE)!
    expect(c.clause).toBe('Words appear: "TEARS OF STEEL" in metallic silver, centered.')
    expect(c.rest).toBe('Darkness.')
    expect(textSpans(TITLE)[0]!.body).toBe('TEARS OF STEEL') // the text itself, as said, is only what is quoted
    expect(textClauses('Words appear: "NORTH", in red. A man runs.')).toMatchObject({ clause: 'Words appear: "NORTH", in red.', rest: 'A man runs.' })
    // a capitalised sentence after the quote is the next sentence, not a modifier
    expect(textClauses('Words appear: "NORTH" A man runs.')).toMatchObject({ clause: 'Words appear: "NORTH"', rest: 'A man runs.' })
  })
  it('voice: the split-off text pause carries the modifier and no voiced cue starts with a lowercase fragment', async () => {
    const work = await mkdtemp(join(tmpdir(), 'voice-d8-'))
    try {
      const ctx: Ctx = { slug: 't', source: 's.mp4', language: 'en', voice: 'Joanna', work }
      const cue: FitCue = { startMs: 26004, endMs: 27004, text: TITLE, extended: false, wordCount: 10, shotIndex: 7, limitMs: 28000 }
      await writeFile(`${work}/cues.json`, JSON.stringify([cue]))
      await voice(ctx, { synthesize: async (t) => new TextEncoder().encode(t), measureMs: async (f) => (await readFile(f, 'utf8')).split(/\s+/).length * 560 })
      const out = JSON.parse(await readFile(`${work}/cues.json`, 'utf8')) as FitCue[]
      expect(out.map((c) => [c.extended, c.text])).toEqual([[true, 'Words appear: "TEARS OF STEEL" in metallic silver, centered.'], [false, 'Darkness.']])
      for (const c of out) expect(startsLower(c.text)).toBe(false)
    } finally { await rm(work, { recursive: true, force: true }) }
  })
})

describe('on-screen text the model does not label "Words appear:"', () => {
  it('recognises a headline, a sign that reads, a quoted caption or title card', () => {
    const one = (t: string) => { const s = textSpans(t); expect(s).toHaveLength(1); return { clause: t.slice(s[0]!.start, s[0]!.end).trim(), body: s[0]!.body } }
    // the whole sentence is the clause: the noun before the label is never left behind as a fragment
    expect(one(HEADLINE)).toEqual({ clause: HEADLINE, body: 'ROBOTICIST CREATES KILLER ROBOTS' })
    expect(one('Newspaper headline: "ROBOTS ATTACK". A man runs.')).toEqual({ clause: 'Newspaper headline: "ROBOTS ATTACK".', body: 'ROBOTS ATTACK' })
    expect(one('Rain. A shop sign reads OPEN 24 HOURS.')).toEqual({ clause: 'A shop sign reads OPEN 24 HOURS.', body: 'OPEN 24 HOURS' })
    expect(one('A man waits. The screen reads "SIMULATION READY".')).toEqual({ clause: 'The screen reads "SIMULATION READY".', body: 'SIMULATION READY' })
    expect(one('A banner reads: "WELCOME HOME" above the door.')).toEqual({ clause: 'A banner reads: "WELCOME HOME" above the door.', body: 'WELCOME HOME' })
    expect(one('Title card: "TEARS OF STEEL".')).toEqual({ clause: 'Title card: "TEARS OF STEEL".', body: 'TEARS OF STEEL' })
    expect(one('Caption "40 YEARS LATER" fades in.')).toEqual({ clause: 'Caption "40 YEARS LATER" fades in.', body: '40 YEARS LATER' })
    expect(one('Schnee. Schlagzeile: ROBOTER GREIFEN AN.')).toEqual({ clause: 'Schlagzeile: ROBOTER GREIFEN AN.', body: 'ROBOTER GREIFEN AN' })
    expect(textClauses(`${HEADLINE}. A soldier aims a rifle.`)).toMatchObject({ clause: `${HEADLINE}.`, rest: 'A soldier aims a rifle.' })
    expect(introducesNew(HEADLINE)).toBe(true)
  })
  it('does not take reading, a title or a sign as on-screen text when no text is given', () => {
    for (const t of ['Man reads newspaper; soldier aims rifle.', 'She reads a letter by the fire.', 'A man holds a sign.', 'The title fades.', 'Hand holds crumpled newspaper.', 'A street sign glows.'])
      expect(textSpans(t)).toEqual([])
  })
  it('voice: the headline cue that overruns becomes a pause instead of being dropped', async () => {
    const work = await mkdtemp(join(tmpdir(), 'voice-headline-'))
    try {
      const ctx: Ctx = { slug: 't', source: 's.mp4', language: 'en', voice: 'Joanna', work }
      const cue: FitCue = { startMs: 59958, endMs: 61000, text: HEADLINE, extended: false, wordCount: 8, shotIndex: 14, limitMs: 62000 }
      await writeFile(`${work}/cues.json`, JSON.stringify([cue]))
      await voice(ctx, { synthesize: async (t) => new TextEncoder().encode(t), measureMs: async (f) => (await readFile(f, 'utf8')).split(/\s+/).length * 560 })
      const out = JSON.parse(await readFile(`${work}/cues.json`, 'utf8')) as FitCue[]
      expect(out.map((c) => [c.extended, c.text])).toEqual([[true, HEADLINE]])
    } finally { await rm(work, { recursive: true, force: true }) }
  })
  it('the describe prompt asks for the "Words appear:" form for signs, headlines and captions too', () => {
    const t = describeSystemPrompt({ maxWords: 8, knownNames: [], language: 'en' })
    expect(t).toMatch(/signs?, headlines?/)
    expect(t).toContain('Never invent text.')
  })
})

describe('"Darkness." is the whole description or absent', () => {
  it('strips a "Darkness." prefix in front of a visible scene and keeps a bare "Darkness."', () => {
    expect(stripDarkness(D10)).toBe('A figure kneels beside a prone body, candles flicker nearby.')
    expect(stripDarkness(D12)).toBe('A mechanical airship with glowing lights hovers over a foggy city viewed through a circular window.')
    expect(stripDarkness(TITLE)).toBe('Words appear: "TEARS OF STEEL" in metallic silver, centered.')
    expect(stripDarkness('Darkness.')).toBe('Darkness.')
    expect(stripDarkness('darkness. ')).toBe('darkness.')
    expect(stripDarkness('Dunkelheit. Ein Feuer glüht.')).toBe('Ein Feuer glüht.')
    expect(stripDarkness('A man walks off. Darkness.')).toBe('A man walks off. Darkness.') // a fade to black after the action is not a prefix
    expect(stripDarkness('Darkened room. A lamp.')).toBe('Darkened room. A lamp.')
  })
  it('parseDescription and fit apply it (fit: so a re-run from fit cleans an existing described.json)', async () => {
    expect(parseDescription(D12, '').description).toBe('A mechanical airship with glowing lights hovers over a foggy city viewed through a circular window.')
    expect(parseDescription('Darkness.', '').description).toBe('Darkness.')
    const shot = (description: string): Described => ({ index: 0, startMs: 0, endMs: 9000, description, sameAsPrev: false, tokens: 0, outputTokens: 0 })
    const cues = await fit([shot(D10)], [{ startMs: 0, endMs: 9000 }], (t, n) => safeShorten(t, n, (x) => x))
    expect(cues.map((c) => c.text)).toEqual(['A figure kneels beside a prone body, candles flicker nearby.'])
    expect((await fit([shot('Darkness.')], [{ startMs: 0, endMs: 9000 }], (t) => t)).map((c) => c.text)).toEqual(['Darkness.'])
  })
  it('the describe prompt keeps "Darkness." for frames where nothing can be made out, and never as a prefix', () => {
    const t = describeSystemPrompt({ maxWords: 8, knownNames: [], language: 'en' })
    expect(t).toContain('"Darkness."')
    expect(t).not.toContain('Darkness. A faint red glow.')
  })
})
