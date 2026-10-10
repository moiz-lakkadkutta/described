/**
 * On-screen text in a description (DESC-017): a label — the approved prompt's "Words appear:", or the German labels Qwen writes when
 * it replies in German — then the text, quoted ("…" “…” „…“ «…» »…«) or bare up to its sentence end. Shared by parseDescription
 * (04-describe), the shorteners and introducesNew (05-fit), so all three read the same clause.
 */
export const TEXT_LABEL = /(?:Words appear|Text erscheint|Wörter erscheinen|Schrift erscheint):/giu
/** Opening quote → the characters that close it. An unclosed quote runs to the end of the description. */
const CLOSE: Record<string, string> = { '"': '"', '“': '”“', '„': '“”', '«': '»', '»': '«' }
/** A period after one of these (case-insensitive) does not end bare on-screen text: "Mr. Smith", "Dr. Who". */
const ABBR = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'prof', 'mt', 'vs', 'nr', 'hr', 'fr'])

/** One clause: [start, end) in the description, and the on-screen text itself (without label, quotes or the closing period). */
export interface TextSpan { start: number; end: number; body: string }

export function textSpans(text: string): TextSpan[] {
  const out: TextSpan[] = []
  const label = new RegExp(TEXT_LABEL.source, 'giu')
  for (let m = label.exec(text); m; m = label.exec(text)) {
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
    out.push({ start: m.index, end, body })
    label.lastIndex = end
  }
  return out
}

/**
 * End (exclusive) of bare on-screen text starting at `from`: after the first . ! ? that ends a sentence. Not a sentence end: punctuation
 * followed by a non-space ("3.14", "U.S.A"), a period after an abbreviation or a single letter ("Mr. Smith", "J. Smith"), or a
 * period between two all-caps words ("DR. NO.").
 */
function bareEnd(text: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    if (!/[.!?]/.test(text[j]!)) continue
    const next = text.slice(j + 1)
    if (next && !/^\s/.test(next)) continue
    if (!next.trim() || text[j] !== '.') return j + 1
    const prev = /(\S+)$/.exec(text.slice(from, j))?.[1] ?? ''
    const nextWord = /^\s*(\S+)/.exec(next)?.[1] ?? ''
    if (ABBR.has(prev.toLowerCase()) || /^\p{L}$/u.test(prev)) continue
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
