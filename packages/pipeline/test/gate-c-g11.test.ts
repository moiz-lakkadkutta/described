import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fit, safeShorten, shortenDeterministic, shortenKeepingAction, type FitCue } from '../src/steps/05-fit'
import { finishScenes, replyGroups, type Scene } from '../src/steps/04c-scenes'
import { editReadsAsSentences, readsAsSentences } from '../src/sentenceGuard'
import { placeLead, withoutTrailingPlace, withPlace } from '../src/sceneSetting'
import { EMPTY_GLOSSARY, loadGlossary, type Glossary } from '../src/glossary'
import { voice } from '../src/steps/06-voice'
import type { Described } from '../src/steps/04-describe'

/**
 * Gate C round 3 (sintel-90-210-g11 19 / 29, tos-390-510-g11 20 / 30; decision 0012 amendment "Review round 3, g11"). The recorded runs
 * replayed offline: the scene step's recorded reply, fit with the recorded Nova Lite shortenings, 06-voice with the recorded clip lengths.
 * No AWS call.
 */
const fixture = <T>(f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')) as T
const GLOSSARY = new URL('../../../docs/eval/gate-c-glossary.json', import.meta.url)

interface Run { name: string; shots: Described[]; gaps: { startMs: number; endMs: number }[]; scenes: Scene[]; g: Glossary; oldFit: FitCue[] }
function run(name: string, g: Glossary): Run {
  const shots = fixture<Described[]>(`${name}.described.json`)
  const reply = fixture<{ reply: unknown }>(`${name}.scenes-reply.json`).reply
  return { name, shots, gaps: fixture(`${name}.gaps.json`), scenes: finishScenes(replyGroups(reply)!, shots, g), g, oldFit: fixture(`${name}.cues.fit.json`) }
}
/** Nova Lite's recorded shortenings (cues.fit.json: a description → fit's text), plus the replies the run log recorded as rejected. */
function recordedModel(r: Run, extra: Record<string, string> = {}) {
  const m = new Map<string, string>(Object.entries(extra))
  for (const c of r.oldFit) { const d = r.shots.find((s) => s.index === c.shotIndex)?.description; if (d && d !== c.text && !m.has(d)) m.set(d, c.text) }
  return (t: string, n: number) => { const x = m.get(t); return x && x.split(/\s+/).length <= n ? x : t }
}
/** gate-c-g11.log, fit: the model's replies that the guard rejected. */
const SINTEL_REPLIES = { 'Old man speaks, dim tent.': 'Man speaks. Tent dims.' }
const fitRun = (r: Run, extra: Record<string, string> = {}) => fit(r.shots, r.gaps, (t, n) => safeShorten(t, n, recordedModel(r, extra), 'en'), 'en', { scenes: r.scenes, glossary: r.g })
const sintel = () => run('sintel-90-210-g11', loadGlossary('sintel-90-210', GLOSSARY))
const tos = () => run('tos-390-510-g11', EMPTY_GLOSSARY)

/**
 * fit's cues voiced with the recorded clip lengths (cue_N.json sidecars); `more` adds clips the run voiced and then replaced (no sidecar
 * left): tos shot 22's full line — its 4-word remnant measured 2616 ms, so the 10-word line is taken as 5100 ms (speech 4950), past its
 * 4200 ms slot as in the run. Other texts: 282 ms a word + 781 ms (decision 0012's replay line). Polly faked.
 */
async function voiceRun(r: Run, cues: FitCue[], more: Record<string, [number, number]> = {}): Promise<FitCue[]> {
  const clips = new Map(fixture<{ text: string; durationMs: number; speechMs?: number }[]>(`${r.name}.clips.json`).map((c) => [c.text, c]))
  for (const [t, [d, s]] of Object.entries(more)) clips.set(t, { text: t, durationMs: d, speechMs: s })
  const est = (t: string) => t.split(/\s+/).length * 282 + 781
  const work = await mkdtemp(join(tmpdir(), 'g11-'))
  try {
    await writeFile(`${work}/shots.json`, JSON.stringify(r.shots.map((s) => ({ index: s.index, startMs: s.startMs, endMs: s.endMs }))))
    await writeFile(`${work}/cues.json`, JSON.stringify(cues))
    const text = (f: string) => readFile(f, 'utf8')
    await voice({ slug: r.name, source: 's.mp4', language: 'en', voice: 'Joanna', work }, {
      synthesize: async (t) => new TextEncoder().encode(t),
      measureMs: async (f) => { const t = await text(f); return clips.get(t)?.durationMs ?? est(t) },
      measureSpeechMs: async (f) => { const t = await text(f); return clips.get(t)?.speechMs ?? est(t) - 120 },
    })
    return JSON.parse(await readFile(`${work}/cues.json`, 'utf8')) as FitCue[]
  } finally { await rm(work, { recursive: true, force: true }) }
}
const SHOT22 = 'Dark, rope-laced industrial shaft; man in black jacket adjusts device.'
const TOS_CLIPS: Record<string, [number, number]> = { [SHOT22]: [5100, 4950] }

describe('A. a place lead is lower-cased, takes its article, and is never added to a sentence that says the place (tos 29)', () => {
  const lab = { setting: 'Cluttered tech lab', returning: false }
  const shot29 = 'Man with glasses shouts, then looks up, surrounded by glowing green and purple displays in a cluttered tech lab.'
  it('the lead: lower-case label, "a" / "an" for a described place the first time, "the" for a bare noun, a glossary place or a return', () => {
    expect(placeLead(lab)).toBe('In a cluttered tech lab')
    expect(placeLead({ ...lab, returning: true })).toBe('Back in the cluttered tech lab')
    expect(placeLead({ setting: 'Sunlit, overgrown industrial hall', returning: false })).toBe('In a sunlit, overgrown industrial hall')
    expect(placeLead({ setting: 'Old mill', returning: false })).toBe('In an old mill')
    expect(placeLead({ setting: 'Stone balcony', returning: false })).toBe('On a stone balcony')
    expect(placeLead({ setting: 'Cathedral ruins', returning: false })).toBe('In cathedral ruins')
    expect(placeLead({ setting: 'chamber', returning: false })).toBe('In the chamber')
    expect(placeLead({ setting: 'the tent', returning: false })).toBe('In the tent')
    expect(placeLead({ setting: 'The town', returning: true })).toBe('Back in the town')
    expect(placeLead({ setting: 'snowy mountains', settingName: 'the snowy mountains', returning: false })).toBe('In the snowy mountains')
    expect(placeLead({ setting: '', returning: false })).toBeUndefined()
  })
  it('review: possessives, proper nouns, a / an by sound, "of" phrases, a label that is already a phrase', () => {
    const lead = (setting: string, texts: string[] = [], extra: { returning?: boolean; settingName?: string } = {}, names: string[] = []) => placeLead({ setting, returning: false, ...extra }, names, texts)
    // possessives: none after a proper noun, "the" otherwise
    expect(lead('Sintel\'s village', ['Sintel\'s village lies in snow.'], {}, ['Sintel'])).toBe('In Sintel\'s village')
    expect(lead('Sintel\'s village', ['A hut in Sintel\'s village.'])).toBe('In Sintel\'s village')
    expect(lead('Dragon\'s lair', ['A dragon\'s lair glows.'])).toBe('In the dragon\'s lair')
    // proper nouns keep their capitals; the first word is lower-cased only when the scene's descriptions write it so
    expect(lead('Amsterdam bridge', ['A man runs across an Amsterdam bridge.'])).toBe('On an Amsterdam bridge')
    expect(lead('Oude Kerk', ['Bells ring above the Oude Kerk.'])).toBe('In the Oude Kerk')
    expect(lead('Paris', ['Rain falls on Paris.'])).toBe('In Paris')
    expect(lead('Cluttered tech lab', ['A man shouts in a cluttered tech lab.'])).toBe('In a cluttered tech lab')
    // final check: a capital at a sentence start, or a word the descriptions do not have, is no name
    expect(lead('Cluttered tech lab', ['Cluttered tech lab. A man shouts.'])).toBe('In a cluttered tech lab')
    expect(lead('Cluttered tech lab', ['A man shouts.'])).toBe('In a cluttered tech lab')
    expect(lead('Snowy mountains', ['Snowy mountains. A figure walks.'])).toBe('In snowy mountains')
    expect(lead('Old church', ['Old church. A bell rings.'])).toBe('In an old church')
    expect(lead('Old church', ['A bell rings in the old church.'])).toBe('In an old church')
    expect(lead('Oude Kerk', ['Oude Kerk. Bells ring above the Oude Kerk.'])).toBe('In the Oude Kerk')
    // a / an by sound
    expect(lead('hour glass room', ['an hour glass room'])).toBe('In an hour glass room')
    expect(lead('European city street', ['a European city street'])).toBe('In a European city street')
    expect(lead('one-way street', ['a one-way street'])).toBe('In a one-way street')
    expect(lead('MRI room', ['an MRI room'])).toBe('In an MRI room')
    expect(lead('unicorn stable', ['a unicorn stable'])).toBe('In a unicorn stable')
    expect(lead('underground hall', ['an underground hall'])).toBe('In an underground hall')
    // the head before "of" picks the preposition and the article
    expect(lead('rooftop of the town', ['the rooftop of the town'])).toBe('On the rooftop of the town')
    expect(lead('top of the bridge', ['on top of the bridge'])).toBe('On top of the bridge')
    expect(lead('ruins of a cathedral', ['the ruins of a cathedral'])).toBe('In the ruins of a cathedral')
    // a label that is already a place phrase is the lead itself, never "In inside the tent"
    expect(lead('inside the tent', ['A fire burns inside the tent.'])).toBe('Inside the tent')
    expect(lead('Inside the tent', [], { returning: true })).toBe('Back inside the tent')
    expect(lead('On the bridge', ['on the bridge'])).toBe('On the bridge')
    expect(withPlace({ setting: 'inside the tent', returning: false }, 'An old man stirs a pot.', [], ['inside the tent'])).toBe('Inside the tent, an old man stirs a pot.')
  })
  it('withPlace merges the lead into the action, or leaves an action that already says the place as it is', () => {
    expect(withPlace(lab, 'Man with glasses shouts.')).toBe('In a cluttered tech lab, man with glasses shouts.')
    expect(withPlace(lab, shot29)).toBe(shot29)
    expect(withPlace({ setting: 'the tent', returning: false }, 'An old man sits inside the tent.')).toBe('An old man sits inside the tent.')
  })
  it('tos-390-510-g11 replay: shot 29\'s scene pause is its own description, the place said once, no "Cluttered"', async () => {
    const cues = await fitRun(tos())
    const s29 = cues.filter((c) => c.shotIndex === 29)
    expect(s29.map((c) => c.text)).toEqual([shot29])
    for (const c of cues) {
      expect(c.text).not.toMatch(/\b(?:In|On|in|on) the \p{Lu}/u)
      expect((c.text.match(/\blab\b/g) ?? []).length).toBeLessThanOrEqual(1)
    }
  })
})

describe('B. 06-voice\'s overrun shortening keeps the action (tos 22)', () => {
  it('sentenceGuard: a verbless line cut from a sentence with a verb is not a shortening (item E)', () => {
    expect(readsAsSentences(SHOT22, 'Dark, rope-laced industrial shaft.')).toMatch(/verbless/)
    expect(readsAsSentences('Old man holds staff; young woman watches.', 'Old man; young woman.')).toBeDefined()
    // a sentence the describer wrote without a verb stays acceptable, alone or beside the action
    expect(readsAsSentences('Snowy mountains. A lone figure walks left.', 'Snowy mountains. A figure walks left.')).toBeUndefined()
    expect(readsAsSentences('Snowy mountains under a grey sky. A lone figure walks left.', 'Snowy mountains.')).toBeUndefined()
    expect(readsAsSentences('Dense city under hazy sky, central pyramid structure.', 'Dense city under hazy sky.')).toBeUndefined()
  })
  it('shortenKeepingAction: the shortening when it keeps a verb, else the first action sentence or clause, else the text unchanged', () => {
    expect(shortenKeepingAction(SHOT22, 7)).toBe('Man in black jacket adjusts device.')
    expect(shortenKeepingAction(SHOT22, 4)).toBe(SHOT22) // nothing with the action fits: the caller makes it a pause or drops it
    expect(shortenKeepingAction('A tall woman slowly crosses the old bridge, holding a lantern.', 7)).toBe('A woman crosses the bridge.')
    expect(shortenKeepingAction('Short line.', 5)).toBe('Short line.')
  })
  it('tos-390-510-g11 replay: shot 22 is voiced with its action, never as the setting alone', async () => {
    const r = tos(), out = await voiceRun(r, await fitRun(r), TOS_CLIPS)
    const s22 = out.filter((c) => c.shotIndex === 22).map((c) => c.text)
    expect(s22).not.toContain('Dark, rope-laced industrial shaft.')
    for (const t of s22) expect(t).toMatch(/adjusts/)
    expect(s22).toEqual(['Man in black jacket adjusts device.'])
  })
})

describe('C. a cue never ends in a bare noun after a comma (Sintel 12)', () => {
  const shot12 = 'Old man speaks, dim tent.'
  it('the recorded fit made "Man speaks, tent." (the model\'s "Man speaks. Tent dims." was rejected; the deterministic cut dropped "dim")', () => {
    expect(fixture<FitCue[]>('sintel-90-210-g11.cues.fit.json').find((c) => c.shotIndex === 12)!.text).toBe('Man speaks, tent.')
  })
  it('sentenceGuard rejects it; the deterministic shortener cuts the clause instead', () => {
    expect(readsAsSentences(shot12, 'Man speaks, tent.')).toMatch(/bare noun after a comma/)
    expect(shortenDeterministic(shot12, 3)).toBe('Man speaks.')
    expect(readsAsSentences(shot12, 'Man speaks.')).toBeUndefined()
    // a one-word clause the describer wrote is left alone (review): kept whole, or with other words shortened around it
    expect(readsAsSentences('A woman runs, leaps, climbs a wall.', 'A woman runs, leaps, climbs a wall.')).toBeUndefined()
    expect(readsAsSentences('The figure falls face down in the snow, motionless.', 'The figure falls face down in the snow, motionless.')).toBeUndefined()
    expect(readsAsSentences('The small figure falls face down in the deep snow, motionless.', 'The figure falls face down in the snow, motionless.')).toBeUndefined()
    expect(readsAsSentences('A dragon lands, wings spread, roaring.', 'A dragon lands, roaring.')).toBeUndefined()
    expect(shortenDeterministic('The small figure falls face down in the snow, motionless.', 9)).toBe('The figure falls face down in the snow, motionless.')
  })
  it('later in a scene whose place was said, a trailing verbless clause naming that place is not said again', () => {
    const drop = new Set(['tent'])
    expect(withoutTrailingPlace(shot12, drop)).toBe('Old man speaks.')
    expect(withoutTrailingPlace('A woman sits, the tent glows. Fire glows.', drop)).toBe('A woman sits, the tent glows. Fire glows.') // a clause with its verb
    expect(withoutTrailingPlace('A young woman runs, leaps, climbs a wall in the tent.', drop)).toBe('A young woman runs, leaps, climbs a wall in the tent.') // g10 shot 18's shape
    expect(withoutTrailingPlace('Old man speaks, dim tent.', new Set(['town']))).toBe('Old man speaks, dim tent.')
    expect(withoutTrailingPlace('Dim tent.', drop)).toBe('Dim tent.') // no clause before it: settingLead's case
  })
  it('sintel-90-210-g11 replay: shot 12 is "Old man speaks." (the slot held 4 words)', async () => {
    const cues = await fitRun(sintel(), SINTEL_REPLIES)
    expect(cues.find((c) => c.shotIndex === 12)?.text).toBe('Old man speaks.')
    const r = sintel()
    for (const c of cues) expect(readsAsSentences(r.shots.find((x) => x.index === c.shotIndex)!.description, c.text) ?? '').not.toMatch(/bare noun/)
  })
})

describe('D. a shortening keeps a / an / the with its noun', () => {
  it('review: "the" before a bare noun after a preposition may go ("through the rain" → "through rain"); every other article stays', () => {
    expect(readsAsSentences('A man walks through the rain.', 'A man walks through rain.')).toBeUndefined()
    expect(readsAsSentences('A man walks slowly through the heavy rain.', 'A man walks through heavy rain.')).toMatch(/article/) // the noun is modified
    expect(readsAsSentences('An old man stirs a pot.', 'Old man stirs a pot.')).toMatch(/article/)
    expect(readsAsSentences('A man walks through a door.', 'A man walks through door.')).toMatch(/article/) // only "the"
    expect(readsAsSentences('The man walks.', 'Man walks.')).toMatch(/article/) // not after a preposition
  })
  it('verify\'s article fills (copulaFills, decision 0015) are the source: a cue that keeps them passes; polishCue only recases', () => {
    const verified = 'An old man holds a staff; a young woman watches.' // verify added "An" and "a" to "Old man holds staff; young woman watches."
    expect(readsAsSentences(verified, 'An old man holds a staff.')).toBeUndefined()
    expect(shortenDeterministic(verified, 5)).toBe('A man holds a staff.')
    expect(readsAsSentences(verified, 'A man holds a staff.')).toBeUndefined()
  })
  it('sentenceGuard: a shortening that drops an article of a noun it keeps is rejected', () => {
    expect(readsAsSentences('A small tan dragon roars.', 'Dragon roars.')).toMatch(/article/)
    expect(readsAsSentences('A small tan dragon roars.', 'A dragon roars.')).toBeUndefined()
    expect(readsAsSentences('An old bearded man sits by the fire.', 'Bearded man sits by the fire.')).toMatch(/article/)
    expect(readsAsSentences('An old bearded man sits by the fire.', 'A bearded man sits by fire.')).toBeUndefined() // "the" after a preposition (review)
    expect(readsAsSentences('An old bearded man sits by the fire.', 'A bearded man sits by the fire.')).toBeUndefined()
  })
  it('the deterministic shortener never drops one; voice\'s overrun shortening is the same shortener', () => {
    expect(shortenDeterministic('A young woman with short red hair climbs a small rooftop.', 8)).toBe('A woman with red hair climbs a rooftop.')
    expect(shortenKeepingAction('A small tan dragon with a bleeding wing sits on a stone rooftop.', 12)).toBe('A tan dragon with a bleeding wing sits on a stone rooftop.')
  })
  it('g11 shots 4, 19 and 22: the describer wrote no article; shortening neither drops nor invents one', () => {
    const d = (i: number) => sintel().shots.find((s) => s.index === i)!.description
    expect(d(4)).toBe('Old man holds staff; young woman watches.')
    expect(d(22)).toBe('Small tan dragon bleeds on rooftop.')
    expect(d(19)).toMatch(/climbs rooftop$/)
    expect(shortenDeterministic(d(4), 3)).toBe('Man holds staff.')
  })
  it('the edit pass may close a parenthetical with a comma before the verb (g11 cue 13 "…, climbs a rooftop.")', () => {
    const src = 'a young woman with short red hair, in a grey tank top, in brown trousers climbs rooftop'
    expect(editReadsAsSentences(src, 'A young woman with short red hair, in a grey tank top and brown trousers, climbs a rooftop.', [src])).toBeUndefined()
    // still a list or a comma splice
    expect(editReadsAsSentences('A scaled creature with horns and bloodied wing stares.', 'Scaled creature, horns, bloodied wing, stares.', ['A scaled creature with horns and bloodied wing stares.'])).toMatch(/list comma/)
    expect(editReadsAsSentences('Old man stirs pot over fire as woman watches.', 'Old man stirs pot over fire, woman watches.', ['Old man stirs pot over fire as woman watches.'])).toMatch(/list comma/)
  })
})

/**
 * Review (round 3): how many cues the raters passed do the new guard checks (5–7: verbless cut, bare noun after a comma, dropped article)
 * reject? Every recorded final cue of the g10 / g11 runs that is a shortening or an edit of its shot's description (the description does
 * not contain it), on a shot a majority of the 3 blind raters called usable (gate-c-rated.json, from their scores.md). Pinned: a change
 * that rejects more good cues fails here.
 */
describe('the new checks against the raters', () => {
  const rated = fixture<Record<string, number[]>>('gate-c-rated.json')
  it('reject exactly two rater-passed cues: tos-390-510-g10 shots 22 and 25', () => {
    const hits: string[] = []
    for (const [name, passed] of Object.entries(rated)) {
      const shots = fixture<Described[]>(`${name}.described.json`), cues = fixture<FitCue[]>(`${name}.cues.json`)
      for (const c of cues) {
        const d = shots.find((x) => x.index === c.shotIndex)?.description
        if (!d || d.includes(c.text) || !passed.includes(c.shotIndex)) continue
        const why = readsAsSentences(d, c.text)
        if (why && /verbless sentence cut|bare noun|drops an article/.test(why)) hits.push(`${name} ${c.shotIndex}: ${c.text}`)
      }
    }
    expect(hits).toEqual(['tos-390-510-g10 22: Dark, rope-laced industrial shaft.', 'tos-390-510-g10 25: Man in blue and yellow gear swings near organ pipes.'])
  })
})
