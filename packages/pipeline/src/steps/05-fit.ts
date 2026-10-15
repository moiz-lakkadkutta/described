import { readFile, writeFile } from 'node:fs/promises'
import type { Ctx } from './index'
import type { Described } from './04-describe'
import type { Gap } from './03-speech'
import { clauseText, sentences, stripBareLead, stripDarkness, textSpans, withoutSpans } from '../textClause'
import { eventSpaced, newWords, plotEvents } from '../plotEvent'
import { keepsAction as keepsVerb, midPhrase, readsAsSentences } from '../sentenceGuard'
import { normalizeQuotes } from '../contentWords'
import { EMPTY_GLOSSARY, glossaryFor, type Glossary } from '../glossary'
import { foreignPlaceStems, placeKnown, sceneLine, sceneStems, settingLead, statesPlace, withoutPlacePhrases, withPlace } from '../sceneSetting'
import { freshScenes, sceneOf, type Scene } from './04c-scenes'

/**
 * endMs: fit's estimate (estimateClipMs: words / WPS + CLIP_OVERHEAD_MS) until 06-voice measures the Polly clip and rewrites it as startMs + clip duration (DESC-013).
 * limitMs: placed cues only — the end of the gap the cue was placed in, which the clip must not overrun (06-voice); absent on extended cues.
 * event: an extended cue added because its shot carries a new plot event and could not be placed (DESC-020, fit or 06-voice); these
 * count against the one-per-30 s cap — on-screen text cues and introducesNew cues do not.
 */
export interface FitCue { startMs: number; endMs: number; text: string; extended: boolean; wordCount: number; shotIndex: number; limitMs?: number; event?: true; /** a scene pause (DESC-029, scenePauses) */ scene?: true }
export const WPS = 160 / 60 // 2.67 words per second
/** The silence in a voiced clip besides its words (decision 0009; sintel-90-210-g8 clips: 3 words measure 1512–1800 ms). */
export const LEAD_BREAK_MS = 150 // 06-voice cueSsml's <break time="150ms"/>
export const LEAD_SILENCE_MS = 150 // Polly's own silence before the first word
export const TAIL_SILENCE_MS = 150 // after the last word (measured ~100 ms, up to ~150)
export const CLIP_OVERHEAD_MS = LEAD_BREAK_MS + LEAD_SILENCE_MS + TAIL_SILENCE_MS
/** fit's estimate of a clip's length: its words at WPS plus CLIP_OVERHEAD_MS. */
export const estimateClipMs = (wordCount: number) => Math.round((wordCount / WPS) * 1000) + CLIP_OVERHEAD_MS
/** The most words whose estimated clip fits in roomMs (the inverse of estimateClipMs; the epsilon keeps an exact fit). */
export const wordsThatFit = (roomMs: number) => Math.max(0, Math.floor(((roomMs - CLIP_OVERHEAD_MS) / 1000) * WPS + 1e-6))
/** A description may start up to 1 s after its shot ends, never later (Gate C, approved 2026-10-01). */
export const LATE_MS = 1000
/** Fewer words than this in a gap is no description; try the next gap in the window. */
const MIN_WORDS = 3

/**
 * Deterministic placement (tested with fixtures). Nova Lite is used only to *shorten* text that doesn't fit —
 * that call lives in ../prompts.shortenWithNovaLite and is injected so tests run without AWS.
 * Each shot scans the gaps in order for the first with ≥ MIN_WORDS of room starting in [shot start, shot end + LATE_MS];
 * describe *as* action occurs, never before. No room → an extended cue (≤ EXTENDED_WORDS) if introducesNew, else dropped.
 * On-screen text (human, 2026-10-10; PR #25 round 2): when no gap in the window fits the whole text — the shorteners keep the text
 * clause only beside at least half of the action's words — the rest (the action) is placed in the first gap it fits, and the text
 * clause becomes its own extended cue (splitText): TEXT_LEAD_MS before the action, never before the shot start or the end of the
 * previous placed cue; with no room for that lead, the action moves TEXT_LEAD_MS after the text cue when it still fits its gap.
 * Dropped events (DESC-020, human 2026-10-10): a shot with no room that carries a new plot event (../plotEvent: a finite action verb the
 * previous voiced cue did not say — "accepts bowl", "kneels beside…"; not a setting, light or expression) becomes an extended cue with
 * `event: true`, its own description capped like any extended cue — at most one per EVENT_SPACING_MS (capEvents: the most new action
 * verbs first). The plain AD track is unchanged: extended cues play only in Extended mode.
 * fitDescriptions passes safeShorten, so a model shortening that changes a fact or stops reading as sentences (DESC-028) falls back to
 * shortenDeterministic, and a deterministic one that stops reading as sentences to the unshortened text.
 */
