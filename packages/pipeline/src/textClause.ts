/**
 * On-screen text in a description (DESC-017): a label — the approved prompt's "Words appear:", or the German labels Qwen writes when
 * it replies in German — then the text, quoted ("…" “…” „…“ «…» »…«) or bare up to its sentence end. Shared by parseDescription
 * (04-describe), the shorteners and introducesNew (05-fit), so all three read the same clause.
 * DESC-010 follow-ups (Tears of Steel, 2026-10-14):
 * - the model also writes text without the label (TEXT_CUE): `headline: ROBOTICIST CREATES KILLER ROBOTS`, `A shop sign reads OPEN`,
 *   `The screen reads "SIMULATION READY"`, `Title card: "…"`, `Caption "…" fades in`. Such a clause starts at the latest of the
 *   sentence start (. ! ? ; :), a ", " or a joining word (carrierStart), so the action before it stays in the rest ("A soldier grabs
 *   the rifle as a sign reads …"), and the noun right before the cue word ("Hand holds crumpled newspaper headline: …") is never left
 *   behind as a fragment. Not text: a bare (unquoted) body that does not start with a capital or a digit ("The sign says nothing.",
 *   "He reads the note: his hands tremble."), a carrier after a pronoun (a verb: "He signs: …"), and a body over MAX_TEXT_WORDS
 *   words (left as plain description; only a labelled clause that long is dropped as invented text, by parseDescription).
 * - a trailing modifier after the text (`"TEARS OF STEEL" in metallic silver, centered.`: the next word lowercase, or a , ; :) is part
 *   of the clause up to its sentence end, or up to a joining word that opens the next action ("… and a man runs in."), so splitting
 *   the clause off never leaves a lowercase fragment to be voiced alone.
 */
export const TEXT_LABEL = /(?:Words appear|Text erscheint|Wörter erscheinen|Schrift erscheint):/giu
/** On-screen text longer than this is taken as invented (parseDescription drops a labelled clause; an unlabelled one is not text). */
export const MAX_TEXT_WORDS = 8
/** Things that carry text (en, de). */
const CARRIER = String.raw`(?:headlines?|captions?|subtitles?|title cards?|titles?|street signs?|sign|banners?|placards?|posters?|billboards?|plaques?|labels?|inscriptions?|newspapers?|screens?|monitors?|displays?|notes?|letters?|messages?|cards?|boards?|Schlagzeilen?|Überschriften?|Untertitel|Schilder|Schild|Aufschriften?|Titelkarten?|Titel|Plakate?|Bildschirm)`
const QUOTE = String.raw`(?=["“„«»])`
/** Not after a pronoun subject: "He signs: …" is a verb, not a sign. */
const NOT_PRONOUN = String.raw`(?<!\b(?:he|she|they|it|who|er|sie|es)\s+)`
const C = String.raw`${NOT_PRONOUN}\b${CARRIER}`
/**
 * On-screen text without the label: a carrier then ":" (`headline: …`); a carrier that reads / says (bare or quoted) or shows /
 * displays a quote; a carrier directly before a quote (`Caption "…"`); or anything that reads a quote (`… reads "…"`). Never
 * "Man reads newspaper" or "A man holds a sign": a cue word with no text after it is not on-screen text.
 */
const TEXT_CUE = String.raw`${C}\s*:|${C}\s+(?:reads|says|lautet)\b\s*:?|${C}\s+(?:shows|displays|zeigt)\s*:?\s*${QUOTE}|${C}\s+${QUOTE}|\breads\s*:?\s*${QUOTE}`
/** Words that join a clause to the one before it: a carrier clause starts after one, a split leaves none dangling. */
const JOINERS = 'as|while|where|and|then|with|that'
/** A trailing modifier ends before one of these when a lowercase word follows (the next action: "… and a man runs in."). */
const NEXT_ACTION = /[,;]?\s+(?:and|while|as|then|und|während|dann|als)\s+\S/u
/** Bare text ends before ", and …" (the next action: "A sign reads OPEN, and a man enters."). */
const BARE_JOIN = /,\s+(?:and|while|as|then|und|während|dann|als)\s/u
/** Opening quote → the characters that close it. An unclosed quote runs to the end of the description. */
const CLOSE: Record<string, string> = { '"': '"', '“': '”“', '„': '“”', '«': '»', '»': '«' }
/** A period after one of these (case-insensitive) does not end bare on-screen text: "Mr. Smith", "Dr. Who". */
const ABBR = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'prof', 'mt', 'vs', 'nr', 'hr', 'fr'])
/** After a single-letter initial ("J. Smith") a capitalised word continues the text — unless it is an article opening the next sentence ("I. A forest."). */
const ARTICLES = new Set(['a', 'an', 'the', 'der', 'die', 'das', 'ein', 'eine'])

