import { contentWords, stem } from './contentWords'
import { sentences, textSpans } from './textClause'

/**
 * Plot events in a description (DESC-020, human-approved 2026-10-10; docs/decisions/0007-dropped-events.md). A shot that fit cannot
 * place — or whose clip 06-voice would drop — becomes an extended cue (a pause, Extended mode only) when its description carries a
 * NEW PLOT EVENT: a new action by a person or creature, an object handed over, someone arriving, falling, kneeling. Not a setting,
 * the light, or an expression.
 *
 * Deterministic, in house style (a present-tense line, subject first — "Red-haired girl accepts bowl."). A sentence carries a new
 * plot event when it has a finite action verb: a word ending in -s whose stem is in ACTION_VERBS, with at least one content word
 * (its subject) before it, and
 * - the previous voiced cue did not say that verb (by stem): "climbs brick rooftop" after "climbs stone steps" is not a new event;
 * - the sentence has no expression word (eyes, mouth, brow, expression, smile …): "opens eyes" is a look, not an act;
 * - no word before the verb is a setting or light noun: "Dawn breaks over city" is the light changing, not an event;
 * - it is not an on-screen text clause ("Words appear: …" is on-screen text, not an action — and has its own rule, introducesNew).
 * Only -s forms count (the finite verb of a house-style line): in "Red-haired girl watches man stir pot" the bare "stir" is what she
 * watches, and watching is not a plot event. The list leaves out verbs that are states or postures (holds, stands, sits, leans, wears),
 * looks and expressions (stares, watches, blinks, smiles, nods), sounds the film itself carries (speaks, roars, screams), camera and
 * light verbs (fades, glows, appears only with a non-setting subject), and verbs whose plural noun is common in descriptions (hands,
 * steps, waves, blocks).
 * On sintel-90-210 run A2 (`test/sintel-210.test.ts`): shots 8 "Red-haired girl accepts bowl." and 24 "Red-haired woman kneels beside
 * bleeding creature on cobblestones." are events; 5 (watches … stir), 6 (blinks, expression), 9 "Tent glows.", 10 (opens eyes),
 * 11 (hands hold … face rises), 23 (stares), 27 (smiles. roars), 28 (holds book) are not.
 */
const ACTION_BASES = [
  // handing over, taking, giving
  'accept', 'take', 'grab', 'grasp', 'seize', 'snatch', 'catch', 'give', 'pass', 'offer', 'receive', 'exchange', 'steal', 'pay',
  // lifting, moving objects
  'lift', 'raise', 'lower', 'pick', 'pull', 'push', 'drop', 'throw', 'toss', 'hurl', 'fling', 'drag', 'haul', 'hoist', 'heave', 'carry',
  'place', 'put', 'set', 'lay', 'press', 'squeeze', 'load', 'unload', 'cover', 'uncover', 'remove', 'wrap', 'unwrap', 'tie', 'untie', 'bind', 'free', 'release',
  // the body: falling, kneeling, arriving, leaving, moving
  'kneel', 'fall', 'collapse', 'stumble', 'tumble', 'trip', 'climb', 'descend', 'ascend', 'run', 'walk', 'jump', 'leap', 'vault', 'cross',
  'enter', 'leave', 'exit', 'arrive', 'depart', 'return', 'flee', 'escape', 'chase', 'follow', 'approach', 'sprint', 'dash', 'rush', 'hurry',
  'stride', 'march', 'limp', 'stagger', 'gallop', 'wade', 'swim', 'crawl', 'slide', 'slip', 'sink', 'drown', 'ride', 'mount', 'dismount', 'fly', 'land', 'dive',
  'appear', 'emerge', 'vanish', 'disappear', 'hide', 'wake', 'die', 'stop',
  // acting on things and others
  'open', 'close', 'shut', 'lock', 'unlock', 'knock', 'pound', 'pour', 'stir', 'cook', 'eat', 'drink', 'feed', 'wash', 'dress', 'write', 'sign', 'search', 'find', 'discover',
  'cut', 'slice', 'stab', 'strike', 'hit', 'punch', 'kick', 'slap', 'attack', 'charge', 'swing', 'draw', 'sheathe', 'shoot', 'aim', 'fight', 'wrestle', 'dodge', 'kill',
  'reach', 'touch', 'embrace', 'hug', 'kiss', 'bite', 'break', 'smash', 'shatter', 'rip', 'pierce', 'explode', 'crash', 'light', 'extinguish', 'dig', 'bury', 'bow', 'point', 'spread',
]
/** Stems of the action verbs' finite forms: "accepts" → accept, "reaches" → reach, "carries" → carri, "dies" → di (Porter stems the -s form, not the base). */
export const ACTION_VERBS = new Set(ACTION_BASES.flatMap((b) => [b, `${b}s`, `${b}es`, b.replace(/y$/, 'ies')].map(stem)))
/** A sentence about one of these is a look or an expression, whatever its verb ("opens eyes", "lowers head", "a tear falls"). */
export const EXPRESSION_WORDS = new Set(['eye', 'eyes', 'eyelid', 'eyelids', 'mouth', 'lip', 'lips', 'brow', 'brows', 'eyebrow', 'eyebrows', 'expression', 'gaze', 'tear', 'tears', 'smile', 'frown', 'grin', 'head'].map(stem))
/** A verb whose subject is one of these is the setting or the light changing, not an act ("Dawn breaks", "Snow falls", "The logo appears"). */
export const SETTING_SUBJECTS = new Set(['dawn', 'dusk', 'night', 'day', 'morning', 'evening', 'sun', 'sunlight', 'moon', 'light', 'lights', 'fire', 'flame', 'flames', 'smoke', 'snow', 'rain', 'wind', 'water', 'wave', 'waves',
  'darkness', 'dark', 'sky', 'cloud', 'clouds', 'fog', 'mist', 'shadow', 'shadows', 'dust', 'ash', 'ashes', 'spark', 'sparks', 'leaf', 'leaves', 'logo', 'title', 'text', 'words', 'letters', 'credits', 'screen', 'image', 'scene', 'camera'].map(stem))

const isTextClause = (unit: string) => textSpans(unit).some((s) => s.start === 0)
const finite = (w: string) => /^\p{L}[\p{L}'-]*s$/u.test(w)

/**
 * The finite action verbs of `text` (surface forms, in order) that make it a new plot event after `previous`, the previous voiced cue
 * ('' when none); [] when it carries none. See the module comment for the rule.
 */
export function plotEvents(text: string, previous: string): string[] {
  const said = new Set(contentWords(previous).map(stem))
  const out: string[] = []
  for (const unit of sentences(text)) {
    if (isTextClause(unit)) continue
    const words = contentWords(unit)
    if (words.some((w) => EXPRESSION_WORDS.has(stem(w)))) continue
    for (let k = 1; k < words.length; k++) {
      const w = words[k]!, s = stem(w)
      if (!finite(w) || !ACTION_VERBS.has(s) || said.has(s)) continue
      if (words.slice(0, k).some((x) => SETTING_SUBJECTS.has(stem(x)))) continue
      out.push(w)
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
