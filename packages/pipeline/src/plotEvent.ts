import { contentWords, STOP, stem } from './contentWords'
import { sentences, textSpans } from './textClause'

/**
 * Plot events in a description (DESC-020, human-approved 2026-10-10; docs/decisions/0007-dropped-events.md). A shot that fit cannot
 * place — or whose clip 06-voice would drop — becomes an extended cue (a pause, Extended mode only) when its description carries a
 * NEW PLOT EVENT: a new action by a person or creature, an object handed over, someone arriving, falling, kneeling. Not a setting,
 * the light, or an expression.
 *
 * Deterministic, in house style (a present-tense line, subject first — "Red-haired girl accepts bowl."). Each sentence is cut into
 * clauses (at , ; and "then"); in each clause the verb is the FIRST word ending in -s after the subject (a content word before it; a
 * clause after the first of its sentence may carry the subject over: "A figure walks, falls."). Not a verb: a stop word (is, has, this),
 * a word ending in -ss, -us, -ous or -is (dress, cross, plus, nervous, his), and a few -s function words (across, towards, always …).
 * A later -s word in the clause is never the verb, so a plural object (drinks, cuts, lights, signs) does not count. The clause is a new
 * plot event when that verb's stem is in ACTION_VERBS and
 * - the previous voiced cue did not say that verb (by stem): "climbs brick rooftop" after "climbs stone steps" is not a new event;
 * - the sentence has no expression or reflection word (eyes, mouth, brow, expression, smile, face, reflection …): "opens eyes" is a
 *   look, "a veiled face emerges from the milk" a reflection, not an act;
 * - no word before the verb is a setting or light noun: "Dawn breaks over city" is the light changing, not an event;
 * - a flying verb (flies, soars, drifts, circles, hovers) is not over scenery: "A bird flies over the lake" is the setting, "A dragon
 *   flies over the city" an event — the scenery nouns (SCENERY) are the sky, weather, water and open land, not places people are in;
 * - "hands" is a verb only before her / him / them / his / a / the / it / me / us / you / over / back ("hands her a cup"; "Two hands
 *   hold a bowl" has hands as its subject);
 * - it is not an on-screen text clause ("Words appear: …" is on-screen text, not an action — and has its own rule, introducesNew).
 * Only -s forms count (the finite verb of a house-style line): in "Red-haired girl watches man stir pot" the bare "stir" is what she
 * watches, and watching is not a plot event. The list leaves out verbs that are states or postures (holds, stands, sits, leans, wears),
 * looks and expressions (stares, watches, blinks, smiles, nods), sounds the film itself carries (speaks, roars, screams), camera and
 * light verbs (fades, glows), and verbs whose plural noun is common in descriptions (steps, waves, blocks).
 * On sintel-90-210 run A2 (`test/sintel-210.test.ts`): shots 8 "Red-haired girl accepts bowl." and 24 "Red-haired woman kneels beside
 * bleeding creature on cobblestones." are events; 5 (watches … stir), 6 (blinks, expression), 9 "Tent glows.", 10 (opens eyes),
 * 11 (hands hold … face rises), 23 (stares), 27 (smiles. roars), 28 (holds book) are not.
 */