export function fit(shots: Described[], gaps: Gap[], shorten: (text: string, maxWords: number) => Promise<string> | string, language: 'en' | 'de' = 'en', opts: FitOptions = {}): Promise<FitCue[]> | FitCue[] {
  const free = gaps.map((g) => ({ ...g, cursor: g.startMs }))
  const out: FitCue[] = []
  const events: EventCandidate[] = []
  const glossary = opts.glossary ?? EMPTY_GLOSSARY
  const opened = new Set<number>() // scenes whose first described shot has been placed (or tried)
  const names = glossary.characters.map((c) => c.name)
  const work = async () => {
    for (const s of shots.map((x) => ({ ...x, description: groundedDescription(x, opts.scenes, glossary) }))) {
      if (s.sameAsPrev || !s.description) continue
      // DESC-029: a scene's first described shot states where the scene is — its own opening setting sentence, protected from shortening,
      // or the scene's place merged into the action ("In the tent, a faint fire glows …", "Back in the lab, …") — when the words fit; an
      // event still outranks the setting, and a place is never a cue on its own (decision 0012 amendment, 2026-10-15).
      const scene = opts.scenes ? sceneOf(opts.scenes, s.index) : undefined
      const opening = scene && !opened.has(scene.id) ? scene : undefined
      if (scene) opened.add(scene.id)
      // Later in a scene whose place a cue has stated, the shot's own setting statement is not said again ("Snowy mountains." twice,
      // "Dark room." after "The tent. …"), nor its opening place phrase ("In the tent, an old man …" four times in g10); a shot that is
      // only that statement is not voiced.
      if (scene && !opening && out.some((c) => scene.shots.includes(c.shotIndex) && statesPlace(c.text, sceneStems(scene, glossary)))) {
        const stems = sceneStems(scene, glossary)
        const again = settingLead(s.description, stems)
        if (again) {
          const left = s.description.slice(s.description.indexOf(again) + again.length).trim()
          if (!left) continue
          s.description = left
        }
        s.description = withoutPlacePhrases(s.description, stems, true)
        if (!s.description) continue
      }
      const stems = opening ? sceneStems(opening, glossary) : undefined
      const ownLead = stems ? settingLead(s.description, stems) : undefined
      const rest = ownLead ? s.description.slice(s.description.indexOf(ownLead) + ownLead.length).trim() : s.description
      const merge = !ownLead && opening && !statesPlace(s.description, stems!) && placeKnown(opening, s.index, shots) ? (action: string) => withPlace(opening, action, names) : undefined
      /** The text with the scene's place in maxWords: the shot's own setting sentence beside the rest, or the place merged into the action; the rest shortened to the words left, its action kept. Never the place alone. */
      const withLead = async (maxWords: number) => {
        if (!ownLead && !merge) return undefined
        const full = ownLead ? (rest ? `${ownLead} ${rest}` : ownLead) : merge!(rest)
        if (full === undefined) return undefined
        if (words(full) <= maxWords) return full
        if (!rest) return undefined
        const room = maxWords - (ownLead ? words(ownLead) : words(full) - words(rest))
        if (room < 2) return undefined
        const r = await fitted(rest, room)
        if (r === undefined) return undefined
        const t = ownLead ? `${ownLead} ${r}` : merge!(r)
        return t !== undefined && words(t) <= maxWords ? t : undefined
      }
      /** The gaps in the shot's window with ≥ MIN_WORDS of room, in order, with where a cue would start in each. */
      const slots = () => {
        const r: Array<{ g: (typeof free)[number]; start: number; maxWords: number }> = []
        for (const g of free) {
          const start = Math.max(g.cursor, s.startMs)
          if (start >= g.endMs) continue // gap used up, or entirely before the shot
          if (start > s.endMs + LATE_MS) break // gaps are sorted; nothing later is on time (exactly LATE_MS late is allowed)
          const maxWords = wordsThatFit(g.endMs - start)
          if (maxWords >= MIN_WORDS) r.push({ g, start, maxWords })
        }
        return r
      }
      /** The text in maxWords: whole, or shortened keeping its action (a verb of the text, keepsVerb), else the next-best: one of its own sentences that has a verb, shortened under the same rules. */
      const fitted = async (text: string, maxWords: number) => {
        if (words(text) <= maxWords) return text
        const t = await shorten(text, maxWords)
        if (words(t) <= maxWords && keepsActionOf(text, t)) return t
        if (words(t) <= maxWords) console.warn('fit: shortening drops the shot\'s action, trying its sentences:', JSON.stringify(text), '→', JSON.stringify(t))
        return actionSentence(text, maxWords, language)
      }
      const place = (g: (typeof free)[number], start: number, text: string) => {
        const end = Math.min(g.endMs, start + estimateClipMs(words(text)))
        out.push({ startMs: start, endMs: end, text, extended: false, wordCount: words(text), shotIndex: s.index, limitMs: g.endMs })
        g.cursor = end + 150
      }
      let placed = false
      for (const { g, start, maxWords } of slots()) {
        const text = (await withLead(maxWords)) ?? await fitted(s.description, maxWords)
        if (text === undefined) continue
        place(g, start, text)
        placed = true
        break
      }
      const c = placed ? undefined : textClauses(s.description)
      if (c?.rest) for (const { g, start, maxWords } of slots()) {
        const text = await fitted(c.rest, maxWords)
        if (text === undefined) continue
        const prevEnd = Math.max(s.startMs, ...out.filter((x) => !x.extended && x.endMs <= start).map((x) => x.endMs))
        const { textStart, actionStart } = leadText(start, prevEnd, (later) => words(text) <= wordsThatFit(g.endMs - later))
        // an on-screen text clause is never cut (≤ MAX_TEXT_WORDS); should capExtended give no cue, the clause is used whole
        out.push({ ...extended(s), ...(await capExtended(c.clause, shorten, language)) ?? { text: c.clause, wordCount: words(c.clause) }, startMs: textStart, endMs: textStart + 100 })
        place(g, actionStart, text)
        placed = true
        break
      }
      if (placed) continue
      /**
       * A pause never starts before the estimated end of an earlier shot's placed cue (g9: shot 9's event pause inside shot 8's cue). It may
       * then start more than LATE_MS after its shot when that estimate runs long; 06-voice moves it to the measured end, earlier, and
       * applies the on-time rule there (decision 0012 amendment, 2026-10-15: g10 shots 19 and 24, tos-390-510-g10 shot 13).
       */
      const pause = (): FitCue => {
        const startMs = Math.max(s.startMs, ...out.filter((x) => !x.extended && x.shotIndex < s.index).map((x) => x.endMs))
        return { ...extended(s), startMs, endMs: startMs + 100 }
      }
      if (introducesNew(s.description)) { const capped = await capExtended(s.description, shorten, language); if (capped) out.push({ ...pause(), ...capped }); continue } // no cap that reads as sentences: dropped
      const previous = [...out].reverse().find((x) => !x.extended)?.text ?? '' // the previous placed cue: what the AD track said, whatever the mode
      const verbs = plotEvents(s.description, previous)
      const capped = verbs.length ? await capExtended(s.description, shorten, language) : undefined
      if (capped) events.push({ cue: { ...pause(), ...capped, event: true }, verbs: verbs.length, fresh: newWords(s.description, previous) })
    }
    const all = [...out, ...capEvents(events)]
    return (opts.scenes && opts.scenePauses !== false ? scenePauses(opts.scenes, all, glossary, shots.map((x) => ({ ...x, description: groundedDescription(x, opts.scenes, glossary) }))) : all).sort(byStart)
  }
  return work()
}

