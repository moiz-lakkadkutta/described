import { stemmer } from 'stemmer'

/**
 * Content words and stems, shared by the edit pass (05b-edit: faithful / keeps-facts guards) and the plot-event test (plotEvent,
 * DESC-020). Lives outside the steps so 05-fit and 06-voice can use it without importing 05b-edit (which imports both).
 */

/**
 * Function words an edit may use freely: articles, linking conjunctions, case prepositions, auxiliaries, demonstratives. Everything
 * that changes a fact must trace to the allowed text instead: negations (not, no, nicht, kein), quantifiers (all, both, more, one,
 * another), again / same / still, gendered pronouns (he, she, his, her, er, sie, ihr, sein) and spatial words (over, under, behind,
 * left, über, hinter …) are deliberately not here.
 */
export const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'then', 'as', 'while', 'when', 'of', 'in', 'on', 'at', 'to', 'from', 'by', 'for', 'with',
  'is', 'are', 'be', 'been', 'being', 'has', 'have', 'does', 'do', 'it', 'its', 'they', 'them', 'their', 'this', 'that', 'these', 'those', 'there', 'who', 'which', 'what', 'also', 'too', 'so',
  // German
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'und', 'oder', 'aber', 'dann', 'als', 'während', 'mit', 'von', 'vom', 'im', 'an', 'am', 'auf', 'zu', 'zum', 'zur', 'aus', 'bei', 'ist', 'sind', 'hat', 'haben', 'es', 'dieser', 'diese', 'dieses', 'auch',
])
/** Lower-cased words of `t` with punctuation stripped, possessive 's removed and STOP words left out, in order. */
export const contentWords = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).map((w) => w.replace(/^['-]+|['-]+$/g, '').replace(/'s$/, '')).filter((w) => w && !STOP.has(w))

/**
 * One canonical stem per word: Porter (the `stemmer` package, MIT, no dependencies — a hand-rolled candidate-set stemmer matched
 * stars ~ stares and car ~ caring). Two words match when their stems are equal: walks ~ walking ~ walk, fired ~ fire, but fir ≠ fired,
 * scar ≠ scared. Porter is English; a German inflection matches only when written the same (so the guard is stricter in German).
 */
export const stem = (word: string) => stemmer(word.toLowerCase())
