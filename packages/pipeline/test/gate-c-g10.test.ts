import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fit, LATE_MS, preservesFacts, safeShorten, shortenDeterministic, type FitCue } from '../src/steps/05-fit'
import { finishScenes, replyGroups, type Scene } from '../src/steps/04c-scenes'
import { applyEdits, droppedFacts, editBudgets, editScene } from '../src/steps/05b-edit'
import { contentWords } from '../src/contentWords'
import { editReadsAsSentences, keepsAction, readsAsSentences } from '../src/sentenceGuard'
import { stripBareLead } from '../src/textClause'
import { placeLabelProblem, withPlace } from '../src/sceneSetting'
import { EMPTY_GLOSSARY, loadGlossary, type Glossary } from '../src/glossary'
import { describeAndVerify, type Converse } from '../src/steps/04-describe'
import { newVerifyReport } from '../src/steps/04b-verify'
import { voice } from '../src/steps/06-voice'
import type { Described } from '../src/steps/04-describe'
import type { Ctx } from '../src/steps/index'

/**
 * Gate C on sintel-90-210-g10 failed (14 / 29, decision 0012 amendment of 2026-10-15). These cases replay the recorded run: the scene
 * step's recorded reply, fit with the recorded Nova Lite shortenings (cues.fit.json: a description → fit's text), the edit pass with the
 * recorded edits (edit.json). The held-out tos-390-510-g10 (no glossary) is the control. No AWS call.
 */
