import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { Glossary, nameRevealed, type Character, type Setting } from '@described/contracts'
import { contentWords, stem } from './contentWords'
import { textSpans } from './textClause'

export { Glossary, nameRevealed, type Character, type Setting } from '@described/contracts'

/**
 * A title's people and places (DESC-029, docs/decisions/0012-characters-and-scenes.md), as the pipeline uses them: the describe
 * prompt block (peopleAndPlaces), the scene step's setting words, fit's setting statements and the edit pass's grounding guard
 * (nameEvidence). Written by an editor in apps/api/prisma/titles.json; a video with no entry (`pnpm describe` on your own file) has an
 * empty glossary and every step behaves as before.
 */
export const EMPTY_GLOSSARY: Glossary = { characters: [], settings: [] }

/** titles.json beside the API's seed; GLOSSARY_FILE overrides (a JSON array of { slug, characters?, settings? }). */
export const DEFAULT_GLOSSARY_FILE = new URL('../../../apps/api/prisma/titles.json', import.meta.url)

const Entry = z.object({ slug: z.string() }).merge(Glossary)
/** The glossary for `slug` from `file` (titles.json), or EMPTY_GLOSSARY when the file or the slug is missing. A malformed entry throws. */
export function loadGlossary(slug: string, file: string | URL = process.env.GLOSSARY_FILE ?? DEFAULT_GLOSSARY_FILE): Glossary {
  let raw: unknown
  try { raw = JSON.parse(readFileSync(file, 'utf8')) } catch { return EMPTY_GLOSSARY }
  const hit = Array.isArray(raw) ? raw.find((t) => t && typeof t === 'object' && (t as { slug?: unknown }).slug === slug) : undefined
  if (!hit) return EMPTY_GLOSSARY
  const { characters, settings } = Entry.parse(hit)
  return { characters, settings }
}
/** The context's glossary: ctx.glossary (tests, the worker) or the slug's entry in titles.json. */
export const glossaryFor = (ctx: { slug: string; glossary?: Glossary }) => ctx.glossary ?? loadGlossary(ctx.slug)
export const isEmpty = (g: Glossary) => !g.characters.length && !g.settings.length

/** A character whose name is a proper name (capitalised: "Emo", "Big Buck Bunny"), not a label like "the sniper". */
export const isProperName = (c: Pick<Character, 'name'>) => /^\p{Lu}/u.test(c.name)

/** Names a cue or shot at `atMs` may use: the glossary's proper names revealed by then, and names heard in the dialogue (knownNames). */
export function allowedNames(g: Glossary, atMs: number, spoken: readonly string[] = []): string[] {
  const out = g.characters.filter((c) => isProperName(c) && nameRevealed(c, atMs)).map((c) => c.name)
  for (const n of spoken) if (!out.includes(n)) out.push(n)
  return out
}

/** "a thin young man with short dark hair, in a pale green shirt" → "the thin young man": the head of a look, for a short reference. */
export function shortLook(look: string): string {
  const head = look.split(/[,;]|\s(?:with|in|wearing|holding|carrying|at|behind|on)\s/u)[0]!.trim()
  return head.replace(/^(?:a|an|the)\s+/iu, 'the ')
}

/**
 * The describe prompt's block (DESC-029): people by look always, with name and role only once revealed at `atMs`; places by name and
 * look. Phrased "when one of them is visible" so a listed look is not given to an unlisted extra. Empty string for an empty glossary.
 */
export function peopleAndPlaces(g: Glossary, atMs: number): string {
  if (isEmpty(g)) return ''
  const lines = ['People and places in this film. Use these words when one of them is visible; never give a listed look or name to anyone or anything else:']
  for (const c of g.characters) {
    if (isProperName(c) && nameRevealed(c, atMs)) lines.push(`- ${c.name}: ${c.look}; ${c.role}. Call them ${c.name}.`)
    else lines.push(`- ${c.look} (not named yet: describe by this look, never by a name)`)
  }
  for (const s of g.settings) lines.push(`- Place: ${s.name}, ${s.look}`)
  return lines.join('\n')
}

/** Words that are not a fact about a place (they describe light or size): a setting is grounded by its nouns, not by "dim". */
const PLACE_FILLER = new Set(['dim', 'dark', 'bright', 'glowing', 'old', 'small', 'large', 'huge', 'round', 'grey', 'gray', 'white', 'pale', 'blue', 'green', 'yellow', 'red', 'brown', 'deep', 'high', 'narrow', 'long', 'its', 'over', 'under', 'between', 'along', 'beyond', 'above', 'onto', 'opening', 'lit', 'strewn', 'hanging', 'centre', 'center', 'middle'])
/** Place nouns a description uses for where a shot is ("Dark room.", "Tent interior.", "Snowy mountains."). Stems compared. */
export const PLACE_NOUNS = new Set(['room', 'tent', 'hut', 'interior', 'house', 'hall', 'chamber', 'corridor', 'tunnel', 'cave', 'forest', 'woods', 'mountain', 'mountains', 'desert', 'field', 'meadow',
  'street', 'alley', 'city', 'cityscape', 'town', 'village', 'rooftop', 'roof', 'bridge', 'canal', 'river', 'stream', 'lake', 'sea', 'beach', 'shore', 'sky', 'lab', 'laboratory', 'office', 'kitchen',
  'church', 'tower', 'balcony', 'deck', 'ship', 'platform', 'station', 'market', 'courtyard', 'garden', 'plain', 'valley', 'cliff', 'ridge', 'snow', 'burrow', 'hole', 'fence', 'camp', 'pit',
  'raum', 'zimmer', 'zelt', 'wald', 'berg', 'berge', 'stadt', 'straße', 'brücke', 'wüste', 'feld'].map(stem))
