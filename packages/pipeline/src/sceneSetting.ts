import { contentWords, stem } from './contentWords'
import { placeStems, placeWordStems, type Glossary } from './glossary'
import { keepsAction } from './sentenceGuard'
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

/**
 * The scene's place merged into one sentence with the action (decision 0012 amendment, 2026-10-15): "In the tent, a faint fire glows in a
 * stone pit."; "Back in the lab, Thom runs." on a return. A place is never a cue on its own: g10's "The tent." pause and four "In the
 * tent." cues were failed by all three raters. The first word of the action is lower-cased unless it is a name: one of `names` (the
 * glossary's), all capitals, or capitalised again later in the action ("Man in glasses stares" → "In the lab, man in glasses stares"). undefined when there is no label, no action (no verb of its own), or the action opens with on-screen text.
 */
export function withPlace(scene: Pick<Scene, 'setting' | 'returning'>, action: string, names: readonly string[] = []): string | undefined {
  const label = scene.setting.trim().replace(/[.!?…]+$/u, '')
  const a = action.trim()
  const lead = sentences(a)[0] ?? a
  if (!label || !a || textSpans(a).some((s) => s.start === 0) || !(hasVerb(lead) || !keepsAction(lead, ''))) return undefined
  const first = a.split(/\s+/)[0]!.replace(/[^\p{L}]/gu, '')
  const name = names.includes(first) || /^\p{Lu}{2,}$/u.test(first) || new RegExp(`[^.!?…]\\s${first}\\b`, 'u').test(a)
  const body = name ? a : a.replace(/^\p{Lu}/u, (c) => c.toLowerCase())
  return `${scene.returning ? 'Back in' : 'In'} ${withArticle(label)}, ${body}`
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
