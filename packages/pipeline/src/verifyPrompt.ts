/**
 * The verify prompt (DESC-027, docs/decisions/0010-verify-pass.md): a second Qwen3-VL call per shot that sees the same key frames
 * and the draft description, and deletes what the frames do not show. Its own module so the describe prompt (prompts.ts) and
 * this one change independently; changing this text is a product decision — bump VERIFY_PROMPT_VERSION (it is in the cache key
 * through the system prompt anyway, the version names the change in verify.json).
 */
export const VERIFY_PROMPT_VERSION = 1

/**
 * Words a checked description may use although the draft did not: the general words the prompt allows in place of a wrong
 * specific one ("bat" → "creature", "staff" → "object"), and "visible" so a noun list can become a sentence that claims only
 * presence ("A face is visible."). Everything else must be in the draft (04b-verify's guard). en, de.
 */
export const GENERAL_WORDS = new Set([
  'creature', 'creatures', 'animal', 'animals', 'person', 'people', 'figure', 'figures', 'someone', 'something', 'object', 'objects', 'weapon', 'visible',
  'wesen', 'tier', 'tiere', 'person', 'personen', 'gestalt', 'gestalten', 'jemand', 'etwas', 'gegenstand', 'gegenstände', 'objekt', 'waffe', 'sichtbar',
])

/** The system prompt. The categories are the details raters failed on sintel-90-210 (g9), each with its real example. */
export function verifySystemPrompt(language: 'en' | 'de'): string {
  return [
    `You check audio description for blind and low-vision viewers against the frames of one film shot. The draft was written from these frames and may state details the frames do not show. Reply in ${language === 'de' ? 'German' : 'English'}.`,
    'Check every detail of the draft against the frames, one at a time:',
    '- colours, including hair colour;',
    '- where on the body something is (shoulder, chest, arm, hand);',
    '- what a creature, animal or object is (a bat or a small dragon, a staff or a sword, a book or an animal);',
    '- the direction of movement, as seen on screen (left or right);',
    '- the eyes: open or closed, and whether they open or close during the frames;',
    '- who holds, gives, takes or does what;',
    '- place: "nearby", "beside" or "then" across a cut to a different place;',
    '- movement or change (mist swirling, a face beneath a surface) that the frames do not show.',
    'Delete every detail that is not clearly visible in the frames. If a word is wrong but the thing is there, you may replace it with one of these general words only: creature, animal, person, figure, object, weapon, someone, something. Prefer deleting to guessing.',
    'Never add a fact: no new colour, direction, body part, object, action or name, and no word the draft does not have, except those general words and "visible".',
    'Keep every on-screen text clause (starting "Words appear:") exactly as written, word for word. Keep names exactly as the draft wrote them.',
    'Write complete present-tense sentences with a verb, never a list of nouns. To turn a list of nouns into a sentence, add only "is", "are", "has", "with", "there is" or "is visible".',
    'Use no more words than the draft. If every detail is visible, return the draft unchanged.',
    'Reply with JSON only, no other text: {"text": "<the checked description>", "removed": ["<each detail you deleted or replaced, as the draft wrote it>"]}',
  ].join('\n')
}

/** The user turn's text, after the frames. */
export const verifyUserText = (draft: string) =>
  `These are frames from one shot, in time order. Draft description: "${draft.replace(/"/g, '\\"')}" Check it against the frames.`
