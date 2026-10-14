import { contentWords, stem } from './contentWords'
import { nameEvidence, PLACE_NOUNS, placeWordStems, settingStems, shortLook, TIME_WORDS, type Glossary } from './glossary'
import { settingLead } from './sceneSetting'
import { textSpans } from './textClause'
import { textClauses } from './steps/05-fit'
import { parseVtt } from '@moizp/vega-media-kit/core'
import type { Word } from './steps/03-speech'

/**
 * Character and scene context in a cue list (DESC-029, docs/decisions/0012-characters-and-scenes.md; baseline in
 * docs/eval/character-scene-baseline.md). Deterministic, no AWS call: given a title's cues, its glossary, the names its dialogue says
 * (with times) and hand-annotated scenes (start and place, from the frames), it reports
 * - invented names (a capitalised word mid-sentence that no glossary or dialogue backs) and names voiced before they are revealed;
 * - the distinct descriptors used for each character (noun phrases of a person or animal noun, assigned to the character whose look
 *   shares the most words; names count as one descriptor) and the phrases no character could be given;
 * - per scene: does its first cue state the place; is each change of scene signalled (place or time words in its first cue); how many
 *   cues say the place again after it was said.
 * Heuristics, documented where they are: an evaluation aid to compare runs, not a guard.
 */
export interface EvalCue { startMs: number; text: string; extended?: boolean }
export interface AnnotatedScene { startS: number; setting: string; change?: 'place' | 'time' }
export interface EvalInput { cues: readonly EvalCue[]; glossary: Glossary; spoken?: readonly { name: string; at: number }[]; scenes: readonly AnnotatedScene[] }

/** Nouns of a person or animal a description refers to someone by. Plural phrases ("two figures") are not one character and are skipped. */
const KIND = new Set(['man', 'woman', 'girl', 'boy', 'figure', 'person', 'soldier', 'scientist', 'technician', 'llama', 'rabbit', 'bunny', 'bird', 'fox', 'creature', 'animal', 'sniper'])
const GENERIC = new Set(['figure', 'person', 'creature', 'animal'])
const SAME_KIND: Record<string, string[]> = { woman: ['woman', 'girl'], girl: ['woman', 'girl'], man: ['man', 'boy', 'soldier', 'scientist', 'technician', 'sniper'], soldier: ['man', 'soldier', 'sniper'], rabbit: ['rabbit', 'bunny'], bunny: ['rabbit', 'bunny'] }
const DETERMINERS = new Set(['a', 'an', 'the', 'another', 'other', 'same', 'one'])
/** Where-nouns for "states the place" (PLACE_NOUNS without objects that sit in a place: a pit, a hole, a fence, the sky, snow). */
const NOT_WHERE = new Set(['pit', 'hole', 'fence', 'sky', 'snow', 'stream', 'tower', 'roof', 'platform', 'river', 'lake'].map(stem))