const ACTION_BASES = [
  // handing over, taking, giving
  'accept', 'take', 'grab', 'grasp', 'seize', 'snatch', 'catch', 'give', 'pass', 'offer', 'receive', 'exchange', 'steal', 'pay', 'hand',
  // lifting, moving objects
  'lift', 'raise', 'lower', 'pick', 'pull', 'push', 'drop', 'throw', 'toss', 'hurl', 'fling', 'drag', 'haul', 'hoist', 'heave', 'carry',
  'place', 'put', 'set', 'lay', 'press', 'squeeze', 'load', 'unload', 'cover', 'uncover', 'remove', 'wrap', 'unwrap', 'tie', 'untie', 'bind', 'free', 'release',
  // the body: falling, kneeling, arriving, leaving, moving
  'kneel', 'fall', 'collapse', 'stumble', 'tumble', 'trip', 'climb', 'descend', 'ascend', 'run', 'walk', 'jump', 'leap', 'vault', 'cross',
  'enter', 'leave', 'exit', 'arrive', 'depart', 'return', 'flee', 'escape', 'chase', 'follow', 'approach', 'sprint', 'dash', 'rush', 'hurry',
  'stride', 'march', 'limp', 'stagger', 'gallop', 'wade', 'swim', 'crawl', 'slide', 'slip', 'sink', 'drown', 'ride', 'mount', 'dismount', 'land', 'dive',
  'fly', 'soar', 'glide', 'drift', 'circle', 'hover', 'swoop',
  'appear', 'emerge', 'vanish', 'disappear', 'hide', 'wake', 'die', 'stop',
  // acting on things and others
  'open', 'close', 'shut', 'lock', 'unlock', 'knock', 'pound', 'pour', 'stir', 'cook', 'eat', 'drink', 'feed', 'wash', 'dress', 'write', 'sign', 'search', 'find', 'discover',
  'cut', 'slice', 'stab', 'strike', 'hit', 'punch', 'kick', 'slap', 'attack', 'charge', 'swing', 'draw', 'sheathe', 'shoot', 'aim', 'fight', 'wrestle', 'dodge', 'kill',
  'reach', 'touch', 'embrace', 'hug', 'kiss', 'bite', 'break', 'smash', 'shatter', 'rip', 'pierce', 'explode', 'crash', 'light', 'extinguish', 'dig', 'bury', 'bow', 'point', 'spread',
]
/** How many verbs ACTION_VERBS was built from (quoted in the decision note). */
export const ACTION_BASE_COUNT = ACTION_BASES.length
const finiteStems = (bases: readonly string[]) => new Set(bases.flatMap((b) => [b, `${b}s`, `${b}es`, b.replace(/y$/, 'ies')].map(stem)))
/** Stems of the action verbs' finite forms: "accepts" → accept, "reaches" → reach, "carries" → carri, "dies" → di (Porter stems the -s form, not the base). */
export const ACTION_VERBS = finiteStems(ACTION_BASES)
/** Verbs of flight; over scenery (a SCENERY word after the verb) they describe the setting, not an act. */
const AIR = finiteStems(['fly', 'soar', 'glide', 'drift', 'circle', 'hover'])
const HANDS = stem('hands')
/** "hands" is the verb only before one of these: whom or what it is handed to. */
const HANDS_TO = new Set(['her', 'him', 'them', 'his', 'a', 'an', 'the', 'it', 'me', 'us', 'you', 'over', 'back'])
/** A sentence about one of these is a look, an expression or a reflection, whatever its verb ("opens eyes", "lowers head", "a face appears in the bowl"). */
export const EXPRESSION_WORDS = new Set(['eye', 'eyes', 'eyelid', 'eyelids', 'mouth', 'lip', 'lips', 'brow', 'brows', 'eyebrow', 'eyebrows', 'expression', 'gaze', 'tear', 'tears', 'smile', 'frown', 'grin', 'head',
  'face', 'faces', 'reflection', 'reflections', 'cheek', 'cheeks', 'nose', 'forehead', 'chin', 'jaw', 'features', 'visage'].map(stem))
/** A verb whose subject is one of these is the setting or the light changing, not an act ("Dawn breaks", "Snow falls", "The logo appears"). */
export const SETTING_SUBJECTS = new Set(['dawn', 'dusk', 'night', 'day', 'morning', 'evening', 'sun', 'sunlight', 'moon', 'light', 'lights', 'fire', 'flame', 'flames', 'smoke', 'snow', 'rain', 'wind', 'water', 'wave', 'waves',
  'darkness', 'dark', 'sky', 'cloud', 'clouds', 'fog', 'mist', 'shadow', 'shadows', 'dust', 'ash', 'ashes', 'spark', 'sparks', 'leaf', 'leaves', 'logo', 'title', 'text', 'words', 'letters', 'credits', 'screen', 'image', 'scene', 'camera'].map(stem))