/** fit's scene inputs (DESC-029): the scene step's scenes (04c-scenes, scenes.json) and the title's glossary; scenePauses: false skips the scene pauses. */
export interface FitOptions { scenes?: readonly Scene[]; glossary?: Glossary; scenePauses?: boolean }
/** Scene pauses are at least this far apart: at most one per title-minute (Extended mode only, so the plain AD track is unchanged). */
export const SCENE_PAUSE_SPACING_MS = 60_000
/**
 * Extended mode only (DESC-029, amends 0007): a scene where no cue says where we are gets one pause with its place merged into the action
 * of the shot on screen there ("In the tent, a young woman blinks slowly."; "Back in the tent, …"), at the scene's start but never inside an
 * earlier shot's placed cue, at most one per SCENE_PAUSE_SPACING_MS, and only while the scene is still on screen. Its place words are the
 * scene's grounded label (04c-scenes). One pause, not two: when an event or other pause of the scene already starts there, the place is
 * merged into that pause (when it stays within EXTENDED_WORDS) instead.
 * Decision 0012 amendment (2026-10-15): a place is never a pause on its own (g10's "The tent." over a close-up, failed by all three
 * raters), and the shot under the pause has priority — its own description is what the pause says, with the place in front; when that
 * shot is already voiced, or has no action, or the two do not fit in EXTENDED_WORDS, there is no scene pause.
 * `shots`: the descriptions as fit read them (groundedDescription). Returns `cues` with the pauses added or merged.
 */
