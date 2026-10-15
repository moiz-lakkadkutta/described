import type { FitCue } from './steps/05-fit'
import type { Scene } from './steps/04c-scenes'
import { sceneOf } from './steps/04c-scenes'
import { contentWords, stem } from './contentWords'
import { glossarySettingStems, isProperName, KIND, matchedCharacters, placeStems, type Character, type Glossary } from './glossary'
import { sceneStems } from './sceneSetting'

/**
 * The narrative pass's own guards (docs/decisions/0017-narrative-pass.md; spike docs/spikes/narrative-pass-sintel.md). The 05b edit
 * guards (applyEdits) still decide everything else; these widen them exactly where a documentary narrator needs room, and no further:
 * - pronoun licence: a NEW she/he/it (one the cue's old text did not have) needs its referent in one of the last PRONOUN_CUES action
 *   cues as heard, within PRONOUN_WINDOW_MS and in the same scene (or, for she/he, earlier in the same cue), with one candidate only;
 * - carried look: a glossary character's look words count as already said once a cue of the same scene said them (as heard), as long
 *   as the new text still refers to that character — never at the scene's first mention, and never a place word;
 * - "now" and "here" are free (they state no fact);
 * - "still", "again", "meanwhile", "later", "night" ("night falls") are facts: they trace to this cue's own shot descriptions (or its
 *   old text), never to the previous cue, the glossary or the scene label.
 * Pure; tested in test/narrative.test.ts.
 */

/** A new gendered pronoun needs its referent in one of the last this-many action cues. */
export const PRONOUN_CUES = 2
/** …which starts at most this long before the cue. */
export const PRONOUN_WINDOW_MS = 20_000
/** Connectives that state no fact: free in a narrative rewrite (the faithful guard does not see them). */
export const FREE_WORDS = new Set(['now', 'here'])
/** Continuity words that are facts (continuation, repetition, simultaneity, a time skip): only from this cue's own shots. */
export const SOURCE_ONLY = new Set(['still', 'again', 'meanwhile', 'later', 'night', 'nightfall', 'anew'].map(stem))

export type Gender = 'she' | 'he' | 'it'
const FAMILY: Record<Gender, ReadonlySet<string>> = {
  she: new Set(['she', 'her', 'hers', 'herself']),
  he: new Set(['he', 'him', 'his', 'himself']),
  it: new Set(['it', 'its', 'itself']),
}
/** Nouns that make a she/he referent (plus a character of that gender by name). */
const NOUNS: Record<'she' | 'he', RegExp> = { she: /\b(woman|girl|lady|she|her)\b/i, he: /\b(man|boy|he|him|his)\b/i }
/** Several of a gender: no single referent. */
const PLURAL: Record<'she' | 'he', RegExp> = { she: /\b(women|girls|ladies)\b/i, he: /\b(men|boys)\b/i }
const PERSON = new Set(['woman', 'women', 'girl', 'girls', 'man', 'men', 'boy', 'boys', 'person', 'people', 'figure', 'figures', 'lady', 'she', 'he', 'her', 'him', 'his'].map(stem))
/** Look words too generic to identify anyone (the spike's list: size, age, held objects). */
const GENERIC = new Set(['across', 'over', 'under', 'around', 'through', 'into', 'onto', 'behind', 'beside', 'above', 'below', 'its', 'young', 'old', 'small', 'big', 'otherwise', 'when', 'first', 'found', 'out', 'carrying', 'holding', 'staff', 'pipe', 'long', 'face', 'head', 'eyes'].map(stem))

const tokens = (t: string) => t.toLowerCase().replace(/[’]/g, "'").split(/[^a-z']+/).map((w) => w.replace(/'s$/, '')).filter(Boolean)
const count = (t: string, g: Gender) => tokens(t).filter((w) => FAMILY[g].has(w)).length
const hyphenHair = (t: string) => t.replace(/\b(\w+)-haired\b/gi, '$1 hair')

