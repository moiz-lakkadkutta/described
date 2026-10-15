import { contentWords, normalizeQuotes, STOP, stem } from './contentWords'
import { PLACE_NOUNS } from './glossary'
import { cutsNeutral } from './textClause'

/**
 * Does a shortening still read as sentences (DESC-028, decision 0011)? fit's shortener (Nova Lite, then shortenDeterministic) may only
 * remove words; on sintel-90-210-g9 Nova Lite turned "Dense city under hazy sky, central pyramid structure." into "City, central
 * pyramid." and both Gate C raters failed it as a verbless fragment. Deterministic, no model call. The checks, in order:
 * 1. in order — the shortening's content words (../contentWords: STOP left out, Porter stem) are a subsequence of the original's: no
 *    role swap ("The girl chases the dragon."), no reordered fact, no new word;
 * 2. no new list comma — a comma or semicolon in the shortening follows a word that had one in the original. Dropping the words
 *    between two nouns and joining them with a comma is how a sentence becomes a list ("Scaled creature, horns, bloodied wing, stares.").
 *    This is the check that catches both g9 fragments;
 * 2a. one source sentence per clause (DESC-029, joinsSentences) — "Tent interior. Fire glows." → "Tent glows." is rejected;
 * 3. not only a subject (English only) — a sentence of the shortening is rejected when it has no verb of its own (verbIndexes) and
 *    every content word in it comes from the subject of a clause of the original that has a verb: the words before that clause's
 *    first verb ("A scaled creature with horns." from "A scaled creature with horns and bloodied wing stares as …"). Reason 'no verb'
 *    when that is the whole shortening, else 'verbless sentence: …'. It fails open: a word from a clause with no verb found, or from
 *    after a verb, makes the sentence acceptable ("Snowy mountains.", "Two hands hold a red bowl.").
 * German ('de'): checks 1 and 2 only — the verb heuristic is English (German -s words such as links, rechts, etwas, alles are not verbs).
 */
export function readsAsSentences(original: string, shortened: string, language: 'en' | 'de' = 'en'): string | undefined {
  const cut = cutsNeutral(original, shortened) // DESC-031: "Text erscheint." is kept whole or dropped, never "Text."
  if (cut) return cut
  if (!inOrder(original, shortened)) return 'out of order'
  const orig = words(original)
  const aligned = align(orig, words(shortened))
  for (const a of aligned) if (/[,;]\W*$/.test(a.raw) && (a.at < 0 || !/[,;:]\W*$/.test(orig[a.at]!.raw))) return `new list comma after "${a.bare}"`
  const joined = joinsSentences(orig, aligned)
  if (joined) return joined
  if (language === 'de') return undefined
  return endsMidPhrase(orig, aligned) ?? danglingClause(orig, aligned) ?? onlySubjects(shortened, [original]) ?? onlyPlace(shortened, [original])
}

const CLAUSE_OPENERS = new Set(['while', 'as', 'who', 'which', 'whose', 'where'])
/**
 * Check 2c (decision 0012 amendment, 2026-10-15; English): a cut that keeps a clause opener but not the clause's verb ("… stirs a pot
 * over fire while a young woman with short red hair." from "… while a young woman …, watches."; the g10 replay's capExtended cut of
 * shot 5). Only when the original had a verb after that opener in the same sentence.
 */
function danglingClause(orig: readonly Word[], aligned: ReadonlyArray<Word & { at: number }>): string | undefined {
  const ov = verbIndexes(orig), sv = verbIndexes(aligned)
  for (const sent of sentencesOf(aligned.map((x, i) => ({ ...x, i })))) {
    const k = sent.map((x) => CLAUSE_OPENERS.has(x.bare)).lastIndexOf(true)
    if (k < 0 || sent.slice(k + 1).some((x) => sv.has(x.i))) continue
    const at = sent[k]!.at
    if (at >= 0 && [...ov].some((v) => v > at && orig[v]!.sentence === orig[at]!.sentence)) return `dangling clause: "${sent.slice(k).map((x) => x.raw).join(' ')}"`
  }
  return undefined
}

