import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sentences, stripDarkness, textSpans } from '../src/textClause'
import { fit, introducesNew, safeShorten, shortenDeterministic, textClauses, type FitCue } from '../src/steps/05-fit'
import { voice, withoutSaidText } from '../src/steps/06-voice'
import { newSentences, parseDescription, type Described } from '../src/steps/04-describe'
import { describeSystemPrompt, type EditConverse } from '../src/prompts'
import { plotEvents } from '../src/plotEvent'
import { editScene } from '../src/steps/05b-edit'
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
    expect(t).toContain('Never invent or guess text.')
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

/** PR #37 review round 1: the regression strings the review gave, as written. */
describe('PR #37 review round 1', () => {
  // B1: on main these are plain descriptions; the invented-text drop must not delete them.
  it('B1: an over-long unlabelled match is not a text clause, so parseDescription keeps the whole description', () => {
    for (const t of [
      'The card says Happy Birthday in gold letters, and a woman smiles at the boy.',
      'A soldier aims; the screen reads TARGET LOCKED ON THE NORTHERN SECTOR OF THE CITY WALL NOW.',
      'He reads the note: his hands tremble and he drops it on the floor, crying.',
    ]) expect(parseDescription(t, '').description).toBe(t)
    // a labelled clause over 8 words is still dropped (invented text), as on main
    expect(parseDescription('Words appear: "You have no idea what you\'re dealing with here." Darkness.', '').description).toBe('Darkness.')
  })
  it('B2: verbs, pronoun subjects and lowercase bare bodies are not on-screen text', () => {
    for (const t of [
      'He reads the note: his hands tremble.',
      'Soldiers stand in front of monitors: three men type.',
      'The display: a green grid of lights.',
      'Monitors: green waveforms pulse.',
      'The sign says nothing.',
      'He signs: thank you.',
      'Ein Schild: rot und rostig.',
      'She signs "THANK YOU" to him.',
    ]) expect(textSpans(t), t).toEqual([])
  })
  it('B3: a carrier clause starts after a comma, semicolon, colon or joining word; the action stays in rest, a full sentence', () => {
    const EXIT = 'A soldier in grey armour grabs the rifle as a sign reads "EXIT".'
    expect(textClauses(EXIT)).toMatchObject({ clause: 'A sign reads "EXIT".', rest: 'A soldier in grey armour grabs the rifle.' })
    expect(textClauses('A technician types as monitors: SYSTEM ONLINE.')).toMatchObject({ clause: 'Monitors: SYSTEM ONLINE.', rest: 'A technician types.' })
    expect(textClauses('A soldier rips the newspaper, headline: ROBOTS ATTACK.')).toMatchObject({ clause: 'Headline: ROBOTS ATTACK.', rest: 'A soldier rips the newspaper.' })
    expect(textClauses('Rain falls; a sign reads CLOSED.')).toMatchObject({ clause: 'A sign reads CLOSED.', rest: 'Rain falls.' })
    // nothing separates the action from the carrier: the whole sentence is the clause
    expect(textClauses(HEADLINE)).toMatchObject({ clause: HEADLINE, rest: '' })
    expect(shortenDeterministic(EXIT, 13)).toBe(EXIT)
  })
  it('B3: fit places the action on the plain track and the text as its own pause', async () => {
    const shot = (description: string): Described => ({ index: 0, startMs: 0, endMs: 3000, description, sameAsPrev: false, tokens: 0, outputTokens: 0 })
    const exit = await fit([shot('A soldier in grey armour grabs the rifle as a sign reads "EXIT".')], [{ startMs: 0, endMs: 3650 }], (t, n) => safeShorten(t, n, (x) => x))
    expect(exit.map((c) => [c.extended, c.text])).toEqual([[true, 'A sign reads "EXIT".'], [false, 'A soldier in grey armour grabs the rifle.']])
    const tech = await fit([shot('A technician types as monitors: SYSTEM ONLINE.')], [{ startMs: 0, endMs: 1950 }], (t, n) => safeShorten(t, n, (x) => x))
    expect(tech.map((c) => [c.extended, c.text])).toEqual([[true, 'Monitors: SYSTEM ONLINE.'], [false, 'A technician types.']])
  })
  it('B3: plotEvents still finds the action beside a carrier clause', () => {
    expect(plotEvents('A soldier grabs the rifle as a sign reads "EXIT".', '')).toEqual(['grabs'])
  })
  it('B3: withoutSaidText keeps the action and tidies the sentence', () => {
    expect(withoutSaidText('A soldier tears down the poster that reads "WANTED". He runs.', ['wanted'])).toBe('A soldier tears down the poster. He runs.')
    expect(withoutSaidText('A soldier rips the newspaper, headline: ROBOTS ATTACK.', ['robots attack'])).toBe('A soldier rips the newspaper.')
  })
  it('S2: the trailing-modifier rule stops before a joining word that starts the next action', () => {
    expect(textClauses('Words appear: "NORTH" and a man runs in.')).toMatchObject({ clause: 'Words appear: "NORTH"', rest: 'A man runs in.' })
    expect(textClauses('Words appear: "NORTH" in red as a man runs in.')).toMatchObject({ clause: 'Words appear: "NORTH" in red', rest: 'A man runs in.' })
    expect(textClauses(TITLE)).toMatchObject({ clause: 'Words appear: "TEARS OF STEEL" in metallic silver, centered.', rest: 'Darkness.' })
  })
  it('stripDarkness also takes "Darkness..." and "Darkness," and capitalises what follows', () => {
    expect(stripDarkness('Darkness... A glow.')).toBe('A glow.')
    expect(stripDarkness('Darkness… A glow.')).toBe('A glow.')
    expect(stripDarkness('Darkness, a glow.')).toBe('A glow.')
    expect(stripDarkness('Darkness...')).toBe('Darkness...')
  })
  it('the describe prompt asks for "dim" when the scene is visible but dim', () => {
    expect(describeSystemPrompt({ maxWords: 8, knownNames: [], language: 'en' })).toMatch(/visible but dim, say dim\./)
  })
  it('decision 0009: the darkness rule gives no example sentence to copy (g8 shot 2 voiced "A dim room. A fire glows." verbatim)', () => {
    const rule = describeSystemPrompt({ maxWords: 8, knownNames: [], language: 'en' }).split('\n').find((l) => l.includes('Darkness.'))!
    expect(rule).toBe('- Write only "Darkness." when the frames are black and nothing can be made out. If anything is visible, even dimly, describe it and do not write "Darkness."; if the scene is visible but dim, say dim.')
    expect(rule).not.toMatch(/e\.g\.|fire glows/i)
  })
  it('S1: the edit step reads the shot descriptions without the "Darkness." prefix', async () => {
    const shots: Described[] = [
      { index: 0, startMs: 0, endMs: 3000, description: 'Smoke rises.', sameAsPrev: false, tokens: 0, outputTokens: 0 },
      { index: 1, startMs: 3000, endMs: 6000, description: 'Darkness. A lamp flickers.', sameAsPrev: false, tokens: 0, outputTokens: 0 },
      { index: 2, startMs: 6000, endMs: 9000, description: 'Darkness. A figure kneels beside a prone body.', sameAsPrev: false, tokens: 0, outputTokens: 0 },
    ]
    const cues: FitCue[] = [
      { startMs: 0, endMs: 1500, text: 'Smoke rises.', extended: false, wordCount: 2, shotIndex: 0, limitMs: 3000 },
      { startMs: 6000, endMs: 8500, text: 'A figure kneels beside a prone body.', extended: false, wordCount: 7, shotIndex: 2, limitMs: 20000 },
    ]
    const seen: string[] = []
    const send: EditConverse = async (i) => {
      seen.push((i.messages![0]!.content![0] as { text: string }).text)
      return { output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 't1', name: 'emit_edits', input: { edits: [{ cue: 1, text: 'Darkness. A figure kneels beside a prone body.' }] } } }] } }, usage: { inputTokens: 1, outputTokens: 1 } } as never
    }
    const r = await editScene(cues, shots, [], 'en', send, undefined, (t) => t)
    expect(seen.join('\n')).toContain('A lamp flickers.')
    expect(seen.join('\n')).not.toContain('Darkness')
    expect(r.applied).toEqual([])
    expect(r.cues[1]!.text).toBe('A figure kneels beside a prone body.')
  })
})