export function scenePauses(scenes: readonly Scene[], cues: readonly FitCue[], g: Glossary, shots: readonly Described[] = []): FitCue[] {
  const out = cues.map((c) => ({ ...c }))
  let last = -Infinity
  for (const sc of scenes) {
    if (!sceneLine(sc)) { const a = actionPause(sc, out, shots, last); if (a) { last = a.startMs; out.push(a) } continue }
    const stems = sceneStems(sc, g)
    if (out.some((c) => sc.shots.includes(c.shotIndex) && statesPlace(c.text, stems))) continue
    const startMs = Math.max(sc.startMs, ...out.filter((x) => !x.extended && x.shotIndex < sc.shots[0]!).map((x) => x.endMs))
    if (startMs >= sc.endMs || startMs - last < SCENE_PAUSE_SPACING_MS) continue
    const same = out.find((c) => c.extended && !textOnly(c) && c.startMs === startMs && sc.shots.includes(c.shotIndex))
    if (same) {
      const merged = (!shots.length || placeKnown(sc, same.shotIndex, shots)) ? withPlace(sc, same.text, g.characters.map((c) => c.name)) : undefined
      if (merged && words(merged) <= EXTENDED_WORDS) { last = startMs; same.text = merged; same.wordCount = words(merged); same.scene = true }
      continue
    }
    const under = shots.find((x) => sc.shots.includes(x.index) && x.startMs <= startMs && startMs < x.endMs)
    if (!under || under.sameAsPrev || !under.description || out.some((c) => c.shotIndex === under.index) || !placeKnown(sc, under.index, shots)) continue
    const action = textClauses(under.description) ? undefined : under.description
    const text = action && placedAction(sc, action, g.characters.map((c) => c.name))
    if (!text) continue
    last = startMs
    out.push({ startMs, endMs: startMs + 100, text, extended: true, wordCount: words(text), shotIndex: under.index, scene: true })
  }
  return out
}
/**
 * A scene with no place label but an action label (04c `action`: Nova Lite's "Man in glasses shouts", grounded, naming no place) keeps the
 * pause it had before the decision 0012 amendment, as an action, not a place: at the scene's start (the same timing and spacing as a scene
 * pause), when the shot under it is not voiced, the label keeps that shot's action (keepsAction) and reads as a shortening of its
 * description. tos-390-510-g10 shot 29 ("Man in glasses shouts.", passed by its raters) was lost without it.
 */
function actionPause(sc: Scene, out: readonly FitCue[], shots: readonly Described[], last: number): FitCue | undefined {
  if (!sc.action) return undefined
  const startMs = Math.max(sc.startMs, ...out.filter((x) => !x.extended && x.shotIndex < sc.shots[0]!).map((x) => x.endMs))
  if (startMs >= sc.endMs || startMs - last < SCENE_PAUSE_SPACING_MS) return undefined
  const under = shots.find((x) => sc.shots.includes(x.index) && x.startMs <= startMs && startMs < x.endMs)
  if (!under || under.sameAsPrev || !under.description || out.some((c) => c.shotIndex === under.index)) return undefined
  const text = `${sc.action.trim().replace(/[.!?…]+$/u, '').replace(/^\p{Ll}/u, (c) => c.toUpperCase())}.`
  if (keepsVerb(text, '') || !keepsVerb(under.description, text) || readsAsSentences(under.description, text)) return undefined
  return { startMs, endMs: startMs + 100, text, extended: true, wordCount: words(text), shotIndex: under.index, scene: true }
}
/** The place merged into the action within EXTENDED_WORDS: whole, else the action shortened deterministically to the words left, its verb kept and still sentences. */
function placedAction(sc: Pick<Scene, 'setting' | 'returning'>, action: string, names: readonly string[]): string | undefined {
  const whole = withPlace(sc, action, names)
  if (!whole) return undefined
  if (words(whole) <= EXTENDED_WORDS) return whole
  const room = EXTENDED_WORDS - (words(whole) - words(action))
  const short = shortenDeterministic(action, room)
  if (words(short) > room || !keepsVerb(action, short) || readsAsSentences(action, short)) return undefined
  const t = withPlace(sc, short, names)
  return t && words(t) <= EXTENDED_WORDS ? t : undefined
}
/**
 * A description as fit and the edit pass read it (decision 0012 amendment, 2026-10-15): "Darkness." whole or absent (stripDarkness), no
 * bare light word as a lead (stripBareLead: g10 "Dim. A fire pit glows …"), and no place phrase naming another scene's place
 * (foreignPlaceStems: g10 shot 28 "… inside the tent", in the town scene) — a place word is grounded in its own scene.
 */
export function groundedDescription(shot: Pick<Described, 'index' | 'description'>, scenes: readonly Scene[] | undefined, g: Glossary): string {
  const text = stripBareLead(stripDarkness(shot.description))
  const sc = scenes ? sceneOf(scenes, shot.index) : undefined
  return sc ? withoutPlacePhrases(text, foreignPlaceStems(sc, scenes!, g)) : text
}
/** keepsVerb on the action beside any on-screen text clause. */
function keepsActionOf(text: string, short: string): boolean {
  const a = textClauses(text), b = textClauses(short)
  return keepsVerb(a ? a.rest : text, a && b ? b.rest : short)
}
/**
 * fit's next-best shortening when the shortener's drops the action: the first sentence of the text that has a verb, whole or shortened
 * deterministically to maxWords, that keeps its verb and reads as sentences against the whole text (g10 shot 27: "A small tan dragon
 * roars." in place of "A woman with red hair."). Plain text only; undefined when none fits.
 */
