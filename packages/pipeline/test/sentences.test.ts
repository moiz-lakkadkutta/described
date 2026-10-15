import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeSystemPrompt } from '../src/prompts'
import { DESCRIBE_CACHE_VERSION } from '../src/steps/04-describe'
import { checkVerified } from '../src/steps/04b-verify'
import { verifySystemPrompt, VERIFY_PROMPT_VERSION } from '../src/verifyPrompt'
import { polishCue } from '../src/polishCue'
import { cueSidecarFile, cueSsml, voice, type CueSidecar, type VoiceDeps } from '../src/steps/06-voice'
import { sdh } from '../src/steps/08-text'
import type { FitCue } from '../src/steps/05-fit'

/**
 * DESC-033 (docs/decisions/0015-complete-sentences.md): Gate C g11 (sintel-90-210 19/29, tos-390-510 20/30, bar 21) failed mostly on
 * text quality. The fixtures are the cue texts the raters marked down, as the pipeline wrote them.
 */
const G11 = {
  staff: 'Man holds staff.',
  dragon: 'Small tan dragon bleeds on rooftop.',
  lower: 'a young woman with short red hair, in a grey tank top, in brown trousers climbs rooftop',
  face: "A man's face pressed against a mechanical device.",
  tower: 'Ornate clock tower with golden dials, debris flying.',
  chamber: 'Dim, smoky chamber with glowing lines.',
  culp: 'Words appear: "CULP, I LOVE YOUR HAND"',
}
const opts = { maxWords: 25, names: [] as string[] }