/** PR #37 review round 2. */
describe('PR #37 review round 2', () => {
  const WANTED = 'A soldier tears down the poster that reads "WANTED". He runs.'
  it('N1: a clause that starts with the bare verb is said with the house label; its body is unchanged', async () => {
    expect(textClauses(WANTED)).toMatchObject({ clause: 'Words appear: "WANTED".', rest: 'A soldier tears down the poster. He runs.' })
    expect(textSpans(WANTED)[0]!.body).toBe('WANTED')
    const shot: Described = { index: 0, startMs: 0, endMs: 3000, description: WANTED, sameAsPrev: false, tokens: 0, outputTokens: 0 }
    const cues = await fit([shot], [{ startMs: 0, endMs: 3650 }], (t, n) => safeShorten(t, n, (x) => x))
    expect(cues.map((c) => [c.extended, c.text])).toEqual([[true, 'Words appear: "WANTED".'], [false, 'A soldier tears down the poster. He runs.']])
    for (const c of cues) expect(c.text).not.toMatch(/^Reads\b/)
  })
  it('N2: a bare body after an unlabelled carrier needs an all-caps first word or a digit', () => {
    for (const t of ['Monitors: Thom types quickly.', 'Notes: Celia plays the cello.', 'Sintel holds a letter: The dragon lives.']) expect(textSpans(t), t).toEqual([])
    for (const [t, body] of [[HEADLINE, 'ROBOTICIST CREATES KILLER ROBOTS'], ['A shop sign reads OPEN 24 HOURS.', 'OPEN 24 HOURS'], ['A sign reads STOP.', 'STOP'], ['Schlagzeile: ROBOTER GREIFEN AN.', 'ROBOTER GREIFEN AN'], ['A plaque reads 1888.', '1888']])
      expect(textSpans(t!).map((s) => s.body), t).toEqual([body])
  })
  it('N3: a bare body ends before ", and …", and a trailing modifier stops before an English or German joining word', () => {
    expect(textClauses('A sign reads OPEN, and a man enters.')).toMatchObject({ clause: 'A sign reads OPEN', rest: 'A man enters.' })
    expect(textSpans('A sign reads OPEN, and a man enters.')[0]!.body).toBe('OPEN')
    expect(textClauses('Das Schild zeigt „AUSGANG“, und ein Mann rennt.')).toMatchObject({ clause: 'Das Schild zeigt „AUSGANG“', rest: 'Ein Mann rennt.' })
    expect(textClauses('The board shows "B" as Thom runs.')).toMatchObject({ clause: 'The board shows "B"', rest: 'Thom runs.' })
  })
  it('N4: "signs" is a verb, not a carrier', () => {
    expect(textSpans('The woman signs: I LOVE YOU.')).toEqual([])
    expect(textSpans('A pole holds two street signs: MAIN, ELM.')).toHaveLength(1)
  })
  it('parseDescription warns when an unlabelled match is not text because it is too long', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const t = 'A soldier aims; the screen reads TARGET LOCKED ON THE NORTHERN SECTOR OF THE CITY WALL NOW.'
      expect(parseDescription(t, '').description).toBe(t)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('longer than 8 words'), expect.stringContaining('TARGET LOCKED'))
    } finally { warn.mockRestore() }
  })
})

