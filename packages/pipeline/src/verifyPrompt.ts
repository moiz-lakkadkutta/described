/**
 * The verify prompt (DESC-027, docs/decisions/0010-verify-pass.md): a second Qwen3-VL call per shot that sees the same key frames
 * and the draft description, and deletes what the frames do not show. Its own module so the describe prompt (prompts.ts) and
 * this one change independently; changing this text is a product decision.
 * The system prompt is hashed into the cache key as text, so editing it re-buys the calls by itself. Bump VERIFY_PROMPT_VERSION
 * when anything else in the request changes — verifyUserText, VERIFY_MAX_TOKENS, the temperature, or how replies are read —
 * so old cached replies stop matching; the version is also written to verify.json.
 * The detail classes are named as types only: an example pair from the film we evaluate on would teach that clip's answers.
 */
import { NEUTRAL_TEXT } from './textClause'

/** 4: DESC-031 — on-screen text clauses are checked (kept verbatim or replaced by NEUTRAL_TEXT), text-only drafts are no longer skipped. */
export const VERIFY_PROMPT_VERSION = 4

/**
 * The only words a checked description may use that the draft did not have, per language (04b-verify's guards; exact lower-cased
 * forms, no stop list, no stemming — the principle the human chose for the edit pass's repeat guard, #44):
 * - LINKING: free to add, to turn a noun list into a sentence ("is … with"). Not has / have (hat / haben): they fill a deleted verb
 *   with a possession fact ("reaches for the sword" → "has the sword"). "with" is not free when the draft has "without". "visible" /
 *   "sichtbar" only as "is/are visible" after a subject that opens a draft sentence (04b-verify: addedVisibleOk).
 * - GENERAL: each may stand in for exactly one draft word, in place ("bat" → "creature"); a PLURAL one only for a plural word.
 */
export const LINKING = {
  en: ['is', 'are', 'with', 'there', 'a', 'an', 'the'],
  de: ['ist', 'sind', 'mit', 'es', 'gibt', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines'],
} as const
export const VISIBLE = { en: 'visible', de: 'sichtbar' } as const
export const COPULA = { en: ['is', 'are'], de: ['ist', 'sind'] } as const
export const GENERAL = {
  en: ['creature', 'animal', 'person', 'figure', 'someone', 'something', 'object', 'weapon'],
  de: ['wesen', 'tier', 'person', 'gestalt', 'jemand', 'etwas', 'gegenstand', 'objekt', 'waffe'],
} as const
export const PLURAL_GENERAL = { en: ['creatures', 'animals', 'people', 'figures', 'objects', 'weapons'], de: ['tiere', 'personen', 'gestalten', 'gegenstände', 'objekte', 'waffen'] } as const

/**
 * The system prompt. The categories are the kinds of detail raters failed on sintel-90-210 (g9). maxWords is the reply's cap
 * (04b-verify: wordCap — the draft's length + 3 within the shot's word budget, never below the draft's own length).
 */
export function verifySystemPrompt(language: 'en' | 'de', maxWords: number): string {
  return [
    `You check audio description for blind and low-vision viewers against the frames of one film shot. The draft was written from these frames and may state details the frames do not show. Reply in ${language === 'de' ? 'German' : 'English'}.`,
    'Check every detail of the draft against the frames, one at a time:',
    '- colours, including hair colour;',
    '- where on the body something is;',
    '- what kind of creature or animal it is; what an object is;',
    '- the direction of movement, as seen on screen (left or right);',
    '- the eyes: open or closed, and whether they open or close during the frames;',
    '- who holds, gives, takes or does what;',
    '- place: "nearby", "beside" or "then" across a cut to a different place;',
    '- movement or change (something swirling, appearing, opening or closing) that the frames do not show.',
    `Delete every detail that is not clearly visible in the frames. If a word is wrong but the thing is there, you may replace it with one of these general words only: ${GENERAL[language].join(', ')}. Prefer deleting to guessing.`,
    'Never add a fact: no new colour, direction, body part, object, action or name. Use only the words of the draft, in the same form and in the same order, except the words named here. Keep every negation (not, no, never, without) and every word that says something is not quite real or not done: almost, tries, appears, seems, statue, toy, reflection, picture.',
    `Check every on-screen text clause (starting "Words appear:"; in German "Text erscheint:") against the frames. Keep it exactly as written, word for word, only if every quoted word is fully legible in the frames and exactly right. If any part of the text is hidden, cut off, blurred or misread, replace the whole clause with exactly "${NEUTRAL_TEXT[language]}" and nothing else. Never write a corrected quote, and never add on-screen text.`,
    'Keep names exactly as the draft wrote them, and keep the order of the draft: who does what to whom stays as in the draft.',
    `Write complete present-tense sentences with a verb, never a list of nouns. You may add these linking words, which add no fact: ${LINKING[language].join(', ')}; and "${COPULA[language][0]} ${VISIBLE[language]}" after the subject of a draft sentence.`,
    `Use at most ${maxWords} words. If every detail is visible, return the draft unchanged.`,
    'Reply with JSON only, no other text: {"text": "<the checked description>", "removed": ["<each detail you deleted or replaced, as the draft wrote it>"]}',
  ].join('\n')
}

/** The user turn's text, after the frames. */
export const verifyUserText = (draft: string) =>
  `These are frames from one shot, in time order. Draft description: "${draft.replace(/"/g, '\\"')}" Check it against the frames.`