/** A glossary character as the guards see it: its kind noun, its pronoun, its look stems (no generic or place words) and a reference pattern. */
export interface CharRef { name: string; kind: string; gender?: Gender; look: Set<string>; ref: RegExp }
export function charRefs(g: Glossary, placeWords: ReadonlySet<string> = glossarySettingStems(g)): CharRef[] {
  return g.characters.map((c: Character) => {
    const kind = tokens(c.look).find((w) => KIND.has(w)) ?? 'figure'
    const gender: Gender | undefined = /^(woman|girl)$/.test(kind) ? 'she' : /^(man|boy)$/.test(kind) ? 'he' : /^(dragon|creature|llama|rabbit|bunny|bird|fox|animal)$/.test(kind) ? 'it' : undefined
    const look = new Set(contentWords(hyphenHair(c.look)).map(stem).filter((w) => !GENERIC.has(w) && w !== stem(kind) && !placeWords.has(w) && !placeStems(w).length))
    const words = [...(gender ? FAMILY[gender] : []), kind, ...(isProperName(c) ? [c.name] : [])].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    return { name: c.name, kind, ...(gender ? { gender } : {}), look, ref: new RegExp(`\\b(${words.join('|')})\\b`, 'i') }
  })
}

/** What the guards know: the cues, the text of cue k as heard (an accepted rewrite, else the old text), the scenes and the glossary. */
export interface NarrativeView { cues: readonly FitCue[]; heard: (k: number) => string; scenes?: readonly Scene[]; glossary: Glossary; isTextCue: (c: FitCue) => boolean }
const sceneId = (v: NarrativeView, k: number) => (v.scenes?.length ? sceneOf(v.scenes, v.cues[k]!.shotIndex)?.id ?? -1 : 0) // no scenes.json: one scene

/** The last PRONOUN_CUES action cues before i, as heard, within PRONOUN_WINDOW_MS and in i's scene (nearest first). */
export function referentWindow(v: NarrativeView, i: number): string[] {
  const out: string[] = [], sc = sceneId(v, i)
  for (let k = i - 1; k >= 0 && out.length < PRONOUN_CUES; k--) {
    if (v.isTextCue(v.cues[k]!)) continue
    if (v.cues[i]!.startMs - v.cues[k]!.startMs > PRONOUN_WINDOW_MS || sceneId(v, k) !== sc) break
    out.push(v.heard(k))
  }
  return out
}

/**
 * Does `text` refer to someone of gender g: a noun or pronoun of that gender, or a glossary character of that gender by name. Not by
 * look alone: the look matcher gives "a person … in the snow" to Sintel, and "she" after "A person walks uphill" is what the spike
 * rejected.
 */
function refersTo(text: string, g: 'she' | 'he', chars: readonly CharRef[]): boolean {
  if (NOUNS[g].test(text)) return true
  return chars.some((c) => c.gender === g && isProperName({ name: c.name }) && new RegExp(`\\b${c.name}\\b`).test(text))
}
/** More than one candidate of gender g in the texts: a plural noun, or two glossary characters of that gender. */
function ambiguous(texts: readonly string[], g: 'she' | 'he', chars: readonly CharRef[], glossary: Glossary): boolean {
  const all = texts.join(' ')
  if (PLURAL[g].test(all)) return true
  const shown = matchedCharacters(texts, glossary)
  return chars.filter((c) => c.gender === g && (shown.has(c.name) || (isProperName({ name: c.name }) && new RegExp(`\\b${c.name}\\b`).test(all)))).length > 1
}

/**
 * The pronoun licence for cue i's rewrite `edited` (its old text `original`, its own shot descriptions `own`). Returns the reasons a
 * new pronoun is not licensed ([] = fine). A pronoun the old text already had (same count or fewer) is its own: nothing to check.
 * she/he: the referent is in the referent window (unambiguous) or earlier in the edited text; and the cue's own shots show someone of
 * that gender (so "she" is never put on a shot of a dragon alone). it: the new "it" stands for a non-person word the rewrite dropped,
 * and that word is in the referent window ("The dragon flies…" → "It flies…" after "The dragon soars…").
 */