/** Tears of Steel d6 (2026-10-14 re-run): the AD track voiced "LOCKED. Two people at glowing tech tables." — the text was cut at "...". */
const D6 = 'Words appear: SIMULATION READY... LOCKED. Two people at glowing tech tables.'

describe('on-screen text with an ellipsis inside it is one clause (Tears of Steel d6)', () => {
  it('bare text keeps "SIMULATION READY... LOCKED." whole; the rest is the action', () => {
    expect(textSpans(D6).map((s) => s.body)).toEqual(['SIMULATION READY... LOCKED'])
    expect(textClauses(D6)).toMatchObject({ clause: 'Words appear: SIMULATION READY... LOCKED.', rest: 'Two people at glowing tech tables.' })
    expect(sentences(D6)).toEqual(['Words appear: SIMULATION READY... LOCKED.', 'Two people at glowing tech tables.'])
  })
  it('the Unicode ellipsis "…" too', () => {
    const t = 'Words appear: SIMULATION READY… LOCKED. Two people at glowing tech tables.'
    expect(textClauses(t)).toMatchObject({ clause: 'Words appear: SIMULATION READY… LOCKED.', rest: 'Two people at glowing tech tables.' })
    expect(sentences(t)).toEqual(['Words appear: SIMULATION READY… LOCKED.', 'Two people at glowing tech tables.'])
  })
  it('an ellipsis that ends the text before the next sentence still ends it', () => {
    expect(textClauses('Words appear: LOADING... A man walks in.')).toMatchObject({ clause: 'Words appear: LOADING...', rest: 'A man walks in.' })
    expect(textClauses('Words appear: LOADING… A man walks in.')).toMatchObject({ clause: 'Words appear: LOADING…', rest: 'A man walks in.' })
    expect(textClauses('A screen reads LOADING... Thom types.')).toMatchObject({ clause: 'A screen reads LOADING...', rest: 'Thom types.' })
  })
  it('quoted text with an ellipsis inside', () => {
    for (const t of ['Words appear: "SIMULATION READY... LOCKED." Two people at glowing tech tables.', 'The screen reads “SIMULATION READY… LOCKED.” Two people at glowing tech tables.']) {
      expect(textClauses(t)!.rest).toBe('Two people at glowing tech tables.')
      expect(sentences(t)).toEqual([t.slice(0, t.indexOf(' Two')), 'Two people at glowing tech tables.'])
    }
    expect(textSpans('Words appear: "WAIT… WHAT?" A man turns.')[0]!.body).toBe('WAIT… WHAT?')
  })
  it('outside on-screen text, an ellipsis ends a sentence as before ("..." and "…")', () => {
    expect(sentences('He waits... The door opens.')).toEqual(['He waits...', 'The door opens.'])
    expect(sentences('He waits… The door opens.')).toEqual(['He waits…', 'The door opens.'])
    expect(textClauses('He waits... The door opens.')).toBeUndefined()
  })
  it('German', () => {
    const t = 'Text erscheint: SIMULATION BEREIT... GESPERRT. Zwei Personen an leuchtenden Tischen.'
    expect(textClauses(t)).toMatchObject({ clause: 'Text erscheint: SIMULATION BEREIT... GESPERRT.', rest: 'Zwei Personen an leuchtenden Tischen.' })
    expect(sentences(t)).toEqual(['Text erscheint: SIMULATION BEREIT... GESPERRT.', 'Zwei Personen an leuchtenden Tischen.'])
    expect(textClauses('Text erscheint: LADEN… Ein Mann tritt ein.')).toMatchObject({ clause: 'Text erscheint: LADEN…', rest: 'Ein Mann tritt ein.' })
    expect(sentences('Er wartet… Die Tür geht auf.')).toEqual(['Er wartet…', 'Die Tür geht auf.'])
  })
  it('PR #41 review: an acronym or number after an ellipsis that opens a sentence with lowercase words is the next sentence', () => {
    expect(textClauses('Words appear: STANDBY... TV static fills the screen.')).toMatchObject({ clause: 'Words appear: STANDBY...', rest: 'TV static fills the screen.' })
    expect(textClauses('Words appear: STANDBY... 3 men enter.')).toMatchObject({ clause: 'Words appear: STANDBY...', rest: '3 men enter.' })
    expect(textClauses('A sign reads OPEN... NASA logo glows.')).toMatchObject({ clause: 'A sign reads OPEN...', rest: 'NASA logo glows.' })
    expect(textClauses('Words appear: COUNTDOWN... 10. A man runs.')).toMatchObject({ clause: 'Words appear: COUNTDOWN... 10.', rest: 'A man runs.' })
  })
  it('PR #41 review: "…" now ends a description sentence, so plotEvents sees the second one', () => {
    expect(plotEvents('He waits… The door opens.', '')).toEqual(['opens'])
    expect(plotEvents('He waits... The door opens.', '')).toEqual(['opens'])
  })
  it('callers (plotEvents, withoutSaidText, newSentences) never see "LOCKED." as description', () => {
    expect(plotEvents(D6, '')).toEqual([])
    expect(withoutSaidText(D6, ['simulation ready... locked'])).toBe('Two people at glowing tech tables.')
    expect(newSentences(D6, 'Words appear: SIMULATION READY... LOCKED.')).toBe('Two people at glowing tech tables.')
  })
})
