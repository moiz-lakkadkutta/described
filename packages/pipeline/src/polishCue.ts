import { textSpans } from './textClause'

/**
 * The last text pass before a cue is heard or shown (DESC-033, docs/decisions/0015-complete-sentences.md): Gate C g11 raters failed
 * cues that began in lower case and had no full stop ("a young woman … climbs rooftop"). Pure; called by 06-voice right before Polly
 * and by 08-text for descriptions.vtt. It never changes a word:
 * - spaces collapsed (and none before , . ; : ! ?);
 * - the first letter of each sentence capitalised (in the language's locale);
 * - the cue ends with . ! or ? — a full stop is added when missing (after a closing quote, which is kept); a trailing , ; : or an
 *   ellipsis becomes a full stop;
 * - on-screen text is left exactly as written: every quoted span ("…" “…” „…“ «…» »…«) and the text of every text clause
 *   (textSpans: "Words appear: …", a sign that reads …) is never recased, respaced or repunctuated.
 * `language` picks the locale for upper-casing (German "ü" → "Ü").
 */
export function polishCue(text: string, language: 'en' | 'de'): string {
  const locked = lockedRanges(text)
  // Rebuild the text: free stretches cleaned, locked stretches copied as they are.
  let out = ''
  const lockedAt: boolean[] = []
  let at = 0
  const free = (s: string) => {
    const clean = s.replace(/\s+/g, ' ').replace(/ +(?=[,.;:!?])/g, '')
    out += clean
    for (let k = 0; k < clean.length; k++) lockedAt.push(false)
  }
  for (const [a, b] of locked) {
    free(text.slice(at, a))
    out += text.slice(a, b)
    for (let k = a; k < b; k++) lockedAt.push(true)
    at = b
  }
  free(text.slice(at))
  // Trim free spaces at either end.
  let s = 0, e = out.length
  while (s < e && !lockedAt[s] && /\s/.test(out[s]!)) s++
  while (e > s && !lockedAt[e - 1] && /\s/.test(out[e - 1]!)) e--
  if (s >= e) return ''
  let t = out.slice(s, e)
  const lock = lockedAt.slice(s, e)

  // Sentence starts: the text's start, or after . ! ? (and an optional closing quote) and a space — only where the letter is free.
  const openEnd = unclosedQuote(text)
  const locale = language === 'de' ? 'de-DE' : 'en-US'
  // Not after an ellipsis ("waits... then runs") or an abbreviation ("e.g. a hammer"): the sentence goes on.
  t = t.replace(/(?<=^|(?<!\.)[.!?]["”“»«]?\s+)(\p{Ll})/gu, (c: string, _g: string, i: number) =>
    (lock[i] || ABBREVIATION.test(t.slice(0, i)) ? c : upperSame(c, locale)))

  // The ending: a trailing , ; : dash or ellipsis outside a quote is dropped, then a full stop is added unless the cue ends with
  // . ! ? — or with a quote that itself ends with . ! ? or … (a quote's own marks are never changed).
  const trail = /[\s,;:\-–—…]*(?:\.\.\.)?[\s,;:\-–—…]*$/u.exec(t)!
  if (!lock.slice(trail.index).some(Boolean)) t = t.slice(0, trail.index)
  if (!t) return ''
  if (lock[t.length - 1]) return openEnd || /[.!?…]["”“»«]?$/u.test(t) ? t : `${t}.` // an unclosed quote runs to the end: nothing goes inside it
  return /[.!?]$/.test(t) ? t : `${t}.`
}

/** An abbreviation's period right before the letter: no sentence starts after it. */
const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|z\.\s?B|d\.\s?h|usw|bzw|ca)\.\s+$/iu
/** True when the text ends inside a quote that never closes. */
function unclosedQuote(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const close = CLOSE[text[i]!]
    if (!close) continue
    let j = i + 1
    while (j < text.length && !close.includes(text[j]!)) j++
    if (j >= text.length) return true
    i = j
  }
  return false
}

/** The upper case of a single letter when it is a single letter too ("ß" stays as it is: "SS" would add a letter). */
const upperSame = (c: string, locale: string) => { const u = c.toLocaleUpperCase(locale); return u.length === c.length ? u : c }

/** Quote pairs: opening mark → the marks that close it (as textClause reads them). */
const CLOSE: Record<string, string> = { '"': '"', '“': '”“', '„': '“”', '«': '»', '»': '«' }

/**
 * [start, end) ranges of `text` that polishCue must not touch, merged and in order: every quoted span with its quotes (an unclosed
 * quote runs to the end) and the on-screen text of each text clause (textSpans' body).
 */
function lockedRanges(text: string): [number, number][] {
  const r: [number, number][] = []
  for (let i = 0; i < text.length; i++) {
    const close = CLOSE[text[i]!]
    if (!close) continue
    let j = i + 1
    while (j < text.length && !close.includes(text[j]!)) j++
    r.push([i, Math.min(text.length, j + 1)])
    i = j
  }
  // bare on-screen text ("a sign reads OPEN"); a quoted one is locked by its quotes above
  for (const span of textSpans(text)) {
    const at = span.body ? text.indexOf(span.body, span.start) : -1
    if (at >= 0 && at < span.end) r.push([at, at + span.body.length])
  }
  r.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const [a, b] of r) {
    const prev = merged.at(-1)
    if (prev && a <= prev[1]) prev[1] = Math.max(prev[1], b)
    else if (b > a) merged.push([a, b])
  }
  return merged
}