const fixture = <T>(f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')) as T
const GLOSSARY = new URL('../../../docs/eval/gate-c-glossary.json', import.meta.url)

interface Run { shots: Described[]; gaps: { startMs: number; endMs: number }[]; scenes: Scene[]; g: Glossary; oldFit: FitCue[]; finalCues: FitCue[] }
function run(name: string, g: Glossary): Run {
  const shots = fixture<Described[]>(`${name}.described.json`)
  const reply = fixture<{ reply: unknown }>(`${name}.scenes-reply.json`).reply
  return { shots, gaps: fixture(`${name}.gaps.json`), scenes: finishScenes(replyGroups(reply)!, shots, g), g, oldFit: fixture(`${name}.cues.fit.json`), finalCues: fixture(`${name}.cues.json`) }
}
/** Nova Lite's recorded shortenings: the shot description → fit's text in the recorded run (as decision 0011's replay). */
function recordedModel(r: Run) {
  const m = new Map<string, string>()
  for (const c of r.oldFit) { const d = r.shots.find((s) => s.index === c.shotIndex)?.description; if (d && d !== c.text) m.set(d, c.text) }
  return (t: string, n: number) => { const x = m.get(t); return x && x.split(/\s+/).length <= n ? x : t }
}
const fitRun = (r: Run) => fit(r.shots, r.gaps, (t, n) => safeShorten(t, n, recordedModel(r), 'en'), 'en', { scenes: r.scenes, glossary: r.g })
const g10 = () => run('sintel-90-210-g10', loadGlossary('sintel-90-210', GLOSSARY))
const tos = () => run('tos-390-510-g10', EMPTY_GLOSSARY)
const late = (r: Run, c: FitCue) => c.startMs - r.shots.find((s) => s.index === c.shotIndex)!.endMs

describe('5. apostrophes and quotes are normalised before comparing tokens', () => {
  const curly = 'Dim. A fire pit glows at the tent’s centre.', straight = "A fire pit glows at the tent's centre."
  it('contentWords reads tent’s as tent\'s (no stray "s")', () => {
    expect(contentWords('the tent’s centre')).toEqual(contentWords("the tent's centre"))
    expect(contentWords('“Run,” she says')).toEqual(contentWords('"Run," she says'))
  })
  it('g10 cue 2: an edit that only straightens the apostrophe drops no fact', () => {
    expect(droppedFacts(curly, `Dim. ${straight}`, '')).toEqual([])
    expect(preservesFacts(curly, straight)).toBe(true)
    expect(readsAsSentences(curly, straight)).toBeUndefined()
    const cues: FitCue[] = [{ startMs: 11208, endMs: 15033, text: curly, extended: false, wordCount: 9, shotIndex: 2, limitMs: 16720 }]
    const shots = [{ index: 2, startMs: 11208, endMs: 15271, description: curly, sameAsPrev: false, tokens: 0, outputTokens: 0 }]
    const out = applyEdits(cues, shots, [{ cue: 0, text: `Dim. ${straight}` }], editBudgets(cues))
    expect(out.rejected).toEqual([])
  })
})

describe('1. a shortened cue keeps the shot\'s action; a place is never the cue on its own', () => {
  const shot4 = 'In the tent, an old man with a grey beard, a red stripe of face paint across his eyes and a beaded headband, in red-brown robes, holding a staff, grips his staff tightly as a young woman with short red hair, in a grey tank top, watches from the floor.'
  const shot27 = 'a young woman with short red hair, in a grey tank top smiles slightly. A small tan dragon roars.'
  it('sentenceGuard rejects a cue that is only a prepositional or setting phrase', () => {
    expect(readsAsSentences(shot4, 'In the tent.')).toMatch(/prepositional/)
    expect(readsAsSentences(shot4, 'The tent.')).toMatch(/only a place/)
    expect(editReadsAsSentences('Old man pours broth.', 'In the tent.', ['In the tent, old man pours broth.'])).toMatch(/prepositional/)
    // kept: on-screen text, 0011's fail-open noun phrases, and a place said beside an action
    expect(readsAsSentences('Words appear: SINTEL. A figure walks.', 'Words appear: SINTEL.')).toBeUndefined()
    // #56 (DESC-031): the neutral "Words appear." kept whole is still accepted, alone or beside the action; cutting it is still rejected
    expect(readsAsSentences('A man waves slowly. Words appear.', 'A man waves. Words appear.')).toBeUndefined()
    expect(readsAsSentences('Words appear. A man runs.', 'Words appear.')).toBeUndefined()
    expect(keepsAction('Words appear. A man runs.', 'Words appear.')).toBe(true)
    expect(readsAsSentences('A man waves slowly. Words appear.', 'A man waves. Words.')).toBeDefined()
    expect(readsAsSentences('Snowy mountains. A lone figure walks left.', 'Snowy mountains. A figure walks left.')).toBeUndefined()
    expect(readsAsSentences('Two hands hold a red bowl; mist swirls inside.', 'Two hands hold a red bowl.')).toBeUndefined()
    expect(readsAsSentences(shot4, 'In the tent, an old man grips his staff.')).toBeUndefined()
    // a cut that keeps "while" but not its clause's verb (the g10 replay's 25-word cut of shot 5)
    const shot5 = 'An old man with a grey beard, in red-brown robes, stirs a pot over fire while a young woman with short red hair, in a grey tank top, watches.'
    expect(readsAsSentences(shot5, 'An old man with a grey beard, in red-brown robes, stirs a pot over fire while a young woman with short red hair.')).toMatch(/dangling clause/)
    expect(readsAsSentences(shot5, 'An old man with a grey beard, in red-brown robes, stirs a pot over fire.')).toBeUndefined()
  })
  it('fit\'s keepsAction: a shortening keeps a verb of the description', () => {
    expect(keepsAction(shot4, 'In the tent.')).toBe(false)
    expect(keepsAction(shot27, 'A woman with red hair.')).toBe(false)
    expect(keepsAction(shot27, 'A small tan dragon roars.')).toBe(true)
    expect(keepsAction('Snowy mountains under a grey sky.', 'Snowy mountains.')).toBe(true) // no verb found: fails open
    // a plural noun after "preposition + noun" is not a verb (review: "Organ pipes." passed)
    expect(keepsAction('A man in blue and yellow gear swings on rope near organ pipes.', 'Organ pipes.')).toBe(false)
    expect(keepsAction('A man in blue and yellow gear swings on rope near organ pipes.', 'A man swings near organ pipes.')).toBe(true)
    expect(keepsAction('She climbs on stone steps.', 'Stone steps.')).toBe(false)
  })
  it('a bare adjective is never a lead: "Dim." and "Towering." go, "Night." and "Darkness." stay', () => {
    expect(stripBareLead('Dim. A fire pit glows at the tent’s centre.')).toBe('A fire pit glows at the tent’s centre.')
    expect(stripBareLead('Towering. Man in black tactical gear aims rifle.')).toBe('Man in black tactical gear aims rifle.')
    expect(stripBareLead('Night. A rooftop.')).toBe('Night. A rooftop.')
    expect(stripBareLead('Darkness.')).toBe('Darkness.')
    expect(stripBareLead('Dim.')).toBe('Dim.') // the whole description is not a lead
  })
  it('the scene\'s place is merged into the action as one sentence', () => {
    expect(withPlace({ setting: 'the tent', returning: false }, 'A faint fire glows in a stone pit.')).toBe('In the tent, a faint fire glows in a stone pit.')
    expect(withPlace({ setting: 'lab', returning: true }, 'Thom runs.', ['Thom'])).toBe('Back in the lab, Thom runs.')
    expect(withPlace({ setting: 'chamber', returning: false }, 'Man in glasses stares at screens.')).toBe('In the chamber, man in glasses stares at screens.')
    expect(withPlace({ setting: 'the tent', returning: false }, 'Words appear: SINTEL.')).toBeUndefined()
    expect(withPlace({ setting: '', returning: false }, 'A man runs.')).toBeUndefined()
  })
  it('g10 replay: no cue is a place alone or opens with a bare adjective; shot 27 keeps an action', async () => {
    const cues = await fitRun(g10())
    for (const c of cues) {
      expect(c.text).not.toMatch(/^(?:(?:in|inside|back in) )?the (?:tent|town|snowy mountains)\.$/i)
      expect(c.text).not.toMatch(/^(?:Dim|Dark|Towering)\. /)
    }
    expect(cues.filter((c) => c.text === 'In the tent.')).toEqual([])
    const s27 = cues.find((c) => c.shotIndex === 27)
    if (s27) expect(keepsAction(g10().shots[27]!.description, s27.text)).toBe(true)
  })
  it('g10 replay: no scene pause is a place alone, and none sits over a shot whose own event is not voiced', async () => {
    const r = g10(), cues = await fitRun(r)
    for (const c of cues.filter((x) => x.scene)) expect(c.text.split(/\s+/).length, c.text).toBeGreaterThan(4) // a place and an action, not "The tent."
    expect(cues.find((c) => c.scene && c.text === 'The tent.')).toBeUndefined()
  })
  it('tos-390-510-g10: the new sentence checks reject none of its final cues', () => {
    const r = tos()
    const fresh = (orig: string, t: string) => { const why = readsAsSentences(orig, t); return why && /prepositional|only a place|dangling/.test(why) ? why : undefined }
    const newly = r.finalCues.filter((c) => { const d = r.shots.find((s) => s.index === c.shotIndex)!.description; return d !== c.text && fresh(d, c.text) })
    expect(newly.map((c) => c.text)).toEqual([])
  })
})

describe('2. a scene label is a place, never a light or condition word', () => {
  it('tos shot 29: a label rejected only for naming no place stays an action pause ("Man in glasses shouts.")', async () => {
    const x = tos()
    expect(x.scenes.find((sc) => sc.shots.includes(29))).toMatchObject({ setting: '', action: 'Man in glasses shouts' })
    expect((await fitRun(x)).find((c) => c.shotIndex === 29)).toMatchObject({ text: 'Man in glasses shouts.', extended: true })
  })
  it('g10: shot 14\'s "darkness" is no label, and the two adjacent tent scenes are one', () => {
    const r = g10()
    expect(r.scenes.map((s) => s.setting)).not.toContain('darkness')
    expect(r.scenes.find((s) => s.shots.includes(14))!.setting).toBe('')
    const tent = r.scenes.find((s) => s.shots.includes(2))!
    expect(tent.shots).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    expect(r.scenes.map((s) => s.id)).toEqual(r.scenes.map((_, i) => i))
  })
  it('labels: a place noun phrase, no verb, no condition alone', () => {
    expect(placeLabelProblem('darkness')).toBeDefined()
    expect(placeLabelProblem('dim')).toBeDefined()
    expect(placeLabelProblem('night')).toBeDefined()
    expect(placeLabelProblem('towering')).toBeDefined() // "tower" by stem, but not a place
    expect(placeLabelProblem('Boy faces giant robot')).toBeDefined()
    expect(placeLabelProblem('Man with cybernetic eye')).toBeDefined()
    expect(placeLabelProblem('the tent')).toBeUndefined()
    expect(placeLabelProblem('snowy mountains')).toBeUndefined()
    expect(placeLabelProblem('Dim, smoky chamber')).toBeUndefined()
  })
  it('tos: every label left is a place', () => {
    for (const s of tos().scenes) if (s.setting) expect(placeLabelProblem(s.setting)).toBeUndefined()
  })
  it('describe: a "Darkness." reply over frames that are not all dark is asked again with the visible frames only', async () => {
    const work = await mkdtemp(join(tmpdir(), 'dark-'))
    vi.stubEnv('DESCRIBE_VERIFY', '0')
    try {
      const frames = [0, 0, 106, 151].map((v) => new Uint8Array([v]))
      const asked: number[][] = []
      const send: Converse = async (input) => {
        const imgs = (input.messages![0]!.content ?? []).filter((c) => 'image' in c && c.image).map((c) => [...(c as { image: { source: { bytes: Uint8Array } } }).image.source.bytes][0]!)
        asked.push(imgs)
        const text = imgs.includes(0) ? 'Darkness.' : 'A walled town under a hazy sky.'
        return { output: { message: { role: 'assistant', content: [{ text }] } }, usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end_turn' } as never
      }
      const report = newVerifyReport('m')
      const luma = async (f: Uint8Array) => f[0]!
      const r = await describeAndVerify(work, 'm', 'sys', frames, send, undefined, report, { index: 14, language: 'en', maxWords: 10, names: [] }, { luma })
      expect(r.text).toBe('A walled town under a hazy sky.')
      expect(asked).toEqual([[0, 0, 106, 151], [106, 151]])
      const allDark = await describeAndVerify(work, 'm', 'sys2', [new Uint8Array([0]), new Uint8Array([3])], send, undefined, report, { index: 1, language: 'en', maxWords: 10, names: [] }, { luma })
      expect(allDark.text).toBe('Darkness.')
    } finally { vi.unstubAllEnvs(); await rm(work, { recursive: true, force: true }) }
  })
})

/**
 * fit's cues voiced with the recorded clip lengths (the run's cue_N.json sidecars: text → duration, speech); a text the run did not voice
 * gets 300 ms a word + 300 ms. Polly is faked (the clip's bytes are its text). No AWS call.
 */
async function voiceRun(name: string, x: Run, cues: FitCue[]): Promise<FitCue[]> {
  const clips = new Map(fixture<{ text: string; durationMs: number; speechMs?: number }[]>(`${name}.clips.json`).map((c) => [c.text, c]))
  const est = (t: string) => t.split(/\s+/).length * 300 + 300
  const work = await mkdtemp(join(tmpdir(), 'replay-'))
  try {
    await writeFile(`${work}/shots.json`, JSON.stringify(x.shots.map((s) => ({ index: s.index, startMs: s.startMs, endMs: s.endMs }))))
    await writeFile(`${work}/cues.json`, JSON.stringify(cues))
    const text = (f: string) => readFile(f, 'utf8')
    await voice({ slug: name, source: 's.mp4', language: 'en', voice: 'Joanna', work }, {
      synthesize: async (t) => new TextEncoder().encode(t),
      measureMs: async (f) => { const t = await text(f); return clips.get(t)?.durationMs ?? est(t) },
      measureSpeechMs: async (f) => { const t = await text(f); return clips.get(t)?.speechMs ?? est(t) - 120 },
    })
    return JSON.parse(await readFile(`${work}/cues.json`, 'utf8')) as FitCue[]
  } finally { await rm(work, { recursive: true, force: true }) }
}

describe('3. no cue starts more than LATE_MS after its shot; placed cues never overlap', () => {
  it('the recorded runs had the late cues (g10 shots 19 and 24, tos shot 13)', () => {
    const lateOnes = (x: Run) => x.oldFit.filter((c) => late(x, c) > LATE_MS).map((c) => c.shotIndex)
    expect(lateOnes(g10())).toEqual([19, 24])
    expect(lateOnes(tos())).toEqual([13])
  })
  for (const [name, r, recovered] of [['sintel-90-210-g10', g10, [19, 24]], ['tos-390-510-g10', tos, [13]]] as const) {
    it(`${name}: fit → voice with the recorded clips recovers shots ${recovered.join(', ')} on time; nothing late, no placed overlap`, async () => {
      const x = r(), out = await voiceRun(name, x, await fitRun(x))
      for (const c of out) expect(late(x, c), `${c.shotIndex}: ${c.text}`).toBeLessThanOrEqual(LATE_MS)
      for (const k of recovered) expect(out.find((c) => c.shotIndex === k), `shot ${k}`).toBeDefined()
      const placed = out.filter((c) => !c.extended).sort((a, b) => a.startMs - b.startMs)
      for (let i = 1; i < placed.length; i++) expect(placed[i]!.startMs).toBeGreaterThanOrEqual(placed[i - 1]!.endMs)
    })
  }
  it('g10 shot 24 keeps its plot event (decision 0007)', async () => {
    const x = g10(), out = await voiceRun('sintel-90-210-g10', x, await fitRun(x))
    expect(out.find((c) => c.shotIndex === 24)).toMatchObject({ extended: true, event: true })
  })
  const shots2 = [{ index: 0, startMs: 0, endMs: 3000 }, { index: 1, startMs: 3000, endMs: 4000 }]
  const runVoice = async (cues: FitCue[], ms: (t: string) => number) => {
    const work = await mkdtemp(join(tmpdir(), 'late-'))
    try {
      await writeFile(`${work}/shots.json`, JSON.stringify(shots2))
      await writeFile(`${work}/cues.json`, JSON.stringify(cues))
      await voice({ slug: 't', source: 's.mp4', language: 'en', voice: 'Joanna', work }, { synthesize: async (t) => new TextEncoder().encode(t), measureMs: async (f) => ms(await readFile(f, 'utf8')), measureSpeechMs: async (f) => ms(await readFile(f, 'utf8')) - 100 })
      return JSON.parse(await readFile(`${work}/cues.json`, 'utf8')) as FitCue[]
    } finally { await rm(work, { recursive: true, force: true }) }
  }
  const placed0 = (text: string, endMs = 4000): FitCue => ({ startMs: 1000, endMs, text, extended: false, wordCount: text.split(/\s+/).length, shotIndex: 0, limitMs: 9000 })
  const pause1 = (text: string, extra: Partial<FitCue> = {}): FitCue => ({ startMs: 3000, endMs: 3100, text, extended: true, wordCount: text.split(/\s+/).length, shotIndex: 1, ...extra })
  it('voice: a pause fit put late moves EARLIER to the measured end of the clip before it', async () => {
    const out = await runVoice([placed0('A woman runs.'), { ...pause1('A man kneels.', { event: true }), startMs: 5500, endMs: 5600 }], (t) => (t === 'A woman runs.' ? 2500 : 1500))
    expect(out.map((c) => [c.text, c.startMs])).toEqual([['A woman runs.', 1000], ['A man kneels.', 3500]])
  })
  it('voice: an event pause still late shortens the placed cue that blocks it, and is dropped only when that does not help', async () => {
    const long = 'A tall woman slowly crosses the old bridge, holding a lantern.'
    const ms = (t: string) => (t === long ? 4500 : t.split(/\s+/).length * 400)
    const out = await runVoice([placed0(long), pause1('A man kneels.', { event: true })], ms)
    expect(out.map((c) => [c.text, c.extended])).toEqual([['A woman crosses the bridge, holding a lantern.', false], ['A man kneels.', true]])
    expect(out[1]!.startMs).toBeLessThanOrEqual(4000 + LATE_MS)
    // a 3-word placed cue cannot be shortened: the event pause is dropped (the old behaviour, last resort)
    expect((await runVoice([placed0('A woman runs.'), pause1('A man kneels.', { event: true })], (t) => (t === 'A woman runs.' ? 4200 : 1500))).map((c) => c.text)).toEqual(['A woman runs.'])
  })
  it('voice: a text-only pause is never dropped, late or not (DESC-017)', async () => {
    const out = await runVoice([placed0('A woman runs.'), pause1('Words appear: NORTH.')], (t) => (t === 'A woman runs.' ? 4200 : 1500))
    expect(out.map((c) => c.text)).toEqual(['A woman runs.', 'Words appear: NORTH.'])
  })
  it('voice: the on-time rule runs when nothing moved (no early return)', async () => {
    // the pause starts 1500 ms after shot 1 ends, and no clip blocks it: nothing moves, and it is still late (not an event: dropped)
    const out = await runVoice([{ ...placed0('A woman runs.'), startMs: 0 }, { ...pause1('A man waits by the door.'), startMs: 5500, endMs: 5600 }, { ...placed0('Snow falls.'), startMs: 5500 }], (t) => t.split(/\s+/).length * 400)
    expect(out.map((c) => c.text)).toEqual(['A woman runs.', 'Snow falls.'])
  })
})

describe('4. a setting word is grounded in its own shot or its own scene, never carried from another', () => {
  it('g10 shot 28 (town scene): "inside the tent" is not said', async () => {
    const cues = await fitRun(g10())
    for (const c of cues.filter((x) => x.shotIndex >= 15)) expect(c.text).not.toMatch(/\btent\b/i)
  })
  it('the edit pass sees the same grounded descriptions', async () => {
    const r = g10()
    const cues: FitCue[] = [{ startMs: 106000, endMs: 108000, text: 'A young woman holds a small tan creature.', extended: false, wordCount: 8, shotIndex: 28, limitMs: 119000 }]
    const send = async () => ({ output: { message: { role: 'assistant', content: [{ text: '{"edits":[{"cue":0,"text":"A young woman holds a small tan creature inside the tent."}]}' }] } }, usage: { inputTokens: 0, outputTokens: 0 } }) as never
    const rep = await editScene(cues, r.shots, [], 'en', send as never, undefined, (t) => t, { scenes: r.scenes, glossary: r.g })
    expect(rep.cues[0]!.text).not.toMatch(/tent/)
    expect(rep.rejected).toEqual([expect.objectContaining({ reason: "another scene's place: tent" })])
  })
})

describe('g10 replay through the edit pass (recorded edits)', () => {
  it('cue 2\'s apostrophe edit is not rejected for "drops a fact: s"', async () => {
    const r = g10(), cues = await fitRun(r)
    const edit = fixture<{ applied: { from: string; to: string; by?: string }[]; rejected: { i: number; text: string; reason: string }[] }>('sintel-90-210-g10.edit.json')
    const edits = new Map<string, string>()
    for (const a of edit.applied) if (!a.by) edits.set(a.from, a.to)
    for (const x of edit.rejected) if (!/after shortening/.test(x.reason) && r.oldFit[x.i]) edits.set(r.oldFit[x.i]!.text.replace(/^Dim\. /, ''), x.text.replace(/^Dim\. /, ''))
    const send = async (input: Parameters<Converse>[0]) => {
      const body = JSON.parse(String((input.messages![0]!.content![0] as { text: string }).text).replace(/^Input:\n/, '').replace(/\n\n(?:Use|Reply)[\s\S]*$/, '')) as { cues: { cue: number; text: string }[] }
      const out = body.cues.filter((c) => edits.has(c.text)).map((c) => ({ cue: c.cue, text: edits.get(c.text) }))
      return { output: { message: { role: 'assistant', content: [{ text: JSON.stringify({ edits: out }) }] } }, usage: { inputTokens: 0, outputTokens: 0 } } as never
    }
    const rep = await editScene(cues, r.shots, fixture('sintel-90-210-g10.words.json'), 'en', send as never, undefined, (t) => t, { scenes: r.scenes, glossary: r.g })
    expect(rep.rejected.filter((x) => /drops a fact: s\b/.test(x.reason))).toEqual([])
  })
})

void shortenDeterministic