function actionSentence(text: string, maxWords: number, language: 'en' | 'de'): string | undefined {
  if (textClauses(text)) return undefined
  for (const u of sentences(text)) {
    const v = u.trim().replace(/^\p{Ll}/u, (c) => c.toUpperCase())
    if (keepsVerb(v, '')) continue // no verb found: not an action
    const cand = words(v) <= maxWords ? v : shortenDeterministic(v, maxWords)
    if (words(cand) <= maxWords && keepsVerb(v, cand) && !readsAsSentences(text, cand, language)) return cand
  }
  return undefined
}
const textOnly = (c: FitCue) => textClauses(c.text)?.rest === ''

/** A shot fit could not place whose description carries a new plot event: the extended cue it would become, and how much is new in it. */
export interface EventCandidate { cue: FitCue; verbs: number; fresh: number }
/**
 * The cap (DESC-020): of the event candidates, those at least EVENT_SPACING_MS from every other chosen one — taken in order of most new
 * action verbs, then most new content words, then earliest; so where two events compete for one 30 s window the richer one is heard.
 */
export function capEvents(events: readonly EventCandidate[]): FitCue[] {
  const chosen: FitCue[] = []
  for (const e of [...events].sort((a, b) => b.verbs - a.verbs || b.fresh - a.fresh || a.cue.startMs - b.cue.startMs)) if (eventSpaced(chosen.map((c) => c.startMs), e.cue.startMs)) chosen.push(e.cue)
  return chosen
}

/** A pause (extended cue) is checked against playback position 4 times a second; on the action's own ms it cut the action's first syllable. */
export const TEXT_LEAD_MS = 400
/**
 * Where a split text cue and its action start: the text TEXT_LEAD_MS before the action when that is not before `earliest` (the shot
 * start / the end of the previous cue); else the text at `earliest` (at most the action start) and the action TEXT_LEAD_MS after it,
 * when `fits(later)`; else both where they are.
 */
export function leadText(actionStart: number, earliest: number, fits: (laterStart: number) => boolean): { textStart: number; actionStart: number } {
  if (actionStart - TEXT_LEAD_MS >= earliest) return { textStart: actionStart - TEXT_LEAD_MS, actionStart }
  const textStart = Math.min(earliest, actionStart), later = textStart + TEXT_LEAD_MS
  return { textStart, actionStart: later > actionStart && fits(later) ? later : actionStart }
}
/** Cue order: by start; on one start, an on-screen text cue first, then a scene pause (the place before what happens there), then other extended cues, then placed ones. */
export const byStart = (a: FitCue, b: FitCue) => a.startMs - b.startMs || rank(a) - rank(b)
const rank = (c: FitCue) => (!c.extended ? 3 : textClauses(c.text)?.rest === '' ? 0 : c.scene && !c.event ? 1 : 2)
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length
const extended = (s: Described): FitCue => ({ startMs: s.startMs, endMs: s.startMs + 100, text: s.description, extended: true, wordCount: words(s.description), shotIndex: s.index })
/** Extended cues pause the film, so they keep the 25-word budget (PLAN §4.2); longer text is shortened like any other. */
export const EXTENDED_WORDS = 25
/** A clause-boundary cut that leaves fewer words than this is too little; the cut stays at EXTENDED_WORDS. */
export const MIN_CLAUSE_CUT_WORDS = 8
/**
 * Caps an extended cue at EXTENDED_WORDS. The shortener's text is used when it fits; otherwise the text is cut after the last word
 * ending a clause ([,;:.]) within the first EXTENDED_WORDS, when that keeps ≥ MIN_CLAUSE_CUT_WORDS words (a trailing , ; : becomes .),
 * else at EXTENDED_WORDS words. The cut never touches an on-screen text clause (DESC-017): the rest is cut to the words left beside it.
 * Also used by 06-voice when an overrun cue becomes extended.
 * DESC-028: the shortening and the cut must still read as sentences (sentenceOk, fail open); a shortening that does not is not used,
 * and when the cut does not either, there is no cue (undefined): the caller drops the extended cue. A text within the cap is unchanged.
 */
