import { contentWords, STOP, stem } from './contentWords'

/**
 * Does a shortening still read as sentences (DESC-028, decision 0011)? fit's shortener (Nova Lite, then shortenDeterministic) may only
 * remove words; on sintel-90-210-g9 Nova Lite turned "Dense city under hazy sky, central pyramid structure." into "City, central
 * pyramid." and both Gate C raters failed it as a verbless fragment. Deterministic, no model call. The checks, in order:
 * 1. in order — the shortening's content words (../contentWords: STOP left out, Porter stem) are a subsequence of the original's: no
 *    role swap ("The girl chases the dragon."), no reordered fact, no new word;
 * 2. no new list comma — a comma or semicolon in the shortening follows a word that had one in the original. Dropping the words
 *    between two nouns and joining them with a comma is how a sentence becomes a list ("Scaled creature, horns, bloodied wing, stares.");
 * 3. a verb — when the original has a verb (originalVerbs), the shortening keeps at least one;
 * 4. no verbless sentence — a sentence of the shortening with no verb is allowed only when every original sentence its words come from
 *    had none either ("Snowy mountains." may stay beside "A lone figure walks left."; "Scaled creature." cut from a sentence with
 *    "stares" may not).
 * Checks 3 and 4 use the English heuristic in originalVerbs; in German it rarely finds a verb, so there only checks 1 and 2 apply.
 */
export function readsAsSentences(original: string, shortened: string): string | undefined {
  if (!inOrder(original, shortened)) return 'out of order'
  const orig = words(original), verbs = verbIndexes(orig)
  const aligned = align(orig, words(shortened))
  for (const a of aligned) if (/[,;]\W*$/.test(a.raw) && (a.at < 0 || !/[,;:]\W*$/.test(orig[a.at]!.raw))) return `new list comma after "${a.bare}"`
  if (!verbs.size) return undefined
  if (!aligned.some((a) => verbs.has(a.at))) return 'no verb'
  for (const s of sentencesOf(aligned)) {
    if (s.some((a) => verbs.has(a.at))) continue
    const from = new Set(s.filter((a) => a.at >= 0).map((a) => orig[a.at]!.sentence))
    if ([...verbs].some((v) => from.has(orig[v]!.sentence))) return `verbless sentence: "${s.map((a) => a.raw).join(' ')}"`
  }
  return undefined
}

/**
 * The same question for the edit pass (05b-edit, DESC-028), whose edits may add words from `sources` (the shot descriptions the cue may
 * absorb and the cue texts — applyEdits' allowed list) and reorder them, so there is no in-order check and verbs are found in the edit's
 * own text. g9 shot 26: fit's "A scaled creature with horns and bloodied wing stares." was edited into "Scaled creature, horns, bloodied
 * wing, stares." and both raters failed it. The checks, in order:
 * 1. no new list comma — a comma or semicolon follows a word that has one in a source, or comes before a joining word (then, and,
 *    while, as, who, which …) or an -ing word ("…over the fire, then pours broth.", "walks, holding a staff");
 * 2. a verb — when the cue's original text has a verb (originalVerbs), the edit has one;
 * 3. no verbless sentence, unless all its content words come from sentences of the sources that have none ("Snowy mountains.").
 */
export function editReadsAsSentences(original: string, edited: string, sources: readonly string[]): string | undefined {
  const ws = words(edited), src = sources.map(words)
  const commaIn = new Set(src.flatMap((w) => w.filter((x) => /[,;:]\W*$/.test(x.raw)).map((x) => x.bare)))
  for (const [k, w] of ws.entries()) {
    if (!/[,;]\W*$/.test(w.raw) || commaIn.has(w.bare)) continue
    const next = ws[k + 1]?.bare ?? ''
    if (!JOINERS.has(next) && !/ing$/.test(next)) return `new list comma after "${w.bare}"`
  }
  if (!verbIndexes(words(original)).size) return undefined
  const verbs = verbIndexes(ws)
  if (!verbs.size) return 'no verb'
  const verbless = new Set(src.flatMap((w) => { const v = verbIndexes(w); return sentencesOf(w.map((x, i) => ({ ...x, i }))).filter((s) => !s.some((x) => v.has(x.i))).flatMap((s) => contentWords(s.map((x) => x.raw).join(' ')).map(stem)) }))
  for (const s of sentencesOf(ws.map((x, i) => ({ ...x, i })))) {
    if (s.some((x) => verbs.has(x.i))) continue
    const text = s.map((x) => x.raw).join(' ')
    if (!contentWords(text).every((w) => verbless.has(stem(w)))) return `verbless sentence: "${text}"`
  }
  return undefined
}
/** Words that may follow a comma the sources did not have: they open a clause, not the next item of a list. */
const JOINERS = new Set(['and', 'then', 'while', 'as', 'but', 'who', 'which', 'when', 'before', 'after', 'until', 'where', 'whose'])

/** The shortening's content words, by stem, are a subsequence of the original's (same order; nothing new). */
export function inOrder(original: string, shortened: string): boolean {
  const orig = contentWords(original).map(stem)
  let i = 0
  for (const s of contentWords(shortened).map(stem)) {
    while (i < orig.length && orig[i] !== s) i++
    if (i++ >= orig.length) return false
  }
  return true
}

/** The verbs originalVerbs finds, as the original's words (lower-cased, punctuation stripped), in order. */
export const originalVerbs = (text: string) => { const w = words(text); return [...verbIndexes(w)].sort((a, b) => a - b).map((i) => w[i]!.bare) }