/**
 * The fixed neutral sentence that stands for on-screen text that is there but not fully legible (DESC-031, decision 0013): verify may
 * replace a quoted clause with it, never with a corrected quote. It is not a text clause (no ":" and no quote), so textSpans does not
 * read it and fit, edit and voice treat it as a plain sentence of the description.
 */
export const NEUTRAL_TEXT = { en: 'Words appear.', de: 'Text erscheint.' } as const
/** A neutral sentence (either language) standing as a whole sentence: at the start of the text or after a sentence end. */
const NEUTRAL = /(?<=^|[.!?…;]["”“»«]?\s+)(?:Words appear|Text erscheint)\.(?=\s|$)/gu
/** The neutral sentences of `text`, as spans in order (body ''): what verify's guards read in place of a quoted clause. */
export const neutralSpans = (text: string): TextSpan[] => [...text.matchAll(NEUTRAL)].map((m) => ({ start: m.index, end: m.index + m[0].length, body: '' }))
/** Adjacent repeats of a neutral sentence said once ("Words appear. Words appear." → "Words appear."; PR #56 review L2). */
export const collapseNeutral = (text: string) => text.replace(/(?<=^|[.!?…;]["”“»«]?\s+)(Words appear\.|Text erscheint\.)(?:\s+\1)+(?=\s|$)/gu, '$1')
/**
 * A shortening that cuts a neutral sentence the original has ("Text erscheint." → "Text."): a sentence of `shortened` made only of
 * some, not all, of its words (PR #56 review L3). Dropping the sentence whole is fine. The reason, or undefined.
 */
export function cutsNeutral(original: string, shortened: string): string | undefined {
  const bare = (t: string) => t.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  for (const n of Object.values(NEUTRAL_TEXT)) {
    if (!neutralSpans(original).some((x) => original.slice(x.start, x.end) === n)) continue
    const nw = bare(n)
    for (const sentence of shortened.split(/(?<=[.!?…])\s+/u)) {
      const w = bare(sentence)
      if (w.length && w.length < nw.length && w.every((x) => nw.includes(x))) return `cuts "${n}"`
    }
  }
  return undefined
}

/** One clause: [start, end) in the description, and the on-screen text itself (without label, quotes or the closing period). */
export interface TextSpan { start: number; end: number; body: string }

/** `onTooLong`: told of each unlabelled match left out because its text is over MAX_TEXT_WORDS words (parseDescription warns). */
export function textSpans(text: string, onTooLong?: (match: string) => void): TextSpan[] {
  const out: TextSpan[] = []
  const label = new RegExp(`(${TEXT_LABEL.source})|${TEXT_CUE}`, 'giu')
  let after = 0 // end of the previous span
  for (let m = label.exec(text); m; m = label.exec(text)) {
    const cue = m[1] === undefined
    let i = m.index + m[0].length
    while (i < text.length && /\s/.test(text[i]!)) i++
    const close = CLOSE[text[i] ?? '']
    let end: number, body: string
    if (close) {
      let j = i + 1
      while (j < text.length && !close.includes(text[j]!)) j++
      body = text.slice(i + 1, j)
      end = Math.min(text.length, j + 1)
      if (/[.!?]/.test(text[end] ?? '')) end++
    } else {
      end = bareEnd(text, i)
      const join = BARE_JOIN.exec(text.slice(i, end)) // "OPEN, and a man enters.": the text ends before the next action
      if (join) end = i + join.index
      body = text.slice(i, end).replace(/(?<!\.)[.!?]$/, '').trim() // an ellipsis that ends the text is part of it ("LOADING...")
    }
    // Unlabelled: no text after the cue word, a bare body that does not open with an all-caps word or a digit ("Monitors: Thom types."),
    // or one too long to be legible text.
    if (cue && (!body.trim() || (!close && !/^(?:\p{Lu}{2,}(?!\p{Ll})|\p{N})/u.test(body)))) { label.lastIndex = m.index + m[0].length; continue }
    if (cue && words(body) > MAX_TEXT_WORDS) { onTooLong?.(text.slice(m.index, end)); label.lastIndex = m.index + m[0].length; continue }
    if (/^\s*[\p{Ll},;:]/u.test(text.slice(end))) { // a trailing modifier: "… in metallic silver, centered."
      const to = bareEnd(text, end), next = NEXT_ACTION.exec(text.slice(end, to))
      end = next ? end + next.index : to
    }
    out.push({ start: cue ? carrierStart(text, m.index, after) : m.index, end, body })
    label.lastIndex = after = end
  }
  return out
}

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length
/**
 * Start of an unlabelled clause whose cue word is at `at`: after the last sentence end (. ! ? ; : and a closing quote), ", " or
 * joining word before it, never before `from`.
 */
function carrierStart(text: string, at: number, from: number): number {
  let start = from
  for (const m of text.slice(from, at).matchAll(new RegExp(String.raw`[.!?…;:]["”“»«]?\s+|,\s+|\b(?:${JOINERS})\s+`, 'giu'))) start = from + m.index + m[0].length
  while (start < at && /\s/.test(text[start]!)) start++
  return start
}

const capitalise = (t: string) => t.replace(/^(\s*)(\p{Ll})/u, (_, s: string, c: string) => s + c.toUpperCase())
const TRAILING_JOIN = new RegExp(String.raw`[\s,;:]*(?:\b(?:${JOINERS})\b)?[\s,;:]*$`, 'iu')
const LEADING_JOIN = /^[\s,;:]*(?:(?:and|while|as|then|with|und|während|dann|als)\s+)?/iu

/**
 * `text` without `spans` (in order), as sentences: a joining word or comma left before a removed clause is dropped and the part ends
 * with a period ("A soldier grabs the rifle as a sign reads …" → "A soldier grabs the rifle."); one left after it is dropped and the
 * part capitalised ("… and a man runs in." → "A man runs in."). Used for textClauses' rest and 06-voice's withoutSaidText.
 */
export function withoutSpans(text: string, spans: readonly TextSpan[]): string {
  const parts: string[] = []
  let at = 0
  for (const s of spans) { parts.push(text.slice(at, s.start)); at = s.end }
  parts.push(text.slice(at))
  return parts.map((p, k) => {
    let t = k > 0 ? capitalise(p.replace(LEADING_JOIN, '')) : p
    if (k < parts.length - 1) { t = t.replace(TRAILING_JOIN, ''); if (t.trim() && !/[.!?…]["”“»«]?$/u.test(t)) t += '.' }
    return t.trim()
  }).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}
/**
 * A clause as said on its own (a text pause): its first letter capitalised ("a sign reads …" → "A sign reads …"), and a clause that
 * opens with the bare verb ("… the poster that reads "WANTED"") said with the house label: `Words appear: "WANTED".` The span's body
 * is unchanged, so "already said" still matches.
 */
export const clauseText = (text: string, s: TextSpan) => capitalise(text.slice(s.start, s.end).trim()
  .replace(/^(?:reads|says|shows|displays)\b\s*:?\s*/iu, 'Words appear: ').replace(/^(?:lautet|zeigt)\b\s*:?\s*/iu, 'Text erscheint: '))

/**
 * "Darkness." is the whole description or absent (DESC-010 follow-up): a "Darkness." / "Darkness..." / "Darkness," (German
 * "Dunkelheit.") prefix in front of something visible ("Darkness. A mechanical airship … hovers") is removed and what follows
 * capitalised; a bare "Darkness." is kept. Applied by parseDescription (04-describe), fit (05-fit) and the edit step (05b-edit), so a
 * re-run from fit cleans an existing described.json.
 */
export function stripDarkness(text: string): string {
  const t = text.trim(), rest = t.replace(/^(?:darkness|dunkelheit)(?:\.\.\.|…|[.!,])\s+(?=\S)/iu, '')
  return rest === t ? t : capitalise(rest)
}

/**
 * A bare light or condition word is never a lead (decision 0012 amendment, 2026-10-15): a first sentence that is one such word — "Dim.",
 * "Dark.", "Towering.", "Smoky." — in front of the rest is removed and the rest capitalised. g10 shot 2 opened "Dim. A fire pit glows …"
 * (the 0009 darkness rule's "say dim", written as its own sentence) and all three raters failed the fragment; tos-390-510-g10 shot 11's
 * "Towering." was a scene label put in front. A time word stays ("Night. A rooftop." signals a scene change), so does "Darkness." (stripDarkness)
 * and a word that is the whole description. Applied with stripDarkness by parseDescription, fit and the edit step.
 */
export function stripBareLead(text: string): string {
  const t = text.trim(), m = /^(\p{L}+)(?:\.\.\.|…|[.!])\s+(?=\S)/u.exec(t)
  if (!m || !BARE_LEAD.test(m[1]!) || TIME_LEAD.test(m[1]!) || ING_PLACES.test(m[1]!)) return t
  return capitalise(t.slice(m[0].length))
}
const BARE_LEAD = /^(?:dim|dark|bright|gloomy|murky|smoky|misty|foggy|hazy|dusky|shadowy|blurry|blurred|silent|quiet|still|calm|empty|dunkel|düster|hell|neblig|\p{L}+ing)$/iu
/** -ing words that name a place ("Clearing."), not a condition. */
const ING_PLACES = /^(?:building|clearing|landing|crossing|ceiling|opening|dwelling|offing)$/iu
const TIME_LEAD = /^(?:night|day|dawn|dusk|morning|evening|nacht|tag|morgen|abend)$/iu

/** After an ellipsis, an all-caps word or a number may go on with the text ("SIMULATION READY... LOCKED."); "A", "Thom" do not. */
const TEXT_GOES_ON = /^["“„«»]?(?:\p{Lu}{2,}(?!\p{Ll})|\p{N})/u

/**
 * End (exclusive) of bare on-screen text starting at `from`: after the first . ! ? or ellipsis ("..." "…") that ends a sentence. Not a
 * sentence end: an ellipsis before an all-caps run (an all-caps word or a number, no lowercase up to the sentence end; Tears of
 * Steel d6: "SIMULATION READY... LOCKED.", but "STANDBY... TV static fills the screen." ends at "..."), punctuation followed by
 * a non-space ("3.14", "U.S.A"), a period after an abbreviation ("Mr. Smith"), a period after a single letter before a capitalised word that is not an article ("J. Smith", but "I. A forest." ends at "I."), or a period between two all-caps words ("DR. NO.").
 */
function bareEnd(text: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    if (!/[.!?…]/.test(text[j]!)) continue
    const next = text.slice(j + 1)
    if (next && !/^\s/.test(next)) continue
    const nextWord = /^\s*(\S+)/.exec(next)?.[1] ?? ''
    const run = /^\s*([^.!?…]*)/u.exec(next)?.[1] ?? '' // up to the next sentence end: "TV static fills the screen" is the next sentence
    if (next.trim() && (text[j] === '…' || text.slice(j - 2, j + 1) === '...') && TEXT_GOES_ON.test(nextWord) && !/\p{Ll}/u.test(run)) continue
    if (!next.trim() || text[j] !== '.') return j + 1
    const prev = /(\S+)$/.exec(text.slice(from, j))?.[1] ?? ''
    if (ABBR.has(prev.toLowerCase())) continue
    if (/^\p{L}$/u.test(prev) && /^\p{Lu}/u.test(nextWord) && !ARTICLES.has(nextWord.replace(/[^\p{L}]/gu, '').toLowerCase())) continue
    if (/^\p{Lu}{2,}$/u.test(prev) && /^\p{Lu}{2,}[.!?]?$/u.test(nextWord)) continue
    return j + 1
  }
  return text.length
}

/** The description cut into sentences, each on-screen text clause one unit, in order. */
export function sentences(text: string): string[] {
  const out: string[] = []
  const plain = (t: string) => out.push(...t.split(/(?<=[.!?…])\s+/).map((x) => x.trim()).filter(Boolean))
  let at = 0
  for (const s of textSpans(text)) { plain(text.slice(at, s.start)); out.push(text.slice(s.start, s.end).trim()); at = s.end }
  plain(text.slice(at))
  return out
}