/** Prepositions a place phrase opens with ("In the tent.", "Back in the lab.", "Inside the hut."). */
const PLACE_PREPOSITIONS = new Set(['in', 'inside', 'at', 'on', 'under', 'near', 'by', 'outside', 'into', 'within', 'beside', 'behind', 'above', 'below', 'beneath', 'across', 'along', 'through', 'amid', 'among', 'atop', 'over', 'back'])
/** Light and condition words: with place nouns, all a setting statement says ("Dim tent.", "Darkness."). */
const CONDITIONS = new Set(['dim', 'dark', 'darkness', 'bright', 'light', 'shadow', 'shadows', 'gloom', 'mist', 'fog', 'haze', 'smoke', 'night', 'day', 'interior', 'exterior', 'inside', 'outside', 'back'].map(stem))
/**
 * Check 4 (decision 0012 amendment, 2026-10-15; English): the cue is only where we are. g10 voiced "In the tent." four times in a row in
 * place of the blade, the ladle pour and the bowl handed over (fit's clause cut kept the description's opening phrase, which check 3
 * let through: a word from a verbless clause fails open), and "The tent." as a scene pause. Rejected:
 * - a sentence with no verb that opens with a preposition ("In the tent.", "Back in the lab.") — 'only a prepositional phrase';
 * - a text with no verb whose every content word is a place noun or a light / condition word ("The tent.", "Night. A rooftop.",
 *   "Dim tent interior.") when a
 *   source has a verb — 'only a place'.
 * Narrow on purpose: other verbless noun phrases stay acceptable here ("Snowy mountains." beside on-screen text in 06-voice; fit's
 * keepsAction is what stops fit shortening to them) ("Man with dark hair, eyes closed, mechanical device near face." and
 * "Dark, rope-laced industrial shaft." passed every rater on tos-390-510-g10). Verbs: verbIndexes.
 */
function onlyPlace(text: string, sources: readonly string[]): string | undefined {
  const ws = words(text), verbs = verbIndexes(ws)
  for (const s of sentencesOf(ws.map((x, i) => ({ ...x, i })))) {
    if (s.some((x) => verbs.has(x.i))) continue
    if (PLACE_PREPOSITIONS.has(s[0]!.bare) && s.length > 1) return `only a prepositional phrase: "${s.map((x) => x.raw).join(' ')}"`
  }
  if (verbs.size) return undefined
  const cw = contentWords(text).map(stem)
  if (!cw.length || !cw.every((w) => PLACE_NOUNS.has(w) || CONDITIONS.has(w)) || !cw.some((w) => PLACE_NOUNS.has(w))) return undefined
  return sources.some((src) => verbIndexes(words(src)).size) ? `only a place: "${text.trim()}"` : undefined
}

/**
 * fit's action rule (decision 0012 amendment, 2026-10-15): a shortening keeps the shot's action — a verb of the original (by stem,
 * verbIndexes) — when the original has one. g10 shot 27 "a young woman …, in a grey tank top smiles slightly. A small tan dragon roars."
 * was shortened to "A woman with red hair." (no verb; check 3 failed open on the comma before "smiles"). The original's on-screen text
 * clauses are not action and the caller passes the rest. True when the original has no verb that verbIndexes finds (fails open). fit
 * only: 06-voice's overrun shortening is unchanged (tos-390-510-g10 shot 22 "Dark, rope-laced industrial shaft.", passed by its raters).
 * Verbs are matched by Porter stem against the shot's own description, not by meaning: a shortener's synonym ("grabs" for "grips") does
 * not count — the shortener may only remove words (preservesFacts), so a synonym was never a valid shortening anyway.
 */
const PREPOSITIONS = new Set(['with', 'without', 'of', 'in', 'on', 'at', 'by', 'for', 'from', 'into', 'onto', 'under', 'over', 'behind', 'beside', 'near', 'between', 'among', 'through', 'across', 'toward', 'towards', 'above', 'below', 'beneath', 'around', 'along', 'against', 'inside', 'outside', 'beyond', 'within', 'upon', 'past', 'amid', 'atop'])
export function keepsAction(original: string, shortened: string): boolean {
  const ow = words(original), vi = verbIndexes(ow)
  // an -s word right after "preposition + word", when its sentence already has a verb before it, is a compound noun, not a second verb
  // ("swings on rope near organ pipes", "climbs on stone steps"; but "Man in glasses shouts" keeps its verb)
  const compound = (i: number) => i >= 2 && PREPOSITIONS.has(ow[i - 2]!.bare) && !vi.has(i - 1) && !LINKING.has(ow[i]!.bare) && [...vi].some((j) => j < i - 2 && ow[j]!.sentence === ow[i]!.sentence)
  const verbs = [...vi].filter((i) => !compound(i)).map((i) => stem(ow[i]!.bare))
  if (!verbs.length) return true
  const have = new Set(words(shortened).map((w) => stem(w.bare)))
  return verbs.some((v) => have.has(v))
}