interface Word { raw: string; bare: string; sentence: number }
const words = (t: string): Word[] => {
  let sentence = 0
  return t.trim().split(/\s+/).filter(Boolean).map((raw) => {
    const w = { raw, bare: raw.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, '').replace(/^['-]+|['-]+$/g, ''), sentence }
    if (/[.!?…]["'”’)\]]*$/.test(raw)) sentence++
    return w
  })
}

/** Each word of the shortening with the index of the original word it came from (exact word, in order; -1 when none). */
function align(orig: readonly Word[], short: readonly Word[]) {
  let i = 0
  return short.map((w) => {
    const at = orig.findIndex((o, k) => k >= i && o.bare === w.bare)
    if (at >= 0) i = at + 1
    return { ...w, at }
  })
}
/** The aligned words grouped by the shortening's own sentences. */
function sentencesOf<T extends { sentence: number }>(ws: readonly T[]): T[][] {
  const out: T[][] = []
  for (const w of ws) (out[w.sentence] ??= []).push(w)
  return out.filter(Boolean)
}

/** Linking verbs in house style; finite but not -s forms of a content verb. */
const LINKING = new Set(['is', 'are', 'has', 'have', 'was', 'were'])
/** -s words that are never a verb, beyond STOP and the -ss / -us / -is endings (as ../plotEvent). */
const NOT_VERBS = new Set(['across', 'towards', 'perhaps', 'always', 'sometimes', 'yes', 'less', 'unless', 'hers', 'ours', 'theirs', 'yours', 'whereas', 'besides', 'upstairs', 'downstairs', 'backwards', 'forwards', 'sideways', 'its'])
/** After one of these, an -s word is a noun: articles, determiners, possessives, numbers, prepositions. */
const NOUN_BEFORE = new Set(['a', 'an', 'the', 'his', 'her', 'its', 'their', 'my', 'your', 'our', 'this', 'that', 'these', 'those', 'some', 'many', 'several', 'few', 'both', 'all', 'no',
  'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'twin', 'with', 'without', 'of', 'in', 'on', 'at', 'by', 'for', 'from', 'into', 'onto', 'under', 'over', 'behind', 'beside',
  'near', 'between', 'among', 'through', 'across', 'toward', 'towards', 'above', 'below', 'beneath', 'around', 'along', 'against', 'inside', 'outside', 'like'])
/** Colours and listed size / texture words: after one, an -s word is a plural noun ("red flames", "large rocks"). */
const ADJECTIVES = new Set(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'black', 'white', 'grey', 'gray', 'golden', 'silver', 'pale', 'dark',
  'large', 'small', 'big', 'little', 'tiny', 'huge', 'tall', 'short', 'long', 'wide', 'narrow', 'thick', 'thin', 'heavy', 'old', 'young', 'ancient', 'bright', 'dim', 'faint', 'soft',
  'rough', 'smooth', 'sharp', 'wooden', 'icy', 'wet', 'dry', 'distant', 'nearby', 'vast', 'massive', 'slender', 'ornate', 'simple', 'various'])
/** -y nouns that may be a verb's subject ("Boy runs."): every other word ending in -y of 4+ letters reads as an adjective ("Snowy mountains."). */
const Y_NOUNS = new Set(['body', 'army', 'baby', 'lady', 'city', 'enemy', 'family', 'puppy', 'monkey', 'donkey', 'turkey', 'pony', 'party', 'kitty', 'jury', 'navy', 'story', 'galaxy'])
const adjectiveLike = (w: string) => ADJECTIVES.has(w) || /(?:ed|ish|ful|ous|less|ive)$/.test(w) || (/y$/.test(w) && w.length >= 4 && !Y_NOUNS.has(w))

/**
 * A heuristic for the finite verbs of a house-style line (present tense, subject first): is / are / has / have, or a word ending in -s
 * (not -ss / -us / -is, not STOP or NOT_VERBS) that does not open its sentence (the subject does) and does not follow a word that marks
 * a noun (NOUN_BEFORE: "with horns", "two hands") or an adjective (adjectiveLike: "bloodied wings", "snowy mountains", "red flames").
 * After "and", an -s word is a verb only when the word before "and" was ("turns and runs"; not "horns and wings").
 * Limits: verbs not ending in -s are missed ("Two hands hold a bowl.", "Flames rise.", past tense, German); a plural noun after a noun
 * is read as a verb ("Stone steps."), and a verb after a -y, -ed, -ive … noun not in Y_NOUNS is missed ("Pony trots." is found,
 * "Olive glows." is not). A missed verb makes the original look verbless (checks 3 and 4 then pass); a noun read as a verb is one more
 * word whose survival counts as "a verb kept". Either way the misread lets a shortening through rather than rejecting a good one —
 * except when the only verb a shortening keeps is one the heuristic missed beside one it found.
 */
function verbIndexes(ws: readonly Word[]): Set<number> {
  const out = new Set<number>()
  ws.forEach((w, i) => {
    const prev = ws[i - 1]
    if (LINKING.has(w.bare)) { out.add(i); return }
    if (!prev || prev.sentence !== w.sentence) return // opens its sentence: the subject
    if (!/^\p{L}[\p{L}'-]*s$/u.test(w.bare) || STOP.has(w.bare) || NOT_VERBS.has(w.bare) || /(?:ss|us|is)$/.test(w.bare)) return
    if (prev.bare === 'and') { if (out.has(i - 2)) out.add(i); return }
    if (NOUN_BEFORE.has(prev.bare) || adjectiveLike(prev.bare)) return
    out.add(i)
  })
  return out
}