export async function capExtended(text: string, shorten: (text: string, maxWords: number) => Promise<string> | string, language: 'en' | 'de' = 'en'): Promise<{ text: string; wordCount: number } | undefined> {
  if (words(text) > EXTENDED_WORDS) {
    const original = text
    const t = await shorten(text, EXTENDED_WORDS)
    if (words(t) <= EXTENDED_WORDS && sentenceOk(original, t, language)) text = t
    else {
      const c = textClauses(text)
      text = c?.rest && c.words < EXTENDED_WORDS ? join(c, cutAt(c.rest, EXTENDED_WORDS - c.words)) : cutAt(text, EXTENDED_WORDS)
      if (!sentenceOk(original, text, language)) { console.warn('fit: extended cue cut is not sentences, no cue:', JSON.stringify(original), '→', JSON.stringify(text)); return undefined }
    }
  }
  return { text, wordCount: words(text) }
}
/** readsAsSentences on the action beside any on-screen text clause (the clause itself is never shortened, and may move to the end). */
const sentenceOk = (original: string, short: string, language: 'en' | 'de') => !sentenceProblem(original, short, language)
function sentenceProblem(original: string, short: string, language: 'en' | 'de') {
  const a = textClauses(original), b = textClauses(short)
  return readsAsSentences(a ? a.rest : original, a && b ? b.rest : short, language)
}
/** capExtended's cut: after the last clause end within the first n words when that keeps ≥ MIN_CLAUSE_CUT_WORDS, else at n words. */
function cutAt(text: string, n: number) {
  const head = text.trim().split(/\s+/).slice(0, n)
  let last = head.length - 1
  while (last >= 0 && !/[,;:.]$/.test(head[last]!)) last--
  return last + 1 >= MIN_CLAUSE_CUT_WORDS ? head.slice(0, last + 1).join(' ').replace(/[,;:]$/, '.') : head.join(' ')
}

/**
 * On-screen text (DESC-017; ../textClause): a label ("Words appear:", or German "Text erscheint:" …) and the text, quoted or up to its
 * sentence end. The most important fact of its shot — shortening (deterministic, model, capExtended) never shortens or removes it:
 * it shortens the rest to the words left beside it. A clause that opened the text still opens it; a clause after other text is put
 * back at the end, so a mid-text clause moves to the end when the text is shortened.
 */
interface TextClauses { lead: string; tail: string; clause: string; rest: string; words: number }
/** text split into its text clauses (lead: one that opens the text; tail: the others; clause: all of them) and the rest; undefined when it has none. */
export function textClauses(text: string): TextClauses | undefined {
  const spans = textSpans(text)
  if (!spans.length) return undefined
  const m = spans.map((x) => clauseText(text, x))
  const lead = text.slice(0, spans[0]!.start).trim() ? '' : m[0]!
  const rest = withoutSpans(text, spans) // the action as whole sentences: no joining word left dangling, no lowercase start
  return { lead, tail: (lead ? m.slice(1) : m).join(' '), clause: m.join(' '), rest, words: words(m.join(' ')) }
}
/**
 * Keeping the text beside the action may not cost more than half of the action's words (PR #25 round 2): r2 shot 0 kept
 * "Snowy mountains." of "Snowy mountains. A lone figure walks left, carrying a spear." and lost the character's introduction.
 */
const keepsAction = (rest: string, short: string) => words(short) * 2 >= words(rest)
/** The shortened rest put back beside the text clauses; a sentence end is added before a clause that follows it. */
function join(c: TextClauses, short: string) {
  let r = short.trim()
  if (r && c.tail && !/[.!?]$/.test(r)) r = `${r.replace(/[,;:]$/, '')}.`
  return [c.lead, r, c.tail].filter(Boolean).join(' ')
}

/**
 * Does the shot introduce a new character, location or on-screen text (PLAN §4.3)? Only those become extended cues.
 * Crude on purpose: "Words appear:", a scene-change sentence ("Night.", "A rooftop."), or a newly introduced person ("a man", "a woman").
 */
export const introducesNew = (description: string) => textSpans(description).length > 0 || /\b(night\.|day\.|a (man|woman|girl|boy)|rooftop|room|street)\b/i.test(description)

/** The only words a shortening may add. Prepositions and pronouns change facts ("runs from" → "runs to", an added "her"). */
const STOPWORDS = new Set(['a', 'an', 'the', 'and'])
/** Dropping any of these flips the meaning, so a shortening must keep every one the original has. */
const NEGATIONS = new Set(['not', 'no', 'never', 'without', 'nobody', 'nothing', 'none', 'neither', 'nor', "n't", "don't", "doesn't", "isn't", "aren't", "can't", "won't"])
const tokens = (t: string) => normalizeQuotes(t).toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean)

/**
 * A shortening keeps the facts when its content words appear in the original in the same order (exact tokens, case-insensitive,
 * punctuation stripped — "wing" → "wings" fails, "dog chases cat" → "cat chases dog" fails), only a/an/the/and are added, and every
 * negation of the original survives.
 */
