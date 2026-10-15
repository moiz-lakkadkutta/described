import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { Glossary, nameRevealed, type Character, type Setting } from '@described/contracts'
import { contentWords, normalizeQuotes, stem } from './contentWords'
import { textSpans } from './textClause'

export { Glossary, nameRevealed, type Character, type Setting } from '@described/contracts'

/**
 * A title's people and places (DESC-029, docs/decisions/0012-characters-and-scenes.md), as the pipeline uses them: the describe
 * prompt block (peopleAndPlaces), the scene step's setting words, fit's setting statements and the edit pass's grounding guard
 * (nameEvidence). Written by an editor in apps/api/prisma/titles.json (glossaries.json for a title the seeder must not create). A video with no entry (`pnpm describe` on your own file) has an
 * empty glossary: no name is ever voiced and no look is suggested, but scene build-up (04c-scenes, fit, the edit pass) works the same.
 */
export const EMPTY_GLOSSARY: Glossary = { characters: [], settings: [] }

/** titles.json beside the API's seed. */
export const DEFAULT_GLOSSARY_FILE = new URL('../../../apps/api/prisma/titles.json', import.meta.url)
/**
 * Glossaries of titles that are not seeded (apps/api/prisma/glossaries.json, same entry shape): a title that `pnpm describe --slug`
 * creates as its own Title row (full-length `sintel`, DESC-025), which titles.json must not list — the seeder would create the row,
 * and the CLI refuses an existing slug. Never read by `pnpm titles:seed`.
 */
export const GLOSSARIES_FILE = new URL('../../../apps/api/prisma/glossaries.json', import.meta.url)
/** Where loadGlossary looks: GLOSSARY_FILE alone when set (a JSON array of { slug, characters?, settings? }), else titles.json then glossaries.json. */
export const glossaryFiles = (): (string | URL)[] => (process.env.GLOSSARY_FILE ? [process.env.GLOSSARY_FILE] : [DEFAULT_GLOSSARY_FILE, GLOSSARIES_FILE])

const Entry = z.object({ slug: z.string() }).merge(Glossary)
const warned = new Set<string>()
const readEntries = (file: string | URL): { slug: string }[] => {
  let raw: unknown
  try { raw = JSON.parse(readFileSync(file, 'utf8')) } catch { raw = undefined }
  return Array.isArray(raw) ? raw.filter((t): t is { slug: string } => !!t && typeof t === 'object' && typeof (t as { slug?: unknown }).slug === 'string') : []
}
/**
 * The glossary for `slug` from `file` (titles.json, then glossaries.json; or the files given, in order — the first file with a hit
 * wins): the entry with that slug, else the entry whose slug the requested one extends — an evaluation copy named `<source>-g<n>`
 * (`sintel-90-210-g10`, pnpm gate-c) reads `sintel-90-210`'s, never a sibling title such as `tears-of-steel-40-100-de` — else
 * EMPTY_GLOSSARY, with a loud warning once per slug (no name will be voiced). A malformed entry throws.
 */
export function loadGlossary(slug: string, file: string | URL | readonly (string | URL)[] = glossaryFiles(), opts: { warn?: boolean } = {}): Glossary {
  const files = Array.isArray(file) ? file : [file as string | URL]
  let hit: { slug: string } | undefined
  for (const f of files) {
    const entries = readEntries(f)
    hit = entries.find((t) => t.slug === slug) ?? entries.find((t) => new RegExp(`^${t.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-g\\d+$`).test(slug))
    if (hit) break
  }
  if (!hit) {
    if (opts.warn !== false && !warned.has(slug)) { warned.add(slug); console.warn(`glossary: WARNING no people-and-places entry for "${slug}" in ${files.map(String).join(', ')}: no name will be voiced and no look suggested (scenes still work). Set GLOSSARY_FILE or add the title to titles.json or glossaries.json.`) }
    return EMPTY_GLOSSARY
  }
  const { characters, settings } = Entry.parse(hit)
  return { characters, settings }
}
/** The context's glossary: ctx.glossary (tests, the worker) or the slug's entry in titles.json or glossaries.json. */
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

