/**
 * On-screen text in a description (DESC-017): a label — the approved prompt's "Words appear:", or the German labels Qwen writes when
 * it replies in German — then the text, quoted ("…" “…” „…“ «…» »…«) or bare up to its sentence end. Shared by parseDescription
 * (04-describe), the shorteners and introducesNew (05-fit), so all three read the same clause.
 * DESC-010 follow-ups (Tears of Steel, 2026-10-14):
 * - the model also writes text without the label (TEXT_CUE): `headline: ROBOTICIST CREATES KILLER ROBOTS`, `A shop sign reads OPEN`,
 *   `The screen reads "SIMULATION READY"`, `Title card: "…"`, `Caption "…" fades in`. Such a clause is the whole sentence it is in,
 *   from the sentence start, so the noun before the cue word ("Hand holds crumpled newspaper") is never left behind as a fragment.
 * - a trailing modifier after the text (`"TEARS OF STEEL" in metallic silver, centered.`: the next word lowercase, or a , ; :) is part
 *   of the clause up to its sentence end, so splitting the clause off never leaves a lowercase fragment to be voiced alone.
 */
export const TEXT_LABEL = /(?:Words appear|Text erscheint|Wörter erscheinen|Schrift erscheint):/giu
/** Things that carry text (en, de). */
const CARRIER = String.raw`(?:headlines?|captions?|subtitles?|title cards?|titles?|street signs?|signs?|banners?|placards?|posters?|billboards?|plaques?|labels?|inscriptions?|newspapers?|screens?|monitors?|displays?|notes?|letters?|messages?|cards?|boards?|Schlagzeilen?|Überschriften?|Untertitel|Schilder|Schild|Aufschriften?|Titelkarten?|Titel|Plakate?|Bildschirm)`
const QUOTE = String.raw`(?=["“„«»])`
/**
 * On-screen text without the label: a carrier then ":" (`headline: …`); a carrier that reads / says (bare or quoted) or shows /
 * displays a quote; a carrier directly before a quote (`Caption "…"`); or anything that reads a quote (`… reads "…"`). Never
 * "Man reads newspaper" or "A man holds a sign": a cue word with no text after it is not on-screen text.
 */
const TEXT_CUE = String.raw`\b${CARRIER}\s*:|\b${CARRIER}\s+(?:reads|says|lautet)\b\s*:?|\b${CARRIER}\s+(?:shows|displays|zeigt)\s*:?\s*${QUOTE}|\b${CARRIER}\s+${QUOTE}|\breads\s*:?\s*${QUOTE}`
/** Opening quote → the characters that close it. An unclosed quote runs to the end of the description. */
const CLOSE: Record<string, string> = { '"': '"', '“': '”“', '„': '“”', '«': '»', '»': '«' }
/** A period after one of these (case-insensitive) does not end bare on-screen text: "Mr. Smith", "Dr. Who". */
const ABBR = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'prof', 'mt', 'vs', 'nr', 'hr', 'fr'])
/** After a single-letter initial ("J. Smith") a capitalised word continues the text — unless it is an article opening the next sentence ("I. A forest."). */
const ARTICLES = new Set(['a', 'an', 'the', 'der', 'die', 'das', 'ein', 'eine'])

/** One clause: [start, end) in the description, and the on-screen text itself (without label, quotes or the closing period). */
export interface TextSpan { start: number; end: number; body: string }

export function textSpans(text: string): TextSpan[] {
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
      body = text.slice(i, end).replace(/[.!?]$/, '').trim()
    }
    if (cue && !body) { label.lastIndex = m.index + m[0].length; continue } // "A man holds a sign:" with nothing after it
    if (/^\s*[\p{Ll},;:]/u.test(text.slice(end))) end = bareEnd(text, end) // a trailing modifier: "… in metallic silver, centered."
    out.push({ start: cue ? sentenceStart(text, m.index, after) : m.index, end, body })
    label.lastIndex = after = end
  }
  return out
}

/** Start of the sentence containing `at`: after the last . ! ? (and a closing quote) followed by a space, never before `from`. */
function sentenceStart(text: string, at: number, from: number): number {
  let start = from
  for (const m of text.slice(from, at).matchAll(/[.!?]["”“»«]?\s+/gu)) start = from + m.index + m[0].length
  while (start < at && /\s/.test(text[start]!)) start++
  return start
}

/**
 * "Darkness." is the whole description or absent (DESC-010 follow-up): a "Darkness." (German "Dunkelheit.") prefix in front of
 * something visible ("Darkness. A mechanical airship … hovers") is removed; a bare "Darkness." is kept. Applied by parseDescription
 * (04-describe) and by fit (05-fit), so a re-run from fit cleans an existing described.json.
 */
export const stripDarkness = (text: string) => text.replace(/^\s*(?:darkness|dunkelheit)[.!]\s+(?=\S)/iu, '').trim()

/**
 * End (exclusive) of bare on-screen text starting at `from`: after the first . ! ? that ends a sentence. Not a sentence end: punctuation
 * followed by a non-space ("3.14", "U.S.A"), a period after an abbreviation ("Mr. Smith"), a period after a single letter before
 * a capitalised word that is not an article ("J. Smith", but "I. A forest." ends at "I."), or a period between two all-caps words ("DR. NO.").
 */
function bareEnd(text: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    if (!/[.!?]/.test(text[j]!)) continue
    const next = text.slice(j + 1)
    if (next && !/^\s/.test(next)) continue
    if (!next.trim() || text[j] !== '.') return j + 1
    const prev = /(\S+)$/.exec(text.slice(from, j))?.[1] ?? ''
    const nextWord = /^\s*(\S+)/.exec(next)?.[1] ?? ''
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
  const plain = (t: string) => out.push(...t.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean))
  let at = 0
  for (const s of textSpans(text)) { plain(text.slice(at, s.start)); out.push(text.slice(s.start, s.end).trim()); at = s.end }
  plain(text.slice(at))
  return out
}