/** Time words a scene change may carry ("Night.", "40 YEARS LATER"). */
export const TIME_WORDS = new Set(['night', 'day', 'dawn', 'dusk', 'morning', 'evening', 'later', 'years', 'nacht', 'tag', 'später'].map(stem))

/** Stems of the place words of a phrase: its content words without light and size words. */
export const placeWordStems = (t: string) => new Set(contentWords(t).filter((w) => !PLACE_FILLER.has(w)).map(stem))
/** Stems of a setting's place words: its name and look, without light and size words. */
export const settingStems = (s: Pick<Setting, 'name' | 'look'>) => placeWordStems(`${s.name} ${s.look}`)
/** Stems of every glossary setting's place words. */
export const glossarySettingStems = (g: Glossary) => new Set(g.settings.flatMap((s) => [...settingStems(s)]))
/** Stems of the place words in `text` (PLACE_NOUNS, plus the glossary's setting words when given), on-screen text left out. */
export function placeStems(text: string, extra: ReadonlySet<string> = new Set()): string[] {
  const plain = textSpans(text).reduceRight((t, s) => t.slice(0, s.start) + ' ' + t.slice(s.end), text)
  return [...new Set(contentWords(plain).map(stem).filter((w) => PLACE_NOUNS.has(w) || extra.has(w)))]
}

/** Where a name in a cue comes from (edit.json evidence, like the SDH speaker evidence of #39 / decision 0008). */
export type NameSource = { name: string; source: 'glossary'; revealedAtS: number; evidence: string } | { name: string; source: 'dialogue'; at: number }
export interface NameCheck { names: NameSource[]; premature: string[]; invented: string[] }
/** Capitalised words that are not names in a description (sentence openers are skipped anyway; these appear mid-sentence). */
const NOT_A_NAME = new Set(['I', 'TV', 'OK'])

/**
 * The names in `text` and their evidence at `atMs`: a glossary character's proper name revealed by then (source glossary), or a name
 * the dialogue has said by then (`spoken`: knownNames with when each was first heard; source dialogue). A glossary name not revealed
 * and not spoken is premature; any other capitalised word that is not the first of a sentence (and not on-screen text) is invented.
 * On-screen text is never checked: "Words appear: SINTEL." shows the film's name, it does not name a figure.
 */
export function nameEvidence(text: string, atMs: number, g: Glossary, spoken: readonly { name: string; at: number }[] = []): NameCheck {
  const out: NameCheck = { names: [], premature: [], invented: [] }
  let plain = textSpans(text).reduceRight((t, s) => t.slice(0, s.start) + ' '.repeat(s.end - s.start) + t.slice(s.end), text)
  const said = (n: string) => spoken.find((s) => s.name === n)
  const add = (n: NameSource) => { if (!out.names.some((x) => x.name === n.name)) out.names.push(n) }
  for (const c of g.characters.filter(isProperName)) {
    const re = new RegExp(`(?<![\\p{L}])${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'gu')
    if (!re.test(plain)) continue
    plain = plain.replace(re, (m) => ' '.repeat(m.length))
    const heard = said(c.name)
    if (nameRevealed(c, atMs)) add({ name: c.name, source: 'glossary', revealedAtS: c.revealedAtS!, evidence: c.nameEvidence })
    else if (heard && heard.at * 1000 <= atMs) add({ name: c.name, source: 'dialogue', at: heard.at })
    else if (!out.premature.includes(c.name)) out.premature.push(c.name)
  }
  const ws = [...plain.matchAll(/\S+/gu)].map((m) => m[0])
  ws.forEach((w, i) => {
    const bare = w.replace(/^[^\p{L}]+|[^\p{L}'-]+$/gu, '').replace(/'s$/u, '')
    if (!/^\p{Lu}\p{Ll}/u.test(bare) || NOT_A_NAME.has(bare)) return
    const opens = i === 0 || /[.!?:;…]["'”’)\]]*$/u.test(ws[i - 1]!)
    const heard = said(bare)
    if (heard && heard.at * 1000 <= atMs) { add({ name: bare, source: 'dialogue', at: heard.at }); return }
    if (!opens && !out.invented.includes(bare)) out.invented.push(bare)
  })
  return out
}

/**
 * Replaces a name the cue may not use with the character's short look ("Emo blinks." → "The thin young man blinks."), or with
 * "someone" for a name that is in no glossary. Capitalised at a sentence start.
 */
export function withoutName(text: string, name: string, g: Glossary): string {
  const c = g.characters.find((x) => x.name === name)
  const by = c ? shortLook(c.look) : 'someone'
  const re = new RegExp(`(^|[.!?]\\s+|\\s|[("“])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'gu')
  return text.replace(re, (_, pre: string) => pre + (/^$|[.!?]\s+$/u.test(pre) ? by[0]!.toUpperCase() + by.slice(1) : by))
}