const SUBJECT_PRONOUNS = new Set(['he', 'she', 'it', 'they', 'er', 'sie', 'es'])
/**
 * Check 2a (DESC-029, every language): one source sentence per clause. A clause of the shortening (cut at , ; : . ! ? … and before "and")
 * takes its content words from one sentence of the original. "Tent interior. Fire glows." → "Tent glows." keeps every word in order
 * but joins the subject of one sentence to the verb of another, so the tent glows (sintel-90-150-r2 shot 9, published 0:41.6). Whole
 * sentences may still be dropped, kept, or joined with "and" ("The girl runs and the dragon follows.").
 */
function joinsSentences(orig: readonly Word[], aligned: ReadonlyArray<Word & { at: number }>): string | undefined {
  let clause: Array<Word & { at: number }> = []
  /** A sentence that opens with a subject pronoun refers back to the one before: "Old man sits. He holds a staff." → "Old man holds a staff." */
  const opensWithPronoun = (sentence: number) => SUBJECT_PRONOUNS.has(orig.find((w) => w.sentence === sentence)?.bare ?? '')
  const check = () => {
    const from = [...new Set(clause.filter((a) => a.at >= 0 && !STOP.has(a.bare)).map((a) => orig[a.at]!.sentence))].sort((a, b) => a - b)
    const ok = from.length <= 1 || from.slice(1).every((s, k) => s === from[k]! + 1 && opensWithPronoun(s))
    return ok ? undefined : `joins two sentences: "${clause.map((a) => a.raw).join(' ')}"`
  }
  for (const a of aligned) {
    if (a.bare === 'and' && clause.length) { const why = check(); if (why) return why; clause = [] }
    clause.push(a)
    if (/[,;:.!?…]["'”’)\]]*$/.test(a.raw)) { const why = check(); if (why) return why; clause = [] }
  }
  return clause.length ? check() : undefined
}

/** Articles, possessives and prepositions a sentence cannot end on ("…toward a."); not "her" ("hands the cup to her."). */
const END_BAD = new Set(['a', 'an', 'the', 'his', 'its', 'their', 'my', 'your', 'our', 'with', 'of', 'in', 'on', 'at', 'by', 'for', 'from', 'into', 'onto', 'toward', 'towards', 'beneath', 'between', 'among', 'under', 'upon', 'within', 'like', 'beside'])
/**
 * A clause cut between stacked adjectives (PR #52 round-2 review): `word` came right after an article, possessive or preposition and
 * before a comma, and is a listed adjective or -ed word, or the next word is another modifier (hyphenated or adjective-like, not -ing)
 * — "a pale, veiled face", "in sunlit, rubble-strewn alley", "toward a wounded, scaly creature"; not "on the hills, drifting", "past
 * the bakery, the closed bank", "across snow, mountains loom". Bare words; `word` without its comma. Shared with 05-fit's clause cut.
 */
export function midPhrase(prev: string, word: string, next: string): boolean {
  if (!NOUN_BEFORE.has(prev)) return false
  if (ADJECTIVES.has(word) || /ed$/.test(word)) return true
  return /^\p{Ll}[\p{Ll}-]*$/u.test(next) && !/ing$/.test(next) && (next.includes('-') || adjectiveLike(next))
}
/** Check 2b (English): a sentence of the shortening ends on an article / possessive / preposition, or mid-phrase (midPhrase). */
function endsMidPhrase(orig: readonly Word[], aligned: ReadonlyArray<Word & { at: number }>): string | undefined {
  for (const s of sentencesOf(aligned)) {
    const last = s.at(-1)!
    if (END_BAD.has(last.bare)) return `ends mid-phrase: "${last.bare}"`
    const j = last.at
    if (j > 0 && /,\W*$/.test(orig[j]!.raw) && midPhrase(orig[j - 1]!.bare, orig[j]!.bare, orig[j + 1]?.bare ?? '')) return `ends mid-phrase: "${last.bare}"`
  }
  return undefined
}

/**
 * The same question for the edit pass (05b-edit, DESC-028), whose edits may add words from `sources` (the shot descriptions the cue may
 * absorb and the cue texts — applyEdits' allowed list) and reorder them, so there is no in-order check. g9 shot 26: fit's "A scaled
 * creature with horns and bloodied wing stares." was edited into "Scaled creature, horns, bloodied wing, stares." and both raters
 * failed it. The checks, in order:
 * 1. no new list comma — a comma or semicolon follows a word that has one in a source, or comes before a joining word (then, and,
 *    while, as, who, which …) or an -ing word ("…over the fire, then pours broth.", "walks, holding a staff"). "Old man pours broth;
 *    woman smiles." is rejected (a semicolon joining two sentences the sources did not join) — intended;
 * 2. not only a subject (English only), as readsAsSentences check 3, against the sources.
 */
export function editReadsAsSentences(original: string, edited: string, sources: readonly string[], language: 'en' | 'de' = 'en'): string | undefined {
  const ws = words(edited), src = sources.map(words)
  const commaIn = new Set(src.flatMap((w) => w.filter((x) => /[,;:]\W*$/.test(x.raw)).map((x) => x.bare)))
  for (const [k, w] of ws.entries()) {
    if (!/[,;]\W*$/.test(w.raw) || commaIn.has(w.bare)) continue
    const next = ws[k + 1]?.bare ?? ''
    if (!JOINERS.has(next) && !/ing$/.test(next)) return `new list comma after "${w.bare}"`
  }
  return language === 'de' ? undefined : onlySubjects(edited, [original, ...sources]) ?? onlyPlace(edited, [original, ...sources])
}
/** Words that may follow a comma the sources did not have: they open a clause, not the next item of a list. */
const JOINERS = new Set(['and', 'then', 'while', 'as', 'but', 'who', 'which', 'when', 'before', 'after', 'until', 'where', 'whose'])

/**
 * Check 3: 'no verb' when every sentence of `text` is only a subject of `sources`, 'verbless sentence: …' when one is, else undefined.
 * A sentence is only a subject when it has content words, no verb of its own (verbIndexes) and each content word's stem occurs in the
 * sources only before the first verb of a clause (split at , ; and sentence ends) that has one.
 */
function onlySubjects(text: string, sources: readonly string[]): string | undefined {
  const subject = new Set<string>(), elsewhere = new Set<string>()
  for (const src of sources) {
    const ws = words(src), verbs = verbIndexes(ws)
    for (const clause of clauses(ws)) {
      const v = clause.findIndex((i) => verbs.has(i))
      for (const [k, i] of clause.entries()) for (const w of contentWords(ws[i]!.raw).map(stem)) (v > k ? subject : elsewhere).add(w)
    }
  }
  const ws = words(text), verbs = verbIndexes(ws)
  const bare = sentencesOf(ws.map((x, i) => ({ ...x, i }))).filter((s) => {
    if (s.some((x) => verbs.has(x.i))) return false
    const cw = contentWords(s.map((x) => x.raw).join(' ')).map(stem)
    return cw.length > 0 && cw.every((w) => subject.has(w) && !elsewhere.has(w))
  })
  if (!bare.length) return undefined
  return bare.length === sentencesOf(ws).length ? 'no verb' : `verbless sentence: "${bare[0]!.map((x) => x.raw).join(' ')}"`
}
/**
 * Word indexes of each clause: split after a word ending in , ; : or a sentence end — except a comma between adjectives at the start of
 * a clause ("A dark, complex airship floats …": "A dark," is not a clause).
 */
function clauses(ws: readonly Word[]): number[][] {
  const out: number[][] = [[]]
  ws.forEach((w, i) => {
    const c = out.at(-1)!
    c.push(i)
    if (/^[^,]*,["'”’)\]]*$/.test(w.raw) && c.length <= 2 && adjectiveLike(w.bare)) return
    if (/[,;:.!?…]["'”’)\]]*$/.test(w.raw)) out.push([])
  })
  return out.filter((c) => c.length)
}

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
  return normalizeQuotes(t).trim().split(/\s+/).filter(Boolean).map((raw) => {
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
  'near', 'between', 'among', 'through', 'across', 'toward', 'towards', 'above', 'below', 'beneath', 'around', 'along', 'against', 'inside', 'outside', 'like', 'beyond', 'within', 'upon', 'past', 'amid', 'atop'])
/** Colours and listed size / texture words: after one, an -s word is a plural noun ("red flames", "large rocks"). */
const ADJECTIVES = new Set(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'black', 'white', 'grey', 'gray', 'golden', 'silver', 'pale', 'dark',
  'large', 'small', 'big', 'little', 'tiny', 'huge', 'tall', 'short', 'long', 'wide', 'narrow', 'thick', 'thin', 'heavy', 'old', 'young', 'ancient', 'bright', 'dim', 'faint', 'soft',
  'rough', 'smooth', 'sharp', 'wooden', 'icy', 'wet', 'dry', 'distant', 'nearby', 'vast', 'massive', 'slender', 'ornate', 'simple', 'various'])
/** -y nouns that may be a verb's subject ("Boy runs."): every other word ending in -y of 4+ letters reads as an adjective ("Snowy mountains."). */
const Y_NOUNS = new Set(['body', 'army', 'baby', 'lady', 'city', 'enemy', 'family', 'puppy', 'monkey', 'donkey', 'turkey', 'pony', 'party', 'kitty', 'jury', 'navy', 'story', 'galaxy'])
const adjectiveLike = (w: string) => ADJECTIVES.has(w) || /(?:ed|ish|ful|ous|less|ive)$/.test(w) || (/y$/.test(w) && w.length >= 4 && !Y_NOUNS.has(w))

/**
 * A heuristic for the finite verbs of a house-style English line (present tense, subject first):
 * - is / are / has / have / was / were;
 * - a word ending in -s (not -ss / -us / -is, not STOP or NOT_VERBS) that does not open its clause (the subject does) and does not
 *   follow a word that marks a noun (NOUN_BEFORE: "with horns", "two hands") or an adjective (adjectiveLike: "bloodied wings", "snowy
 *   mountains", "red flames"). An -ly word before it is skipped and the word before that judged ("Sintel slowly lifts"), unless an
 *   article or the like comes before the -ly word, which is then a noun ("a butterfly lands"). After "and", an -s word is a verb only
 *   when the word before "and" was ("turns and runs"; not "horns and wings");
 * - a base form after a plural subject: the first word of a clause with no verb yet, right after an -s noun ("Two hands hold", "Dragons
 *   attack", "red sparks drift") or after "X and Y" at the clause start ("Celia and Thom argue", "The man and the woman talk"), when it
 *   is lower-case and not a function word, preposition, listed adjective or an -ing / -ed / -ly / -s word.
 * Limits: other base forms and past tense are missed ("A man and his dog in the snow walk", "Two figures in coats walk"); a plural noun
 * after a noun is read as a verb ("Stone steps."). The check that uses it fails open: a missed verb makes a clause count as having no
 * verb, and words from such a clause make a sentence acceptable.
 */
function verbIndexes(ws: readonly Word[]): Set<number> {
  const out = new Set<number>()
  const clauseOf = new Map<number, number[]>()
  for (const c of clauses(ws)) for (const i of c) clauseOf.set(i, c)
  ws.forEach((w, i) => {
    if (LINKING.has(w.bare)) { out.add(i); return }
    const prev = ws[i - 1]
    if (!prev || prev.sentence !== w.sentence) return // opens its sentence: the subject
    const clause = clauseOf.get(i)!, k = clause.indexOf(i)
    if (finiteS(w.bare)) {
      if (prev.bare === 'and') { if (out.has(i - 2)) out.add(i); return }
      let judge = prev.bare
      if (/ly$/.test(judge) && !Y_NOUNS.has(judge)) {
        const pp = ws[i - 2]
        if (!pp || pp.sentence !== w.sentence || NOUN_BEFORE.has(pp.bare)) { out.add(i); return } // "a butterfly lands"
        judge = pp.bare
      }
      if (!NOUN_BEFORE.has(judge) && !adjectiveLike(judge)) out.add(i)
      return
    }
    if (k < 1 || clause.slice(0, k).some((j) => out.has(j)) || !baseForm(w)) return
    const pluralSubject = finiteS(prev.bare) && !out.has(i - 1)
    if (pluralSubject || andHead(clause.slice(0, k).map((j) => ws[j]!.bare))) out.add(i)
  })
  return out
}
const finiteS = (w: string) => /^\p{L}[\p{L}'-]*s$/u.test(w) && !STOP.has(w) && !NOT_VERBS.has(w) && !/(?:ss|us|is)$/.test(w)
/** A candidate base-form verb: lower-case, a word, not a function word, preposition, listed adjective, -ing / -ed / -ly / -s form. */
const baseForm = (w: Word) => /^\p{Ll}[\p{Ll}'-]*[,;:.!?]?$/u.test(w.raw) && !STOP.has(w.bare) && !NOUN_BEFORE.has(w.bare) && !ADJECTIVES.has(w.bare) && !/(?:ing|ed|s)$/.test(w.bare) && !/.{3}ly$/.test(w.bare)
/** "X and Y" (each one word, with an optional article) as the whole clause so far: "celia and thom", "the man and the woman". */
const andHead = (ws: readonly string[]) => {
  const t = ws.filter((w) => !ARTICLES.has(w))
  return t.length === 3 && t[1] === 'and'
}
const ARTICLES = new Set(['a', 'an', 'the', 'his', 'her', 'their', 'its'])