export function preservesFacts(original: string, shortened: string): boolean {
  const orig = tokens(original), short = tokens(shortened)
  if (orig.some((w) => NEGATIONS.has(w) && !short.includes(w))) return false
  let i = 0
  for (const w of short) {
    const at = orig.indexOf(w, i)
    if (at >= 0) i = at + 1
    else if (!STOPWORDS.has(w)) return false
  }
  return true
}

/** Size, shape, age and texture words dropped first. Colours stay (facts the prompt asks for); so do words that are often nouns or facts (giant, full, empty). */
const ADJECTIVES = new Set(['large', 'small', 'big', 'little', 'tiny', 'huge', 'tall', 'short', 'long', 'wide', 'narrow', 'thick', 'thin', 'heavy', 'old', 'young', 'ancient', 'bright', 'dim', 'faint', 'soft', 'rough', 'smooth', 'sharp', 'wooden', 'snowy', 'rocky', 'icy', 'dusty', 'muddy', 'wet', 'dry', 'distant', 'nearby', 'vast', 'massive', 'slender', 'ornate', 'simple', 'various', 'several'])
/** Clause boundaries: after a comma/semicolon/sentence end, or before a joining word (kept with the clause it opens). */
const CLAUSE = /(?<=[,;.!?])\s+|\s+(?=(?:and|while|as|then|who|which|holding|wearing)\b)/i
const KEEP_BEFORE = new Set(['is', 'are', 'looks', 'seems', 'becomes'])
/** Manner adverbs only, listed (a -ly rule ate "Emily" and "butterfly"); never nearly/almost/barely/only, which carry facts. */
const ADVERBS = new Set(['slowly', 'quickly', 'suddenly', 'gently', 'quietly', 'softly', 'carefully', 'briefly', 'slightly', 'rapidly', 'swiftly', 'steadily', 'firmly', 'tightly', 'calmly', 'silently', 'gracefully', 'cautiously'])
const ARTICLES = new Set(['a', 'an', 'the'])
const JOINERS = new Set(['and', 'while', 'as', 'then', 'who', 'which'])
/** After the candidate: a present-tense verb in house style ("walks", "runs") or a joining word — so the candidate is a noun (the subject). A candidate that itself ends the clause ("the old.") has punctuation and is never dropped. */
const verbOrEnd = (next: string) => JOINERS.has(next.toLowerCase().replace(/[^a-z]/g, '')) || /^\p{Ll}+[^s]s[,;.!?]?$/u.test(next)

/**
 * Deterministic shortening (PLAN §4.3): drop listed adjectives and adverbs that modify a following word, then drop clauses from
 * the end (sentence by sentence) until the text fits. Never drops a capitalised word mid-sentence (a name), nor an adjective used
 * as a noun ("the old walks": after an article, before a verb or the clause end). Only removes words. May still not fit; fit() decides.
 * Never touches an on-screen text clause (textClauses): the rest is shortened beside it. When the clause and at least half of the
 * rest's words (keepsAction) do not fit together, the text comes back unchanged, and fit / 06-voice split it: the action placed,
 * the text its own extended cue.
 */
export function shortenDeterministic(text: string, maxWords: number): string {
  if (words(text) <= maxWords) return text
  const c = textClauses(text)
  if (!c) return shortenPlain(text, maxWords)
  if (!c.rest || c.words >= maxWords) return text
  const short = shortenPlain(c.rest, maxWords - c.words), all = join(c, short)
  return words(all) <= maxWords && keepsAction(c.rest, short) ? all : text
}
function shortenPlain(text: string, maxWords: number): string {
  if (words(text) <= maxWords) return text
  const w = text.trim().split(/\s+/)
  const keep = w.map((x, i) => {
    const prev = (w[i - 1] ?? '').toLowerCase(), next = w[i + 1]
    const opensSentence = i === 0 || /[.!?]$/.test(prev)
    if (next === undefined || !/^\p{L}+$/u.test(x) || KEEP_BEFORE.has(prev) || (/^\p{Lu}/u.test(x) && !opensSentence)) return true
    const bare = x.toLowerCase()
    if (ADVERBS.has(bare)) return false
    return !(ADJECTIVES.has(bare) && !((ARTICLES.has(prev) || opensSentence) && verbOrEnd(next)))
  })
  const idx = w.map((_, i) => i).filter((i) => keep[i])
  // "a" / "an" for the word now after it, only where a dropped word came between ("An old bearded man" → "A bearded man")
  const lean = idx.map((i, k) => (idx[k + 1] !== undefined && idx[k + 1] !== i + 1 ? fixArticle(w[i]!, w[idx[k + 1]!]!) : w[i]!)).join(' ').replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_, a: string, c: string) => a + c.toUpperCase()) // "Large white rock." → "White rock."
  if (words(lean) <= maxWords) return lean
  const clauses = joinMidPhrase(lean.split(CLAUSE))
  while (clauses.length > 1 && words(clauses.join(' ')) > maxWords) clauses.pop()
  return clauses.join(' ').replace(/[,;]$/, '').replace(/([^.!?])$/, '$1.')
}
const bareWord = (x: string | undefined) => (x ?? '').toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, '')
/** A clause piece that ends between stacked adjectives ("a pale,") is joined to the next piece, so the cut never ends mid-phrase (midPhrase). */
function joinMidPhrase(pieces: string[]): string[] {
  const out = [...pieces]
  for (let k = 0; k < out.length - 1;) {
    const ws = out[k]!.split(/\s+/), last = ws.at(-1)!, prev = ws.at(-2) ?? out[k - 1]?.split(/\s+/).at(-1)
    if (/,$/.test(last) && midPhrase(bareWord(prev), bareWord(last), bareWord(out[k + 1]!.split(/\s+/)[0]))) out.splice(k, 2, `${out[k]} ${out[k + 1]}`)
    else k++
  }
  return out
}
/** "a" or "an" as the vowel letter of `next` asks (by spelling: "an hour" is left to the describe step). */
function fixArticle(x: string, next: string): string {
  if (!/^(a|an)$/i.test(x)) return x
  const an = /^[aeiou]/i.test(next)
  const out = an ? 'an' : 'a'
  return x[0] === x[0]!.toUpperCase() ? out[0]!.toUpperCase() + out.slice(1) : out
}

