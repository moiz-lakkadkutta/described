import { contentWords, stem } from './contentWords'
import { placeStems, placeWordStems, type Glossary } from './glossary'
import { keepsAction, originalVerbs } from './sentenceGuard'
import { sentences, textSpans } from './textClause'
import type { Scene } from './steps/04c-scenes'

/**
 * Where a scene is, as fit and the edit pass state it (DESC-029, docs/decisions/0012-characters-and-scenes.md; Netflix AD style guide
 * §1.2 "When/Where", §5.2 shot changes; DCMP "start generally"): state the place in a scene's first cue, then not again in that scene;
 * "Back in …" on a return to an earlier place.
 */

/**
 * Stems that name this scene's place: its label's place words and its glossary setting's name. Not the look: "A faint fire glows in a
 * stone pit." shares "fire" and "pit" with the tent's look but does not tell the viewer they are in a tent.
 */
export function sceneStems(scene: Pick<Scene, 'setting' | 'settingName'>, g: Glossary): Set<string> {
  const s = new Set(placeWordStems(scene.setting))
  const set = scene.settingName ? g.settings.find((x) => x.name === scene.settingName) : undefined
  if (set) for (const w of placeWordStems(set.name)) s.add(w)
  return s
}

/** A present-tense -s verb in house style that is not itself a place noun ("Fire glows." has one; "Snowy mountains." has none). */
const AFTER_NOUN_MARK = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'with', 'around', 'over', 'under', 'between', 'beside', 'near', 'behind', 'two', 'three', 'many', 'several', 'its', 'his', 'her', 'their'])
/** An -s word is a verb unless it opens the sentence, names a place, or follows an article, preposition, number or -ing / -ed modifier ("glowing panels"). */
const hasVerb = (u: string) => {
  const ws = u.replace(/[.!?…]+$/u, '').split(/\s+/).map((w) => w.toLowerCase().replace(/[^\p{L}'-]/gu, ''))
  return ws.some((w, i) => i > 0 && /^\p{Ll}+[^s]s$/u.test(w) && !placeStems(w).length && !AFTER_NOUN_MARK.has(ws[i - 1]!) && !/(?:ing|ed)$/.test(ws[i - 1]!)) || /\b(?:is|are)\b/iu.test(u)
}

/**
 * The text's opening setting statement: its first sentence when that is plain (not on-screen text), at most 5 words, verbless, and names
 * a place (PLACE_NOUNS or `stems`): "Snowy mountains.", "Dark room.", "Tent interior.", "Dim ship deck.". undefined otherwise.
 */
export function settingLead(text: string, stems: ReadonlySet<string> = new Set()): string | undefined {
  const first = sentences(text)[0]
  if (!first || textSpans(first).length || !/[.!?…]$/u.test(first.trim())) return undefined
  const ws = first.trim().split(/\s+/)
  if (ws.length > 5 || hasVerb(first) || !placeStems(first, stems).length) return undefined
  return first.trim()
}

/** Does `text` say where the scene is: a word of the scene's place (sceneStems), or an opening setting statement? */
export function statesPlace(text: string, stems: ReadonlySet<string>): boolean {
  const plain = textSpans(text).reduceRight((t, s) => t.slice(0, s.start) + ' ' + t.slice(s.end), text)
  return contentWords(plain).some((w) => stems.has(stem(w))) || !!settingLead(text, stems)
}

const withArticle = (label: string) => (/^(?:the|a|an)\s/iu.test(label) ? label.replace(/^\p{Lu}/u, (c) => c.toLowerCase()) : `the ${label}`)
/** The words fit adds to state a scene's place: "The tent." / "Tent interior.", or "Back in the tent." on a return. '' with no label. */
export function sceneLine(scene: Pick<Scene, 'setting' | 'returning'>): string {
  const label = scene.setting.trim().replace(/[.!?…]+$/u, '')
  if (!label) return ''
  return scene.returning ? `Back in ${withArticle(label)}.` : `${label[0]!.toUpperCase()}${label.slice(1)}.`
}

/** Place nouns said with "on" ("On a stone balcony", "On top of the bridge"), not "in". */
const ON_NOUNS = new Set(['balcony', 'rooftop', 'roof', 'top', 'deck', 'bridge', 'platform', 'stage', 'ledge', 'hill', 'hillside', 'mountainside', 'beach', 'field', 'shore', 'pier', 'dock', 'terrace', 'plain', 'island', 'battlefield', 'runway', 'walkway'])
/** Prepositions a label may already open with ("inside the tent"): the label is then the lead itself. */
const LEAD_PREPOSITIONS = new Set(['in', 'inside', 'on', 'at', 'under', 'near', 'by', 'outside', 'within', 'beside', 'behind', 'atop', 'above', 'below', 'beneath', 'into', 'onto', 'across', 'along', 'amid', 'among'])
/** Letters whose names start with a vowel sound: "an MRI room", "an FBI van", but "a UFO". */
const AN_LETTERS = /^[AEFHILMNORSX]/u
/**
 * "an" when the word starts with a vowel sound (by sound, not letter): "an hour glass", "an MRI room", "an old mill"; but "a European city
 * street", "a one-way street", "a unicorn", "a university". A small list plus the rule; a word it misjudges gets the letter's choice.
 */
export function takesAn(word: string): boolean {
  const w = word.replace(/[^\p{L}'-]/gu, '')
  if (/^\p{Lu}{2,}$/u.test(w)) return AN_LETTERS.test(w)
  const l = w.toLowerCase()
  if (/^(?:hour|honest|honou?r|heir)/u.test(l)) return true
  if (/^(?:eu|ewe|uni|use|usu|uti|ura|ure|uri|uro|ubiq|one|once)/u.test(l)) return false
  return /^[aeiou]/u.test(l)
}
/** How the scene's own descriptions write `word` (case-insensitive, whole word): 'lower' when any writes it in lower case, 'upper' when only capitalised, undefined when none has it. */
function writtenAs(word: string, texts: readonly string[]): 'lower' | 'upper' | undefined {
  const re = new RegExp(`(?<![\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'giu')
  let upper = false
  for (const t of texts) for (const m of t.matchAll(re)) { if (/^\p{Ll}/u.test(m[0])) return 'lower'; upper = true }
  return upper ? 'upper' : undefined
}
/**
 * The phrase that states a scene's place in front of an action (decision 0012, review round 3 g11 and its review): "In a cluttered tech
 * lab", "On a stone balcony", "In the tent", "Back in the lab", "In Sintel's village", "In the Oude Kerk", "On top of the bridge".
 * - Case: the label's first word is lower-cased only when the scene's own descriptions (`texts`) write it in lower case (Nova Lite writes
 *   labels sentence-case: tos-390-510-g11 voiced "In the Cluttered tech lab"); a glossary name or an all-capitals word stays. Without
 *   `texts`, a capitalised first word that is no name is lower-cased.
 * - A label that already opens with a preposition is the lead itself ("inside the tent" → "Inside the tent"; "Back inside the tent").
 * - Its own article is kept (a return says "the"). The head is the noun before "of" when there is one ("rooftop of the town" → "On the
 *   rooftop of the town"; "top of the bridge" → "On top of the bridge"), else the last word; "on" for a surface, else "in".
 * - Article: a possessive takes none after a proper noun ("In Sintel's village") and "the" otherwise ("In the dragon's lair"); a proper
 *   name of one word none ("In Paris"), of several "the" ("In the Oude Kerk"); "the" with "of", a single place noun, a glossary setting
 *   (`settingName`) or a return; none for a plural head ("In cathedral ruins"); else "a" / "an" by sound (takesAn).
 * undefined with no label.
 */
export function placeLead(scene: Pick<Scene, 'setting' | 'returning'> & { settingName?: string }, names: readonly string[] = [], texts: readonly string[] = []): string | undefined {
  const label = scene.setting.trim().replace(/[.!?…]+$/u, '')
  if (!label) return undefined
  const ws = label.split(/\s+/)
  const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}'-]/gu, '')
  const first = ws[0]!.replace(/[^\p{L}]/gu, '')
  const firstStem = ws[0]!.replace(/['’]s$/u, '').replace(/[^\p{L}]/gu, '')
  const keepCase = names.includes(firstStem) || /^\p{Lu}{2,}$/u.test(first) || (texts.length > 0 && writtenAs(firstStem, texts) !== 'lower')
  if (!keepCase) ws[0] = ws[0]!.replace(/^\p{Lu}(?=\p{Ll}|[^\p{L}]|$)/u, (c) => c.toLowerCase())
  if (LEAD_PREPOSITIONS.has(bare(ws[0]!))) {
    const rest = [bare(ws[0]!), ...ws.slice(1)].join(' ')
    return scene.returning ? `Back ${rest}` : `${rest[0]!.toUpperCase()}${rest.slice(1)}`
  }
  const of = ws.findIndex((w, i) => i > 0 && bare(w) === 'of')
  const head = bare(ws[of > 0 ? of - 1 : ws.length - 1]!)
  const prep = ON_NOUNS.has(head) ? 'on' : 'in'
  const lead = scene.returning ? `Back ${prep}` : `${prep[0]!.toUpperCase()}${prep.slice(1)}`
  if (/^(?:the|a|an)$/iu.test(ws[0]!)) return `${lead} ${scene.returning || /^the$/iu.test(ws[0]!) ? ['the', ...ws.slice(1)].join(' ') : [ws[0]!.toLowerCase(), ...ws.slice(1)].join(' ')}`
  const proper = (w: string) => /^\p{Lu}/u.test(w)
  const words = ws.slice(0, of > 0 ? of : ws.length)
  const possessive = words.findIndex((w) => /\p{L}(?:['’]s|s['’])$/u.test(w))
  const plural = /[^su]s$/u.test(head) && !/(?:ss|us|is)$/u.test(head)
  let article: string
  if (of > 0) article = head === 'top' ? '' : 'the'
  else if (possessive >= 0) article = proper(words[possessive]!) ? '' : 'the'
  else if (words.every(proper)) article = words.length === 1 ? '' : 'the'
  else if (scene.returning || scene.settingName || ws.length === 1) article = 'the'
  else if (plural) article = ''
  else article = takesAn(ws[0]!) ? 'an' : 'a'
  return [lead, article, ws.join(' ')].filter(Boolean).join(' ')
}

/**
 * The scene's place merged into one sentence with the action (decision 0012 amendment, 2026-10-15): "In the tent, a faint fire glows in a
 * stone pit."; "Back in the lab, Thom runs." on a return. A place is never a cue on its own: g10's "The tent." pause and four "In the
 * tent." cues were failed by all three raters. The first word of the action is lower-cased unless it is a name: one of `names` (the
 * glossary's), all capitals, or capitalised again later in the action ("Man in glasses stares" → "In the lab, man in glasses stares").
 * An action that already says the place (a word of the label's places, statesPlace) comes back as it is: no lead, the place said once
 * (review round 3: tos-390-510-g11 "In the Cluttered tech lab, man … in a cluttered tech lab."). The lead is placeLead's (`texts`: the
 * scene's own descriptions, for its case).
 * undefined when there is no label, no action (no verb of its own), or the action opens with on-screen text.
 */
export function withPlace(scene: Pick<Scene, 'setting' | 'returning'> & { settingName?: string }, action: string, names: readonly string[] = [], texts: readonly string[] = []): string | undefined {
  const lead = placeLead(scene, names, texts)
  const a = action.trim()
  const first = sentences(a)[0] ?? a
  if (!lead || !a || textSpans(a).some((s) => s.start === 0) || !(hasVerb(first) || !keepsAction(first, ''))) return undefined
  const stems = new Set(placeWordStems(scene.setting))
  if (scene.settingName) for (const w of placeWordStems(scene.settingName)) stems.add(w)
  if (statesPlace(a, new Set([...stems].filter((w) => placeStems(w).length)))) return a
  const word = a.split(/\s+/)[0]!.replace(/[^\p{L}]/gu, '')
  const name = names.includes(word) || /^\p{Lu}{2,}$/u.test(word) || new RegExp(`[^.!?…]\\s${word}\\b`, 'u').test(a)
  const body = name ? a : a.replace(/^\p{Lu}/u, (c) => c.toLowerCase())
  return `${lead}, ${body}`
}

/** Light, time and condition words: what a label must not be alone ("darkness", "dim", "night"). */
const CONDITION_WORDS = new Set(['darkness', 'dark', 'dim', 'light', 'bright', 'night', 'day', 'dawn', 'dusk', 'shadow', 'shadows', 'gloom', 'mist', 'fog', 'haze', 'smoke', 'black', 'blackness', 'outdoors', 'indoors'])
/**
 * Why a scene label is not a place noun phrase (04c finishScenes, decision 0012 amendment of 2026-10-15), or undefined: it names a place
 * (PLACE_NOUNS or the glossary's setting words, `extra`), has no verb, and is not only light, time or condition words. g10 scene 3 was
 * labelled "darkness" (Nova Lite's label, grounded only in shot 14's own "Darkness."), and voiced over a sunlit walled town;
 * tos-390-510-g10 had "towering", "Boy faces giant robot" and "Man with cybernetic eye" as places.
 */
export function placeLabelProblem(label: string, extra: ReadonlySet<string> = new Set()): string | undefined {
  const t = label.trim().replace(/[.!?…]+$/u, '')
  if (!t) return 'empty'
  const cw = contentWords(t)
  if (cw.length && cw.every((w) => CONDITION_WORDS.has(w))) return `a condition, not a place: ${t}`
  if (!placeStems(t, extra).length) return `no place noun: ${t}`
  if (hasVerb(`${t}.`) || !keepsAction(`${t}.`, '')) return `a verb, not a place: ${t}`
  return undefined
}

const PHRASE_PREPOSITIONS = new Set(['in', 'inside', 'at', 'on', 'into', 'within', 'outside', 'near', 'by', 'beside', 'behind'])
const PHRASE_ARTICLES = new Set(['the', 'a', 'an', 'his', 'her', 'their', 'its'])
const bareOf = (w: string) => w.toLowerCase().replace(/[^\p{L}'-]/gu, '')
/**
 * `text` without its place phrases ("inside the tent", "In the tent,", "back in the town") whose head place noun (PLACE_NOUNS, not an -ing
 * / -ed form) is in `drop` (stems), punctuation and capitals mended. `atStartOnly` removes only a phrase that opens the text. Pure.
 */
export function withoutPlacePhrases(text: string, drop: ReadonlySet<string>, atStartOnly = false): string {
  if (!drop.size) return text
  const ws = text.trim().split(/\s+/)
  const out: string[] = []
  for (let i = 0; i < ws.length; i++) {
    const startOfSentence = i === 0 || /[.!?…]$/.test(ws[i - 1]!)
    let j = i
    if (bareOf(ws[j]!) === 'back' && bareOf(ws[j + 1] ?? '') === 'in') j++
    const prep = PHRASE_PREPOSITIONS.has(bareOf(ws[j]!)) && !/[,;:.!?…]$/.test(ws[j]!)
    let head = -1
    if (prep && (!atStartOnly || i === 0)) {
      let k = j + 1
      if (PHRASE_ARTICLES.has(bareOf(ws[k] ?? '')) && !/[,;:.!?…]$/.test(ws[k]!)) k++
      for (let n = 0; n < 3 && k < ws.length; n++, k++) {
        const b = bareOf(ws[k]!)
        if (placeStems(b).length) { if (drop.has(stem(b))) head = k; break }
        if (/[,;:.!?…]$/.test(ws[k]!)) break
      }
    }
    if (head < 0) { out.push(ws[i]!); continue }
    const end = ws[head]!.match(/[,;:.!?…]+$/)?.[0] ?? ''
    if (/[.!?…]/.test(end)) { if (out.length) out[out.length - 1] = out.at(-1)!.replace(/[,;:]$/, '') + end.replace(/^[,;:]+/, '') }
    else if (out.length && /,$/.test(out.at(-1)!) && (end || ws[head + 1] === undefined)) out[out.length - 1] = out.at(-1)!.replace(/,$/, '') // "A woman, in the tent, smiles." -> "A woman smiles."
    if (startOfSentence && ws[head + 1]) ws[head + 1] = ws[head + 1]!.replace(/^\p{Ll}/u, (c) => c.toUpperCase())
    i = head
  }
  return out.join(' ').replace(/,\s*$/, '').trim()
}

/**
 * `text` without a trailing verbless clause that names a place in `drop` (stems), after a comma or semicolon at the end of a sentence:
 * "Old man speaks, dim tent." → "Old man speaks." once the scene's place was said (decision 0012, review round 3 g11: Sintel shot 12 was
 * shortened to "Man speaks, tent."). A clause with a verb, a sentence that is only the place (settingLead's case) and other places stay. Pure.
 */
export function withoutTrailingPlace(text: string, drop: ReadonlySet<string>): string {
  if (!drop.size) return text
  return sentences(text).map((u) => {
    const m = /^(.*\S)[,;]\s+([^,;]+)$/u.exec(u.trim())
    if (!m || textSpans(u).length) return u.trim()
    const clause = m[2]!
    const verbs = new Set(originalVerbs(u)) // judged in its sentence: "…, climbs a wall in the town." has a verb
    if (clause.split(/\s+/).some((w) => verbs.has(w.toLowerCase().replace(/[^\p{L}'-]/gu, ''))) || !placeStems(clause).some((w) => drop.has(w))) return u.trim()
    return `${m[1]!}${/[.!?…]$/u.exec(clause.trim())?.[0] ?? '.'}`
  }).join(' ')
}

/**
 * The place stems of the other scenes' places that this scene does not share (labels and glossary setting names, PLACE_NOUNS only):
 * the places a description of this scene must not carry (decision 0012 amendment, 2026-10-15). g10 shot 28, in the town scene: "… holds a
 * small tan creature inside the tent" — the describer took "the tent" from the glossary's places; the raters saw a stone den. Empty when
 * this scene has no label (nothing to judge against).
 */
export function foreignPlaceStems(scene: Pick<Scene, 'id' | 'setting' | 'settingName'>, scenes: readonly Pick<Scene, 'id' | 'setting' | 'settingName'>[], g: Glossary): Set<string> {
  const own = sceneStems(scene, g)
  if (!own.size) return new Set()
  const out = new Set<string>()
  for (const sc of scenes) if (sc.id !== scene.id) for (const w of sceneStems(sc, g)) out.add(w)
  for (const s of g.settings) for (const w of placeWordStems(s.name)) out.add(w)
  return new Set([...out].filter((w) => !own.has(w) && placeStems(w).length))
}

/**
 * Is the scene's place established enough to be said over this shot (decision 0012 amendment, 2026-10-15)? A glossary setting, or the
 * label's place words in this shot's own description or in at least two of the scene's shot descriptions. A label taken from one later
 * shot of the scene is not said over another: tos-390-510-g10 (no glossary) would otherwise have put "In the tower," over a man aiming a
 * rifle, from shot 13's clock tower.
 */
export function placeKnown(scene: Pick<Scene, 'setting' | 'settingName' | 'shots'>, shotIndex: number, shots: readonly { index: number; description: string }[]): boolean {
  if (scene.settingName) return true
  const stems = new Set(placeStems(scene.setting))
  if (!stems.size) return false
  const has = (d: string) => placeStems(d).some((w) => stems.has(w))
  const own = shots.find((s) => s.index === shotIndex)
  if (own && has(own.description)) return true
  return shots.filter((s) => scene.shots.includes(s.index) && has(s.description)).length >= 2
}