describe('describe prompt: complete sentences (DESC-033)', () => {
  const p = describeSystemPrompt({ maxWords: 12, knownNames: [], language: 'en' })
  const rule = p.split('\n').find((l) => l.includes('complete'))!
  it('asks for complete present-tense sentences with articles and a verb, a capital letter and a full stop', () => {
    expect(rule).toBeDefined()
    for (const s of ['complete', 'present-tense', 'sentence', 'verb', 'articles', '"a"', '"the"', 'capital letter', 'full stop']) expect(rule, s).toContain(s)
  })
  it('gives no example sentence to copy: every quoted piece is a single word', () => {
    for (const q of [...rule.matchAll(/"([^"]*)"/g)].map((m) => m[1]!)) expect(q, q).toMatch(/^\p{L}+$/u)
  })
  it('bumps the describe cache version', () => {
    expect(DESCRIBE_CACHE_VERSION).toBe(3)
  })
})

describe('verify prompt: grammar words and doubtful text (DESC-033)', () => {
  const en = verifySystemPrompt('en', 12), de = verifySystemPrompt('de', 12)
  it('asks for complete sentences with articles and a verb, adding only a, an, the, is, are', () => {
    expect(en).toContain('Write complete sentences with articles and a verb')
    expect(en).toContain('you may add only a, an, the, is, are')
    expect(de).toContain('you may add only der, die, das, den, dem, des, ein, eine, einen, einem, einer, eines, ist, sind')
    expect(en).not.toMatch(/\bhas\b|\bhave\b/)
  })
  it('any doubt about a letter, or a partly hidden word, means the neutral sentence', () => {
    expect(en).toContain('If there is any doubt about any letter, or any word is even partly hidden, replace the whole clause with exactly "Words appear."')
    expect(de).toContain('replace the whole clause with exactly "Text erscheint."')
  })
  it('bumps the verify prompt version', () => {
    expect(VERIFY_PROMPT_VERSION).toBe(5)
  })
})

describe('verify guard: a reply that only adds a, an, the, is, are is accepted (DESC-033)', () => {
  const ok = (draft: string, reply: string, maxWords = 25, language: 'en' | 'de' = 'en') => {
    const r = checkVerified(draft, { text: reply, removed: [] }, { ...opts, maxWords, language })
    expect(r, `${draft} → ${reply}: ${r.reason}`).toMatchObject({ applied: true, text: reply })
  }
  const kept = (draft: string, reply: string, reason: string | RegExp, maxWords = 25, language: 'en' | 'de' = 'en') => {
    const r = checkVerified(draft, { text: reply, removed: [] }, { ...opts, maxWords, language })
    expect(r.applied, `${draft} → ${reply}`).toBe(false)
    expect(r.reason).toMatch(reason)
  }
  it('accepts the g11 fixtures with their articles and is/are added', () => {
    ok(G11.staff, 'A man holds a staff.')
    ok(G11.dragon, 'A small tan dragon bleeds on a rooftop.')
    ok(G11.lower, 'A young woman with short red hair, in a grey tank top, in brown trousers climbs a rooftop.')
    ok(G11.face, "A man's face is pressed against a mechanical device.")
    ok(G11.chamber, 'There is a dim, smoky chamber with glowing lines.')
    ok('Boy faces giant robot.', 'A boy faces a giant robot.')
  })
  it('accepts grammar words over the word cap when the draft is at its budget', () => {
    ok(G11.staff, 'A man holds a staff.', 3)
    ok('Soldier aims rifle at robot.', 'A soldier aims a rifle at the robot.', 5)
  })
  // PR #61 review (HIGH): an added is / are must not fill a deleted verb or preposition — "Man holds staff." → "Man is staff." is a false claim
  it('rejects an added is / are that stands where a draft word was deleted, or ends a sentence', () => {
    const filled = /"(?:is|are|ist|sind)" added in place of a deleted word/
    kept(G11.staff, 'Man is staff.', filled)
    kept(G11.staff, 'A man is a staff.', filled)
    kept('A dragon bleeds on rooftop.', 'A dragon is rooftop.', filled)
    kept('The man watches the guard.', 'The man is the guard.', filled)
    kept('Woman runs.', 'A woman is.', filled)
    kept('Man holds staff near door.', 'Man is staff. Is door.', filled)
    kept('Mann hält Stab.', 'Ein Mann ist Stab.', filled, 25, 'de')
    kept('Zwei Männer halten Stäbe.', 'Zwei Männer sind Stäbe.', filled, 25, 'de')
    // still fine: the copula sits where nothing was deleted, or before an added "visible" (its own guard)
    ok(G11.face, "A man's face is pressed against a mechanical device.")
    ok(G11.chamber, 'There is a dim, smoky chamber with glowing lines.')
    ok('Mann hält Stab.', 'Ein Mann hält einen Stab.', 25, 'de')
    ok('A girl searches for her dragon.', 'A girl is visible.')
    // a place word after the copula states where, as the draft did (decision 0010's approved deletions, verify.test g9 cases)
    ok('A dragon bleeds on rooftop.', 'A dragon is on a rooftop.')
    ok('Red-haired girl reads book.', 'A red-haired girl is with a creature.')
  })
  it('keeps every other guard', () => {
    kept(G11.staff, 'A man has a staff.', /new words: has/)
    kept(G11.staff, 'A man holds a golden staff.', /new words: golden/)
    kept(G11.staff, 'A staff holds a man.', /out of order/)
    kept('Man almost falls.', 'A man falls.', /protected word dropped: almost/)
    kept('Man does not fall.', 'A man does fall.', /negation dropped: not/)
    kept(G11.staff, 'There is a man who holds a staff.', /new words: who/)
    // over the cap, only a/an/the/is/are may be the extra words: "there" is linking but not grammar
    kept(G11.staff, 'There a man holds a staff.', /more than 3 words/, 3)
    // and never more than MAX_ADDED_WORDS over the draft
    kept(G11.staff, 'A man is the one who holds a staff.', /new words/, 3)
    kept('Man holds staff near fire.', 'A man is holding a staff near the fire, a fire.', /new words|out of order|more than/, 5)
  })
})

describe('polishCue (DESC-033)', () => {
  it('capitalises and ends the lowercase g11 cue', () => {
    expect(polishCue(G11.lower, 'en')).toBe('A young woman with short red hair, in a grey tank top, in brown trousers climbs rooftop.')
  })
  it('capitalises each sentence, collapses spaces, keeps . ! ?', () => {
    expect(polishCue('  night.  a man  waits ,   then runs ', 'en')).toBe('Night. A man waits, then runs.')
    expect(polishCue('A man shouts! the door opens? yes.', 'en')).toBe('A man shouts! The door opens? Yes.')
    expect(polishCue('Old man holds staff; young woman watches', 'en')).toBe('Old man holds staff; young woman watches.')
    expect(polishCue('A man waits,', 'en')).toBe('A man waits.')
    expect(polishCue('A man waits…', 'en')).toBe('A man waits.')
    expect(polishCue('Words appear.', 'en')).toBe('Words appear.')
    expect(polishCue('', 'en')).toBe('')
    expect(polishCue('   ', 'en')).toBe('')
  })
  it('no capital after "e.g." or a mid-sentence ellipsis; no full stop inside an unclosed quote', () => {
    expect(polishCue('He points at tools, e.g. a hammer', 'en')).toBe('He points at tools, e.g. a hammer.')
    expect(polishCue('She waits... then runs', 'en')).toBe('She waits... then runs.')
    expect(polishCue('She waits… then runs', 'en')).toBe('She waits… then runs.')
    expect(polishCue('Words appear: "HELLO WOR', 'en')).toBe('Words appear: "HELLO WOR')
    expect(polishCue('Text erscheint: „ENDE', 'de')).toBe('Text erscheint: „ENDE')
  })
  it('is idempotent', () => {
    for (const t of Object.values(G11)) expect(polishCue(polishCue(t, 'en'), 'en')).toBe(polishCue(t, 'en'))
  })
  it('leaves on-screen text quotes untouched, adding the full stop after the closing quote', () => {
    expect(polishCue(G11.culp, 'en')).toBe('Words appear: "CULP, I LOVE YOUR HAND".')
    expect(polishCue('Words appear: "the  end"', 'en')).toBe('Words appear: "the  end".')
    expect(polishCue('Words appear: "STOP!"', 'en')).toBe('Words appear: "STOP!"')
    expect(polishCue('Words appear: "LOADING…"', 'en')).toBe('Words appear: "LOADING…"')
    expect(polishCue('a man reads a note: "meet me. at noon"', 'en')).toBe('A man reads a note: "meet me. at noon".')
    expect(polishCue('Words appear: "SINTEL". a figure walks', 'en')).toBe('Words appear: "SINTEL". A figure walks.')
    expect(polishCue('a sign reads OPEN', 'en')).toBe('A sign reads OPEN.')
    expect(polishCue('Words appear: "ok,"', 'en')).toBe('Words appear: "ok,".')
  })
  it('German: sentence starts in German case, German quotes untouched', () => {
    expect(polishCue('ein Mann hebt das Schwert. über der Stadt kreist ein Drache', 'de')).toBe('Ein Mann hebt das Schwert. Über der Stadt kreist ein Drache.')
    expect(polishCue('Text erscheint: „das ende“', 'de')).toBe('Text erscheint: „das ende“.')
    expect(polishCue('Text erscheint.', 'de')).toBe('Text erscheint.')
  })
})

describe('polishCue is applied where cues are heard and shown (DESC-033)', () => {
  let work: string
  beforeEach(async () => { work = await mkdtemp(join(tmpdir(), 'polish-')) })
  afterEach(async () => { await rm(work, { recursive: true, force: true }) })
  const cue = (startMs: number, text: string): FitCue => ({ startMs, endMs: startMs + 1000, text, extended: false, wordCount: text.split(/\s+/).length, shotIndex: 0 })
  const ctx = () => ({ slug: 't', source: 's', language: 'en' as const, voice: 'Joanna', work })

  it('06-voice: Polly gets the polished text', async () => {
    await writeFile(`${work}/cues.json`, JSON.stringify([cue(1000, G11.lower)]))
    const synthesize = vi.fn(async (text: string) => new TextEncoder().encode(text))
    const deps: VoiceDeps = { synthesize, measureMs: async () => 2000 }
    await voice(ctx(), deps)
    expect(synthesize).toHaveBeenCalledWith(polishCue(G11.lower, 'en'), 'Joanna', 'en')
  })
  it('06-voice: a clip voiced before polishCue (its key the unpolished text) is voiced again', async () => {
    await writeFile(`${work}/cues.json`, JSON.stringify([cue(1000, G11.lower)]))
    await writeFile(`${work}/cue_0.mp3`, G11.lower)
    await writeFile(`${work}/${cueSidecarFile(0)}`, JSON.stringify({ text: G11.lower, voice: 'Joanna', language: 'en', ssml: cueSsml(G11.lower), durationMs: 2000 } satisfies CueSidecar))
    const synthesize = vi.fn(async (text: string) => new TextEncoder().encode(text))
    await voice(ctx(), { synthesize, measureMs: async () => 2000 })
    expect(synthesize).toHaveBeenCalledTimes(1)
    expect(JSON.parse(await readFile(`${work}/${cueSidecarFile(0)}`, 'utf8'))).toMatchObject({ text: G11.lower, ssml: cueSsml(polishCue(G11.lower, 'en')) })
    // and the next run reuses it
    const again = vi.fn(async (text: string) => new TextEncoder().encode(text))
    await writeFile(`${work}/cues.json`, JSON.stringify([cue(1000, G11.lower)]))
    await voice(ctx(), { synthesize: again, measureMs: async () => 2000 })
    expect(again).not.toHaveBeenCalled()
  })
  it('08-text: descriptions.vtt carries the polished text', async () => {
    await writeFile(`${work}/words.json`, JSON.stringify([]))
    await writeFile(`${work}/cues.json`, JSON.stringify([cue(1000, G11.lower), cue(4000, G11.culp)]))
    await sdh(ctx(), async () => { throw new Error('no call expected') })
    const vtt = await readFile(`${work}/descriptions.vtt`, 'utf8')
    expect(vtt).toContain(polishCue(G11.lower, 'en'))
    expect(vtt).toContain('Words appear: "CULP, I LOVE YOUR HAND".')
  })
})