export interface Mention { cueMs: number; phrase: string; character?: string }
/** The person/animal noun phrases of a cue ("bearded man", "red-haired girl", "lone figure"), with up to three words before the noun. */
export function mentions(text: string): string[] {
  const plain = textSpans(text).reduceRight((t, s) => t.slice(0, s.start) + ' ' + t.slice(s.end), text).toLowerCase()
  return plain.split(/[.!?;,…]+/u).flatMap(clauseMentions)
}
/** One clause's phrases: up to three modifiers before the noun, and an "in …" phrase after it ("man in a dark jacket"; not "with …", mostly a body part: "with wide eyes"). */
function clauseMentions(clause: string): string[] {
  const ws = clause.replace(/[^\p{L}\s'-]/gu, ' ').split(/\s+/).filter(Boolean)
  const out: string[] = []
  ws.forEach((w, i) => {
    if (!KIND.has(w)) return
    const before: string[] = []
    for (let k = i - 1; k >= 0 && before.length < 3; k--) {
      const x = ws[k]!
      if (DETERMINERS.has(x) || /^(?:two|three|four|several|many|some)$/.test(x)) { if (/^(?:two|three|four|several|many|some)$/.test(x)) return; break }
      if (/s$/.test(x) && !/ss$/.test(x) && k === i - 1 && !/(?:ous|less)$/.test(x)) break // "glows man": a verb, not an adjective
      if (['and', 'with', 'of', 'in', 'on', 'at', 'to', 'from', 'by', 'as', 'while', 'then'].includes(x)) break
      before.unshift(x)
    }
    const after: string[] = []
    if (['in', 'wearing'].includes(ws[i + 1] ?? '')) for (let k = i + 1; k < ws.length && after.length < 5; k++) { if (k > i + 2 && /s$/.test(ws[k]!) && !/ss$/.test(ws[k]!) && after.length >= 2) break; after.push(ws[k]!) }
    out.push([...before, w, ...after].join(' '))
  })
  return out
}

/** The character a phrase refers to: same kind of noun (a generic one fits all), most look words shared; undefined when tied or none. */
export function assign(phrase: string, g: Glossary): string | undefined {
  const ws = phrase.split(' '), head = ws.find((w) => KIND.has(w))!
  /** A character's kind: the first person or animal noun of its look ("a huge, round grey rabbit …" → rabbit). */
  const kinds = (c: Glossary['characters'][number]) => contentWords(c.look).find((w) => KIND.has(w)) ?? shortLook(c.look).split(' ').at(-1)!
  const fits = g.characters.filter((c) => GENERIC.has(head) || (SAME_KIND[kinds(c)] ?? [kinds(c)]).includes(head))
  if (fits.length === 1 && !GENERIC.has(head)) return fits[0]!.name
  const score = (c: Glossary['characters'][number]) => { const look = new Set(contentWords(c.look).map(stem)); return contentWords(ws.filter((w) => w !== head).join(' ')).filter((w) => look.has(stem(w))).length + (GENERIC.has(head) && look.has(stem(head)) ? 1 : 0) }
  const scored = fits.map((c) => ({ c, n: score(c) })).sort((a, b) => b.n - a.n)
  if (!scored.length || scored[0]!.n === 0 || (scored[1] && scored[1].n === scored[0]!.n)) return fits.length === 1 && scored[0]!.n > 0 ? fits[0]!.name : undefined
  return scored[0]!.c.name
}

/** Does a cue say where we are: the annotated place's name words or look nouns in a short verbless setting sentence, or a where-noun. */
export function statesWhere(text: string, setting: string, g: Glossary): boolean {
  const set = g.settings.find((s) => s.name === setting)
  const name = placeWordStems(setting)
  const plain = textSpans(text).reduceRight((t, s) => t.slice(0, s.start) + ' ' + t.slice(s.end), text)
  const stems = contentWords(plain).map(stem)
  if (stems.some((w) => name.has(w) || (PLACE_NOUNS.has(w) && !NOT_WHERE.has(w)))) return true
  return !!settingLead(text, set ? settingStems(set) : name)
}
/** The place stems a cue says for this scene: where-nouns and the setting's name words, and the look words of a setting statement. */
export function whereStems(text: string, setting: string, g: Glossary): string[] {
  const set = g.settings.find((s) => s.name === setting)
  const name = placeWordStems(setting), look = set ? settingStems(set) : name
  const plain = textSpans(text).reduceRight((t, s) => t.slice(0, s.start) + ' ' + t.slice(s.end), text)
  const lead = settingLead(text, look)
  const stems = contentWords(plain).map(stem)
  return [...new Set(stems.filter((w) => name.has(w) || (PLACE_NOUNS.has(w) && !NOT_WHERE.has(w)) || (!!lead && look.has(w) && contentWords(lead).map(stem).includes(w))))]
}
const statesTime =(text: string) => contentWords(text).some((w) => TIME_WORDS.has(stem(w))) || /\bLATER\b/.test(text)

export interface EvalReport {
  cues: number
  inventedNames: { atS: number; name: string }[]
  prematureNames: { atS: number; name: string }[]
  namesUsed: { atS: number; name: string; source: string }[]
  descriptors: Record<string, string[]>
  unassigned: string[]
  scenes: { startS: number; setting: string; cues: number; firstStates: boolean | null; signalled: boolean | null; repeats: number }[]
  firstCueStatesPlace: { yes: number; of: number }
  changesSignalled: { yes: number; of: number }
  repeatedSettings: number
}

export function evaluateContext({ cues, glossary: g, spoken = [], scenes }: EvalInput): EvalReport {
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs)
  const r: EvalReport = { cues: sorted.length, inventedNames: [], prematureNames: [], namesUsed: [], descriptors: Object.fromEntries(g.characters.map((c) => [c.name, []])), unassigned: [], scenes: [], firstCueStatesPlace: { yes: 0, of: 0 }, changesSignalled: { yes: 0, of: 0 }, repeatedSettings: 0 }
  for (const c of sorted) {
    const at = Math.round(c.startMs / 100) / 10
    const check = nameEvidence(c.text, c.startMs, g, spoken)
    r.inventedNames.push(...check.invented.map((name) => ({ atS: at, name })))
    r.prematureNames.push(...check.premature.map((name) => ({ atS: at, name })))
    for (const n of check.names) { r.namesUsed.push({ atS: at, name: n.name, source: n.source }); const k = g.characters.find((x) => x.name === n.name)?.name; if (k && !r.descriptors[k]!.includes(`(name) ${k}`)) r.descriptors[k]!.push(`(name) ${k}`) }
    for (const p of mentions(c.text)) {
      const who = assign(p, g)
      const d = p.split(' ').filter((w) => !DETERMINERS.has(w)).join(' ')
      if (who) { if (!r.descriptors[who]!.includes(d)) r.descriptors[who]!.push(d) } else if (!r.unassigned.includes(d)) r.unassigned.push(d)
    }
  }
  scenes.forEach((s, k) => {
    const end = scenes[k + 1]?.startS ?? Infinity
    // On-screen text pauses ("Words appear: SINTEL.") are the film's own words, not a description of where we are: left out here.
    const own = sorted.filter((c) => c.startMs / 1000 >= s.startS - 0.05 && c.startMs / 1000 < end - 0.05 && textClauses(c.text)?.rest !== '')
    const states = own.map((c) => statesWhere(c.text, s.setting, g))
    const firstStates = own.length ? states[0]! : null
    // A repeat: a cue says a place word (whereStems) this scene has already said ("Snowy mountains." twice, "desert" twice).
    const said = new Set<string>()
    let repeats = 0
    for (const c of own) {
      const ws = whereStems(c.text, s.setting, g)
      if (ws.some((w) => said.has(w))) repeats++
      ws.forEach((w) => said.add(w))
    }
    const signalled = k === 0 ? null : own.length ? (states[0]! || statesTime(own[0]!.text)) : false
    r.scenes.push({ startS: s.startS, setting: s.setting, cues: own.length, firstStates, signalled, repeats })
    if (firstStates !== null) { r.firstCueStatesPlace.of++; if (firstStates) r.firstCueStatesPlace.yes++ }
    if (signalled !== null) { r.changesSignalled.of++; if (signalled) r.changesSignalled.yes++ }
    r.repeatedSettings += repeats
  })
  return r
}

/** Markdown for one title, before and (when given) after. */
export function reportMarkdown(slug: string, before: EvalReport, after?: EvalReport): string {
  const cols = after ? ['Metric', 'Before', 'After'] : ['Metric', 'Value']
  const row = (label: string, f: (x: EvalReport) => string) => `| ${label} | ${f(before)} |${after ? ` ${f(after)} |` : ''}`
  const list = (xs: { atS: number; name: string }[]) => (xs.length ? xs.map((x) => `${x.name} (${x.atS} s)`).join(', ') : '0')
  const lines = [
    `### ${slug}`, '', `| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`,
    row('Cues', (x) => String(x.cues)),
    row('Invented names', (x) => list(x.inventedNames)),
    row('Names before revealedAtS', (x) => list(x.prematureNames)),
    row('Names voiced (evidence)', (x) => (x.namesUsed.length ? x.namesUsed.map((n) => `${n.name} ${n.atS} s (${n.source})`).join(', ') : '0')),
    ...Object.keys(before.descriptors).map((name) => row(`Descriptors: ${name}`, (x) => `${x.descriptors[name]?.length ?? 0}${x.descriptors[name]?.length ? `: ${x.descriptors[name]!.join(' / ')}` : ''}`)),
    row('Unassigned person phrases', (x) => (x.unassigned.length ? x.unassigned.join(' / ') : '—')),
    row('Scenes whose first cue states the place', (x) => `${x.firstCueStatesPlace.yes} of ${x.firstCueStatesPlace.of}`),
    row('Scene / time changes signalled', (x) => `${x.changesSignalled.yes} of ${x.changesSignalled.of}`),
    row('Setting repeated within a scene', (x) => String(x.repeatedSettings)),
    '',
    'Scenes (annotated): ' + before.scenes.map((s) => `${s.startS} s ${s.setting} — ${s.cues} cue(s), first states place: ${s.firstStates ?? 'no cue'}${s.signalled === null ? '' : `, change signalled: ${s.signalled}`}, repeats: ${s.repeats}`).join('; '),
    '',
  ]
  return lines.join('\n')
}

/** Words from a captions VTT: each caption's words spread evenly over it, with its voice label (the kit's parseVtt). */
export function wordsFromVtt(vtt: string): Word[] {
  return parseVtt(vtt, { trackId: 'captions' }).flatMap((c) => {
    const ws = c.text.split(/\s+/).filter(Boolean), d = (c.end - c.start) / Math.max(1, ws.length)
    return ws.map((text, k) => ({ start: c.start + k * d, end: c.start + (k + 1) * d, text, ...((c as { speaker?: string }).speaker ? { speaker: (c as { speaker?: string }).speaker } : {}) }))
  })
}