/**
 * The fallback short reference when a character has no `short`: the look's head, cut before "with / in / wearing …" but never at a
 * comma ("a huge, round grey rabbit with long ears" → "the huge round grey rabbit", not "the huge").
 */
export function shortLook(look: string): string {
  const head = look.split(';')[0]!.replace(/,/g, '').split(/\s(?:with|in|wearing|holding|carrying|at|behind|on|aiming)\s/u)[0]!.trim()
  return head.replace(/^(?:a|an|the)\s+/iu, 'the ')
}
/** What a cue says in place of a name it may not use: the editor's `short` ("the big grey rabbit"), else shortLook. */
export const shortOf = (c: Pick<Character, 'look'> & { short?: string }) => c.short?.trim() || shortLook(c.look)

/** Nouns of a person or animal a description refers to someone by. Plural phrases ("two figures") are not one character. */
export const KIND = new Set(['man', 'woman', 'girl', 'boy', 'figure', 'person', 'soldier', 'scientist', 'technician', 'llama', 'rabbit', 'bunny', 'bird', 'fox', 'creature', 'animal', 'sniper', 'dragon'])
const GENERIC = new Set(['figure', 'person', 'creature', 'animal'])
const SAME_KIND: Record<string, string[]> = { woman: ['woman', 'girl'], girl: ['woman', 'girl'], man: ['man', 'boy', 'soldier', 'scientist', 'technician', 'sniper'], soldier: ['man', 'soldier', 'sniper'], rabbit: ['rabbit', 'bunny'], bunny: ['rabbit', 'bunny'] }
const DETERMINERS = new Set(['a', 'an', 'the', 'another', 'other', 'same', 'one'])
const PLURAL_COUNT = /^(?:two|three|four|several|many|some)$/

