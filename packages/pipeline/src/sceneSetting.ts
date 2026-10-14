import { contentWords, stem } from './contentWords'
import { placeStems, placeWordStems, type Glossary } from './glossary'
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
const hasVerb = (u: string) => u.replace(/[.!?…]+$/u, '').split(/\s+/).some((w, i) => i > 0 && /^\p{Ll}+[^s]s[,;]?$/u.test(w) && !placeStems(w).length) || /\b(?:is|are)\b/iu.test(u)

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