/** Open land, water and sky: flight over these is scenery. Not places people are in (city, room, street, courtyard, roof). */
export const SCENERY = new Set(['sky', 'skies', 'cloud', 'clouds', 'horizon', 'sun', 'moon', 'stars', 'water', 'lake', 'lakes', 'river', 'rivers', 'sea', 'ocean', 'pond', 'waves', 'shore', 'coast', 'hills', 'mountains', 'peaks', 'valley', 'valleys',
  'forest', 'forests', 'woods', 'trees', 'treetops', 'field', 'fields', 'meadow', 'meadows', 'plain', 'plains', 'desert', 'snow', 'ice', 'glacier', 'canyon'].map(stem))
/** -s words that are never a verb, beyond the stop list and the -ss / -us / -ous / -is endings. */
const NOT_VERBS = new Set(['across', 'towards', 'perhaps', 'always', 'sometimes', 'yes', 'less', 'unless', 'hers', 'ours', 'theirs', 'yours', 'whereas', 'besides', 'upstairs', 'downstairs', 'backwards', 'forwards', 'sideways'])

const isTextClause = (unit: string) => textSpans(unit).some((s) => s.start === 0)
/** The words of a clause, lower-cased, punctuation stripped, stop words kept (the verb's position and what follows "hands" need them). */
const tokens = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).map((w) => w.replace(/^['-]+|['-]+$/g, '')).filter(Boolean)
/** A house-style finite verb form: ends in -s, is not a stop or function word, not -ss / -us / -is (which covers -ous). */
const finite = (w: string) => /^\p{L}[\p{L}'-]*s$/u.test(w) && !STOP.has(w) && !NOT_VERBS.has(w) && !/(ss|us|is)$/.test(w)
const CLAUSE = /\s*[,;]\s*|\s+then\s+/i

/**
 * The finite action verbs of `text` (surface forms, in order, at most one per clause) that make it a new plot event after `previous`,
 * the previous voiced cue ('' when none); [] when it carries none. See the module comment for the rule.
 */
export function plotEvents(text: string, previous: string): string[] {
  const said = new Set(contentWords(previous).map(stem))
  const out: string[] = []
  for (const unit of sentences(text)) {
    if (isTextClause(unit)) continue
    if (contentWords(unit).some((w) => EXPRESSION_WORDS.has(stem(w)))) continue
    for (const [n, clause] of unit.split(CLAUSE).entries()) {
      const words = tokens(clause)
      const k = words.findIndex(finite)
      if (k < 0) continue
      const subject = words.slice(0, k).filter((w) => !STOP.has(w))
      if (!subject.length && n === 0) continue // no subject before the verb (a later clause carries its sentence's subject over)
      if (subject.some((w) => SETTING_SUBJECTS.has(stem(w)))) continue
      const verb = words[k]!, s = stem(verb)
      if (!ACTION_VERBS.has(s) || said.has(s)) continue
      if (s === HANDS && !HANDS_TO.has(words[k + 1] ?? '')) continue
      if (AIR.has(s) && words.slice(k + 1).some((w) => SCENERY.has(stem(w)))) continue
      out.push(verb)
    }
  }
  return out
}
/** Does `text` carry a new plot event after `previous`? */
export const plotEvent = (text: string, previous: string) => plotEvents(text, previous).length > 0

/**
 * How many content words of `text` the previous voiced cue did not say — the tie-break when two event shots compete for one 30 s window
 * (plotEvents' count first; then this; then the earlier shot).
 */
export const newWords = (text: string, previous: string) => { const said = new Set(contentWords(previous).map(stem)); return new Set(contentWords(text).map(stem).filter((s) => !said.has(s))).size }

/** Cap (human, 2026-10-10): at most one added event cue per 30 s of title time — no two of them start within this of each other. */
export const EVENT_SPACING_MS = 30_000
/** Is a new event cue at `startMs` far enough from every event cue in `starts`? */
export const eventSpaced = (starts: readonly number[], startMs: number) => starts.every((s) => Math.abs(s - startMs) >= EVENT_SPACING_MS)
