/**
 * The verify prompt (DESC-027, docs/decisions/0010-verify-pass.md): a second Qwen3-VL call per shot that sees the same key frames
 * and the draft description, and deletes what the frames do not show. Its own module so the describe prompt (prompts.ts) and
 * this one change independently; changing this text is a product decision.
 * The system prompt is hashed into the cache key as text, so editing it re-buys the calls by itself. Bump VERIFY_PROMPT_VERSION
 * when anything else in the request changes — verifyUserText, VERIFY_MAX_TOKENS, the temperature, or how replies are read —
 * so old cached replies stop matching; the version is also written to verify.json.
 * The detail classes are named as types only: an example pair from the film we evaluate on would teach that clip's answers.
 */
export const VERIFY_PROMPT_VERSION = 1

/**
 * Words a checked description may use although the draft did not: the general words the prompt allows in place of a wrong
 * specific one ("bat" → "creature", "staff" → "object"), and "visible" so a noun list can become a sentence that claims only
 * presence ("A face is visible."). Everything else must be in the draft (04b-verify's guard). en, de.
 */
export const GENERAL_WORDS = new Set([
  'creature', 'animal', 'person', 'figure', 'someone', 'something', 'object', 'weapon', 'visible',
  'wesen', 'tier', 'person', 'gestalt', 'jemand', 'etwas', 'gegenstand', 'objekt', 'waffe', 'sichtbar',
])
/** Plural general words: each may stand in only for a plural draft word (04b-verify's in-order guard). */
export const PLURAL_GENERAL_WORDS = new Set(['creatures', 'animals', 'people', 'figures', 'objects', 'weapons'])
/** Words the prompt lets the model add to make a sentence; all are in ../contentWords' STOP list, so no guard counts them as content. */
export const LINKING_WORDS = 'is, are, has, have, with, there, a, an, the'

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
    'Delete every detail that is not clearly visible in the frames. If a word is wrong but the thing is there, you may replace it with one of these general words only: creature, animal, person, figure, object, weapon, someone, something. Prefer deleting to guessing.',
    'Never add a fact: no new colour, direction, body part, object, action or name, and no word the draft does not have, except those general words and "visible".',
    'Keep every on-screen text clause (starting "Words appear:"; in German "Text erscheint:") exactly as written, word for word. Keep names exactly as the draft wrote them, and keep the order of the draft: who does what to whom stays as the draft has it.',
    `Write complete present-tense sentences with a verb, never a list of nouns. You may add these linking words, which add no fact: ${LINKING_WORDS}; and "visible" ("A face is visible.").`,
    `Use at most ${maxWords} words. If every detail is visible, return the draft unchanged.`,
    'Reply with JSON only, no other text: {"text": "<the checked description>", "removed": ["<each detail you deleted or replaced, as the draft wrote it>"]}',
  ].join('\n')
}

/** The user turn's text, after the frames. */
export const verifyUserText = (draft: string) =>
  `These are frames from one shot, in time order. Draft description: "${draft.replace(/"/g, '\\"')}" Check it against the frames.`