/** A person or animal phrase and its clause: up to three modifiers before the noun, an "in …" phrase after it ("man in a dark jacket"). */
export interface Mention { phrase: string; clause: string }
/** The person/animal noun phrases of a text, on-screen text left out; plural phrases skipped. */
export function mentionsIn(text: string): Mention[] {
  const plain = normalizeQuotes(textSpans(text).reduceRight((t, s) => t.slice(0, s.start) + ' ' + t.slice(s.end), text)).toLowerCase()
  return plain.split(/[.!?;,…]+/u).flatMap((clause) => {
    const ws = clause.replace(/[^\p{L}\s'-]/gu, ' ').split(/\s+/).filter(Boolean)
    const out: Mention[] = []
    ws.forEach((w, i) => {
      if (!KIND.has(w)) return
      const before: string[] = []
      for (let k = i - 1; k >= 0 && before.length < 3; k--) {
        const x = ws[k]!
        if (PLURAL_COUNT.test(x)) return
        if (DETERMINERS.has(x)) break
        if (/s$/.test(x) && !/ss$/.test(x) && k === i - 1 && !/(?:ous|less)$/.test(x)) break // "glows man": a verb, not an adjective
        if (['and', 'with', 'of', 'in', 'on', 'at', 'to', 'from', 'by', 'as', 'while', 'then'].includes(x)) break
        before.unshift(x)
      }
      const after: string[] = []
      if (['in', 'wearing'].includes(ws[i + 1] ?? '')) for (let k = i + 1; k < ws.length && after.length < 5; k++) { if (k > i + 2 && /s$/.test(ws[k]!) && !/ss$/.test(ws[k]!) && after.length >= 2) break; after.push(ws[k]!) }
      out.push({ phrase: [...before, w, ...after].join(' '), clause: ws.join(' ') })
    })
    return out
  })
}
/** The phrases only (the evaluation's descriptor list). */
export const mentions = (text: string) => mentionsIn(text).map((m) => m.phrase)

/**
 * The character a phrase refers to: one of the same kind of noun (a generic noun — figure, person, creature — fits any), the one whose
 * look shares the most of the phrase's words; on a tie, the most of its clause's words ("man in dark jacket aims rifle": the man with
 * the rifle). undefined when still tied, or when no look word is shared and the kind fits more than one.
 */
export function assign(phrase: string, g: Glossary, clause = ''): string | undefined {
  const ws = phrase.split(' '), head = ws.find((w) => KIND.has(w))!
  const kind = (c: Character) => contentWords(c.look).find((w) => KIND.has(w)) ?? shortLook(c.look).split(' ').at(-1)!
  const fits = g.characters.filter((c) => GENERIC.has(head) || (SAME_KIND[kind(c)] ?? [kind(c)]).includes(head))
  if (fits.length === 1 && !GENERIC.has(head)) return fits[0]!.name
  const lookOf = (c: Character) => new Set(contentWords(c.look).map(stem))
  const overlap = (c: Character, words: string[]) => words.filter((w) => w !== head && lookOf(c).has(stem(w))).length
  const phraseWords = contentWords(phrase), clauseWords = contentWords(clause)
  const scored = fits.map((c) => ({ c, n: overlap(c, phraseWords) + (GENERIC.has(head) && lookOf(c).has(stem(head)) ? 1 : 0), m: overlap(c, clauseWords) }))
    .sort((a, b) => b.n - a.n || b.m - a.m)
  const [first, second] = scored
  if (!first || (first.n === 0 && first.m === 0)) return undefined
  if (second && second.n === first.n && second.m === first.m) return undefined
  return first.c.name
}

/** The characters the texts show, by look (mentions given to a character by assign): what a cue's shot descriptions may name. */
export function matchedCharacters(texts: readonly string[], g: Glossary): Set<string> {
  const out = new Set<string>()
  for (const t of texts) for (const m of mentionsIn(t)) { const who = assign(m.phrase, g, m.clause); if (who) out.add(who) }
  return out
}

/**
 * The describe prompt's block (DESC-029): people by look always, and a name once revealed at `atMs` — bound to the look: "call them
 * Thom" only for a figure matching Thom's look, never for another man in a dark jacket. No roles (they are story, not what is seen).
 * Places by name and look. Phrased "when one of them is visible" so a listed look is not given to an unlisted extra. '' when empty.
 */
export function peopleAndPlaces(g: Glossary, atMs: number): string {
  if (isEmpty(g)) return ''
  const lines = ['People and places in this film. Use these words when one of them is visible; never give a listed look or name to anyone or anything else:']
  for (const c of g.characters) {
    if (isProperName(c) && nameRevealed(c, atMs)) lines.push(`- ${c.look}: only if the person visible matches this look, call them ${c.name} (the first time: "${shortOf(c)}, ${c.name}"); never give this name to anyone else.`)
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
/** -ing nouns that are places. */
const ING_PLACE_NOUNS = new Set(['building', 'clearing', 'landing', 'crossing'])
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
  // an -ing / -ed form is a verb or a modifier, not a place, though its stem may be one ("towering" → tower: tos-390-510-g10's label)
  return [...new Set(contentWords(plain).filter((w) => !/(?:ing|ed)$/.test(w) || ING_PLACE_NOUNS.has(w)).map(stem).filter((w) => PLACE_NOUNS.has(w) || extra.has(w)))]
}

/** Where a name in a cue comes from (edit.json evidence, like the SDH speaker evidence of #39 / decision 0008). */
export type NameSource = { name: string; source: 'glossary'; revealedAtS: number; evidence: string } | { name: string; source: 'dialogue'; at: number }
export interface NameCheck { names: NameSource[]; premature: string[]; invented: string[]; /** revealed glossary names whose character the shot descriptions do not show (binding) */ unbound: string[] }
/** Capitalised words that are not names in a description (sentence openers are skipped anyway; these appear mid-sentence). */
const NOT_A_NAME = new Set(['I', 'TV', 'OK'])

/**
 * The names in `text` and their evidence at `atMs`: a glossary character's proper name revealed by then (source glossary), or a name
 * the dialogue has said by then (`spoken`: knownNames with when each was first heard; source dialogue). A glossary name not revealed
 * and not spoken is premature; any other capitalised word that is not the first of a sentence (and not on-screen text) is invented.
 * On-screen text is never checked: "Words appear: SINTEL." shows the film's name, it does not name a figure.
 * Binding (`shots`: the descriptions of the cue's shots): a revealed glossary name counts only when those descriptions show that
 * character by look (matchedCharacters) or the cue itself does; otherwise it is `unbound` ("Thom" on the sniper's shot).
 */
export function nameEvidence(text: string, atMs: number, g: Glossary, spoken: readonly { name: string; at: number }[] = [], shots?: readonly string[]): NameCheck {
  const out: NameCheck = { names: [], premature: [], invented: [], unbound: [] }
  const shown = shots ? matchedCharacters(shots, g) : undefined // the shots' looks only: a cue's own added words never bind
  let plain = textSpans(text).reduceRight((t, s) => t.slice(0, s.start) + ' '.repeat(s.end - s.start) + t.slice(s.end), text)
  const said = (n: string) => spoken.find((s) => s.name === n)
  const add = (n: NameSource) => { if (!out.names.some((x) => x.name === n.name)) out.names.push(n) }
  for (const c of g.characters.filter(isProperName)) {
    const re = new RegExp(`(?<![\\p{L}])${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'gu')
    if (!re.test(plain)) continue
    plain = plain.replace(re, (m) => ' '.repeat(m.length))
    const heard = said(c.name)
    // Bound when the shots show the character by look, or when the describer itself wrote the name in one of the shot descriptions
    // (it saw the frames and the look-bound list); a name only fit or edit added must match the look. A name the dialogue has said by
    // then is kept whatever the binding.
    const named = !!shots?.some((d) => new RegExp(re.source, 'u').test(textSpans(d).reduceRight((t, s) => t.slice(0, s.start) + ' ' + t.slice(s.end), d)))
    const bound = !shots || shown!.has(c.name) || named
    if (nameRevealed(c, atMs) && bound) add({ name: c.name, source: 'glossary', revealedAtS: c.revealedAtS!, evidence: c.nameEvidence })
    else if (heard && heard.at * 1000 <= atMs) add({ name: c.name, source: 'dialogue', at: heard.at })
    else if (nameRevealed(c, atMs)) { if (!out.unbound.includes(c.name)) out.unbound.push(c.name) }
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
 * Replaces a name the cue may not use with the character's short reference ("Emo blinks." → "The thin young man blinks."), or with
 * "someone" for a name that is in no glossary. Capitalised at a sentence start. Never inside on-screen text: "Words appear: Big Buck
 * Bunny." is quoted verbatim (decision 0008).
 */
export function withoutName(text: string, name: string, g: Glossary): string {
  const c = g.characters.find((x) => x.name === name)
  const by = c ? shortOf(c) : 'someone'
  const re = new RegExp(`(^|[.!?]\\s+|\\s|[("“])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'gu')
  const swap = (piece: string, opensSentence: boolean) => piece.replace(re, (_, pre: string, off: number) => pre + ((off === 0 && /^\s*$/u.test(pre) && opensSentence) || /[.!?]\s+$/u.test(pre) ? by[0]!.toUpperCase() + by.slice(1) : by))
  const spans = textSpans(text)
  const ends = (k: number) => /[.!?…]["'”’)\]]*\s*$/u.test(text.slice(0, k)) // the text before position k ends a sentence
  let out = '', at = 0
  for (const sp of spans) { out += swap(text.slice(at, sp.start), at === 0 || ends(at)) + text.slice(sp.start, sp.end); at = sp.end }
  return out + swap(text.slice(at), at === 0 || ends(at))
}