/**
 * The model's shortening is used only when it fits, adds no content word (preservesFacts) and still reads as sentences
 * (../sentenceGuard readsAsSentences: content words in order, no new list comma, no sentence ending mid-phrase, not only a subject — DESC-028);
 * otherwise the deterministic one, under the same sentence guard; when that fails too, the text comes back unshortened, and fit places
 * it only where it fits whole (else the next gap, an extended cue or a drop, as for any text that does not fit). The model never sees
 * an on-screen text clause: it shortens the rest to the words left beside the clause, which is then put back (DESC-017).
 */
export async function safeShorten(text: string, maxWords: number, model: (text: string, maxWords: number) => Promise<string> | string, language: 'en' | 'de' = 'en'): Promise<string> {
  const c = words(text) > maxWords ? textClauses(text) : undefined
  if (!c) return safeShortenPlain(text, maxWords, model, language)
  if (!c.rest || c.words >= maxWords) return text // no room beside the text: no model call; fit splits it
  const short = await safeShortenPlain(c.rest, maxWords - c.words, model, language), all = join(c, short)
  return words(all) <= maxWords && keepsAction(c.rest, short) ? all : text
}
async function safeShortenPlain(text: string, maxWords: number, model: (text: string, maxWords: number) => Promise<string> | string, language: 'en' | 'de'): Promise<string> {
  const m = (await model(text, maxWords)).trim()
  if (m && words(m) <= maxWords) {
    const why = preservesFacts(text, m) ? readsAsSentences(text, m, language) : 'changed a fact'
    if (!why) return m
    console.warn(`fit: shortener reply rejected (${why}), using deterministic shortening:`, JSON.stringify(text), '→', JSON.stringify(m))
  }
  return shortenSentences(text, maxWords, 'fit', language)
}
/**
 * shortenDeterministic under the sentence guard (DESC-028): its shortening when that still reads as sentences (readsAsSentences),
 * else the text unshortened — the caller then treats it as text that does not fit. fit's fallback and 06-voice's overrun shortening.
 */
export function shortenSentences(text: string, maxWords: number, step = 'voice', language: 'en' | 'de' = 'en'): string {
  const d = shortenDeterministic(text, maxWords)
  const why = d === text ? undefined : sentenceProblem(text, d, language)
  if (why) console.warn(`${step}: deterministic shortening rejected (${why}), keeping the text unshortened:`, JSON.stringify(text), '→', JSON.stringify(d))
  return why ? text : d
}

export async function fitDescriptions(ctx: Ctx) {
  const shots = JSON.parse(await readFile(`${ctx.work}/described.json`, 'utf8')) as Described[]
  const gaps = JSON.parse(await readFile(`${ctx.work}/gaps.json`, 'utf8')) as Gap[]
  const { shortenWithNovaLite } = await import('../prompts')
  const scenes = await freshScenes(ctx) // DESC-029: groups scenes first when scenes.json is missing or stale (`--from fit`), as the worker does
  const cues = await fit(shots, gaps, (t, n) => safeShorten(t, n, (t, n) => shortenWithNovaLite(t, n, ctx.language), ctx.language), ctx.language, { scenes, glossary: glossaryFor(ctx) })
  const json = JSON.stringify(cues, null, 2)
  await writeFile(`${ctx.work}/cues.json`, json)
  await writeFile(`${ctx.work}/cues.fit.json`, json) // the edit step (05b) always starts from this copy, so re-running it is idempotent (DESC-018)
}