export function pronounProblems(v: NarrativeView, i: number, original: string, edited: string, own: readonly string[]): string[] {
  const out: string[] = []
  const chars = charRefs(v.glossary)
  const window = referentWindow(v, i)
  for (const g of ['she', 'he'] as const) {
    if (count(edited, g) <= count(original, g)) continue
    const first = tokens(edited).findIndex((w) => FAMILY[g].has(w))
    const before = edited.split(/\s+/).slice(0, Math.max(0, first)).join(' ')
    const inCue = first > 0 && refersTo(before, g, chars)
    const near = window.some((t) => refersTo(t, g, chars) || PLURAL[g].test(t))
    if (!inCue && !near) { out.push(`pronoun "${g}" with no referent in the last ${PRONOUN_CUES} cues (${PRONOUN_WINDOW_MS / 1000} s, same scene)`); continue }
    if (!inCue && ambiguous(window, g, chars, v.glossary)) { out.push(`pronoun "${g}" could mean more than one person`); continue }
    if (![...own, original].some((t) => refersTo(t, g, chars))) out.push(`pronoun "${g}": no one of that kind in this cue's shots`)
  }
  if (count(edited, 'it') > count(original, 'it')) {
    const kept = new Set(contentWords(edited).map(stem))
    const dropped = contentWords(original).map(stem).filter((w) => !kept.has(w) && !PERSON.has(w))
    const near = new Set(window.flatMap((t) => contentWords(t).map(stem)))
    if (!dropped.some((w) => near.has(w))) out.push(`pronoun "it" with no referent in the last ${PRONOUN_CUES} cues (${PRONOUN_WINDOW_MS / 1000} s, same scene)`)
  }
  return out
}

/** The edited text as the faithful guard reads it: free words and licensed gendered pronouns removed (the licence checked them). */
export function faithfulText(edited: string): string {
  return edited.split(/(\s+)/).filter((tok) => {
    const w = tok.toLowerCase().replace(/[^a-z']/g, '').replace(/'s$/, '')
    return !(FREE_WORDS.has(w) || FAMILY.she.has(w) || FAMILY.he.has(w))
  }).join('').replace(/\s+/g, ' ').trim()
}

/** Words of `edited` in SOURCE_ONLY that neither this cue's shot descriptions nor its old text say. */
export function unsourcedContinuity(edited: string, own: readonly string[], original: string): string[] {
  const ok = new Set([...own, original].flatMap((t) => contentWords(t).map(stem)))
  return [...new Set(contentWords(edited).filter((w) => SOURCE_ONLY.has(stem(w)) && !ok.has(stem(w))))]
}

/**
 * The look stems (and each character's kind noun) the scene has already said before cue i, as heard, per character. A character's look
 * counts as said in a cue that has one of its look words and a reference to it (pronoun, kind noun or name): "a young woman with
 * short red hair" says Sintel's look, "runs across" does not say the shaman's ("face paint across his eyes"). Place words never carry
 * (a look such as "curled up asleep in the dark cave" must not make "cave" droppable: the place rules own it — Sintel cues 77, 84, 95, 99).
 */
export function carriedLook(v: NarrativeView, i: number): Map<string, CharRef[]> {
  const sc = sceneId(v, i)
  const scene = v.scenes?.length ? sceneOf(v.scenes, v.cues[i]!.shotIndex) : undefined
  const places = new Set([...glossarySettingStems(v.glossary), ...(scene ? sceneStems(scene, v.glossary) : [])])
  const chars = charRefs(v.glossary, places)
  const out = new Map<string, CharRef[]>()
  const add = (w: string, c: CharRef) => { const l = out.get(w) ?? []; if (!l.includes(c)) l.push(c); out.set(w, l) }
  for (let k = 0; k < i; k++) {
    if (v.isTextCue(v.cues[k]!) || sceneId(v, k) !== sc) continue
    const text = v.heard(k), said = contentWords(hyphenHair(text)).map(stem)
    for (const c of chars) {
      const hit = said.filter((w) => c.look.has(w))
      if (hit.length && c.ref.test(text)) { for (const w of hit) add(w, c); add(stem(c.kind), c) }
    }
  }
  return out
}

/** The lost stems of a rewrite that the carried look excuses: carried, and the rewrite still refers to that character. */
export function excusedByCarry(lost: readonly string[], edited: string, carried: ReadonlyMap<string, CharRef[]>): Set<string> {
  return new Set(lost.filter((w) => (carried.get(stem(w)) ?? []).some((c) => c.ref.test(edited))))
}
