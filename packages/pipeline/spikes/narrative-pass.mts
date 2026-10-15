/**
 * SPIKE (throwaway, not wired into the pipeline): a whole-script "narrative continuity" pass over a finished title's cues.
 * Reads a work dir read-only (cues.json, described.json, words.json, scenes.json + the title's glossary), asks one text model per
 * window of cues to rewrite the script as one connected narration, then runs every rewritten cue through the existing guards:
 *   - 05b-edit applyEdits (faithful to the shot descriptions, keeps facts, names/unnamedIn, scene place, editReadsAsSentences, budget),
 *     with one spike extension: a gendered pronoun is licensed when its referent was named in the previous action cue (≤ 20 s, same
 *     scene) or earlier in the same cue, and is then checked as that referent's noun ("she" → "woman");
 *   - fit (05-fit estimateClipMs against the cue's limit; extended ≤ 25 words);
 *   - verify (04b checkVerified, informational: it is a same-shot deletion guard, so a narrative rewrite is expected to fail it);
 *   - readsAsSentences (0011 shortener guard, informational for the same reason).
 * A cue keeps its old text unless edit guards + fit pass. Writes spikes/out/<model>.json. No DB, S3, CloudFront or work-dir write.
 *
 * Usage (from packages/pipeline): AWS_PROFILE=described-dev npx tsx spikes/narrative-pass.mts <modelId> [workDir] [capUsd]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'
import { applyEdits, editBudgets, factWords, isTextCue, spokenNames, wordCount } from '../src/steps/05b-edit'
import { groundedDescription, estimateClipMs, EXTENDED_WORDS, type FitCue } from '../src/steps/05-fit'
import { NEXT_CUE_SPACING_MS } from '../src/steps/06-voice'
import { checkVerified, wordCap } from '../src/steps/04b-verify'
import { readsAsSentences } from '../src/sentenceGuard'
import { contentWords, stem } from '../src/contentWords'
import { loadGlossary, allowedNames, withoutWithheldNames, nameRevealed, isProperName, shortOf } from '../src/glossary'
import { readScenes, sceneOf } from '../src/steps/04c-scenes'
import { polishCue } from '../src/polishCue'
import type { Described } from '../src/steps/04-describe'
import type { Word } from '../src/steps/03-speech'

const MODEL = process.argv[2] ?? 'amazon.nova-pro-v1:0'
const WORK = process.argv[3] ?? '/Users/moizp/hackathon/described/packages/pipeline/work/sintel'
const CAP = Number(process.argv[4] ?? 0.45)
const SLUG = 'sintel'
const WINDOW = 22
const CONTEXT = 6

// USD per 1M tokens, us-east-1 on-demand. https://aws.amazon.com/bedrock/pricing/ (Nova: src/cost.ts; Sonnet 4.5 list price) TODO(price): verify
const PRICES: Record<string, [number, number]> = {
  'amazon.nova-lite-v1:0': [0.06, 0.24], 'amazon.nova-pro-v1:0': [0.8, 3.2], 'us.amazon.nova-2-lite-v1:0': [0.33, 2.75],
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0': [3, 15], 'deepseek.v3.2': [0.62, 1.85], 'qwen.qwen3-vl-235b-a22b': [0.53, 2.66], 'mistral.mistral-large-3-675b-instruct': [0.5, 1.5],
}
let spent = 0
const usage = { inputTokens: 0, outputTokens: 0, calls: 0 }
const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' })

const cues = JSON.parse(await readFile(`${WORK}/cues.json`, 'utf8')) as FitCue[]
const glossary = loadGlossary(SLUG)
const scenes = (await readScenes(WORK)) ?? []
const words = JSON.parse(await readFile(`${WORK}/words.json`, 'utf8')) as Word[]
const spoken = spokenNames(words, 'en')
const shots = (JSON.parse(await readFile(`${WORK}/described.json`, 'utf8')) as Described[])
  .map((s) => ({ ...s, description: withoutWithheldNames(groundedDescription(s, scenes, glossary), glossary, s.startMs, s.endMs) }))
const voiced = new Set(cues.map((c) => c.shotIndex))
const budgets = editBudgets(cues)
const prevAction = (i: number) => { for (let k = i - 1; k >= 0; k--) if (!isTextCue(cues[k]!)) return k; return -1 }
/**
 * Spike guard change ("carried look"): a glossary character's look words count as already said for a cue when an earlier cue of the
 * same scene (as heard) gave them and this cue still refers to the character (pronoun, kind noun or revealed name). So "She smiles."
 * may replace "A young woman with short red hair smiles." once the scene has said "red hair" — but never in a scene's first mention.
 */
const hyph = (t: string) => t.replace(/\b(\w+)-haired\b/gi, '$1 hair')
const GENERIC = new Set(['young', 'old', 'small', 'big', 'otherwise', 'when', 'first', 'found', 'out', 'carrying', 'holding', 'staff', 'pipe', 'long'].map(stem))
const chars = glossary.characters.map((c) => {
  const kind = /\b(woman|girl|man|boy|dragon|creature|figure)\b/i.exec(c.look)?.[1]?.toLowerCase() ?? 'figure'
  const pron = /woman|girl/.test(kind) ? 'she|her|herself' : /man|boy/.test(kind) ? 'he|him|his|himself' : 'it|its'
  return { name: c.name, kind, look: new Set(contentWords(hyph(c.look)).map(stem).filter((w) => !GENERIC.has(w) && w !== stem(kind))), ref: new RegExp(`\\b(${pron}|${kind}|${c.name})\\b`, 'i') }
})
function carriedLook(i: number, heard: readonly string[]): Set<string> {
  const sc = sceneOf(scenes, cues[i]!.shotIndex)?.id, out = new Set<string>()
  for (let k = 0; k < i; k++) {
    if (isTextCue(cues[k]!) || sceneOf(scenes, cues[k]!.shotIndex)?.id !== sc) continue
    const said = contentWords(hyph(heard[k]!)).map(stem)
    for (const ch of chars) { const hit = said.filter((w) => ch.look.has(w)); if (hit.length >= 2 || (hit.length && ch.ref.test(heard[k]!))) [...hit, stem(ch.kind)].forEach((w) => out.add(w)) }
  }
  return out
}
/** The old text with the carried look words removed (for the keeps-facts guard only), when the proposal still refers to that character. */
function withoutCarried(old: string, proposed: string, carried: Set<string>): string {
  const drop = new Set([...carried].filter((w) => chars.some((ch) => (ch.look.has(w) || w === stem(ch.kind)) && ch.ref.test(proposed) && ch.ref.test(old))))
  return hyph(old).split(/(\s+)/).filter((tok) => !drop.has(stem(tok.toLowerCase().replace(/[^a-z']/g, '')))).join('').replace(/\s+/g, ' ')
}
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
const limitOf = (i: number) => { const c = cues[i]!, n = cues[i + 1]; return Math.min(c.limitMs ?? Infinity, n ? n.startMs - NEXT_CUE_SPACING_MS : Infinity) }

// ─── the request ────────────────────────────────────────────────────────────────────────────────────────────────────────
const SYSTEM = `You are the narrator of an audio description track for blind and low-vision viewers of an animated film, in English. Each shot was described on its own, so the script reads as a list of separate observations. Rewrite it so it flows as ONE connected narration, the way a nature-documentary narrator carries the listener from moment to moment — while staying a strict audio description.

The input gives, per cue: its number, time, the text as now voiced, under "sources" the checked descriptions of the shots this cue covers (the only evidence of what is on screen), "mustStillSay" (facts this cue must still state; another form of the word is fine — it already leaves out the look of anyone the viewer met earlier in this scene, so refer to them as "she" or "the dragon"), "maxWords" (hard limit: count your words), "mayName" (the only names allowed in this cue), and "newScene" with the place when the cue opens a new scene. "heardJustBefore" is what the viewer heard just before this window, already rewritten. A cue marked fixed is on-screen text: do not return it.

Continuity — do this:
- Carry referents. Once a person or creature was introduced in the previous cue or two, call them "she", "he", "it" (only when they were in one of the last two cues and no one else could be meant), or "the young woman", "the dragon" — never repeat the full look ("a young woman with short red hair") every cue. Give the look again only when a new scene starts after a long break or when two similar figures could be confused.
- Use "the" for anything already introduced, "a" the first time.
- Link cues with plain connectives: "then", "now", "as", "while", "and". Use "again" or "still" only when the sources or the previous cue show the same action or state continuing.
- Open a new scene by saying where we are, in the words of its sources or setting, once.
- Vary the openings: lead with the action verb or the place, not always with the person. Mix one short sentence with a longer one.
- Warmth comes from precise, vivid verbs and concrete nouns already in the sources (cradles, soars, trudges), and from rhythm — never from adjectives of feeling or judgement.

Audio description rules — never break these:
1. Every fact comes from this cue's sources or text, or from an earlier cue (for who someone is). Never add a person, object, action, colour, body part, place, time of day, weather or on-screen text the sources do not state.
2. Never say what anyone thinks, feels, wants, intends or remembers; no "seems", no "as if", no metaphors; never hint at what happens later; no "we see", no camera words.
3. Keep every word of mustStillSay (or a form of it). A dropped fact is never allowed.
4. At most maxWords words. Fewer is fine. If you cannot improve a cue within maxWords, return it unchanged.
5. Present tense, active voice, complete sentences with a capital letter and a full stop.
6. Names: only the ones in that cue's mayName; otherwise the look or "she"/"the dragon".
7. Keep any "Words appear: …" clause exactly as written.
8. Do not merge, split, reorder, add or drop cues.

Reply with one JSON object only, no prose, no code fence: {"cues":[{"cue":<number>,"text":"<the rewritten cue>"}]} — one entry for every cue that is not fixed, in order.`

function windowInput(from: number, to: number, final: string[]) {
  const items = []
  for (let i = from; i < to; i++) {
    const c = cues[i]!
    if (isTextCue(c)) { items.push({ cue: i, at: mmss(c.startMs), fixed: true, text: c.text }); continue }
    const p = prevAction(i), prevShot = p < 0 ? -1 : cues[p]!.shotIndex
    const sources = shots.filter((s) => s.index > prevShot && s.index <= c.shotIndex && !s.sameAsPrev && s.description).map((s) => s.description)
    const sc = sceneOf(scenes, c.shotIndex), psc = p < 0 ? undefined : sceneOf(scenes, cues[p]!.shotIndex)
    const mayName = allowedNames(glossary, c.startMs, spoken.filter((s) => s.at * 1000 <= c.startMs).map((s) => s.name))
    items.push({ cue: i, at: mmss(c.startMs), ...(c.extended ? { extended: true } : {}), ...(sc && sc.id !== psc?.id ? { newScene: sc.setting } : {}), text: c.text, sources, mustStillSay: factWords(c.text, p < 0 ? '' : cues[p]!.text).filter((w) => !carriedLook(i, cues.map((x) => x.text)).has(stem(w))), maxWords: budgets[i], mayName })
  }
  const people = glossary.characters.map((c) => (isProperName(c) && nameRevealed(c, cues[to - 1]!.startMs) ? { look: c.look, short: shortOf(c), name: c.name } : { look: c.look, short: shortOf(c) }))
  const heard = final.slice(Math.max(0, from - CONTEXT), from)
  return JSON.stringify({ people, ...(heard.length ? { heardJustBefore: heard } : {}), cues: items })
}

async function call(input: string) {
  const [pin, pout] = PRICES[MODEL] ?? [5, 25]
  const worst = spent + ((input.length + SYSTEM.length) / 3.5 * pin + 3000 * pout) / 1e6
  if (worst > CAP) throw new Error(`spend cap: $${spent.toFixed(4)} spent, next call could reach $${worst.toFixed(4)} > $${CAP}`)
  const r = await bedrock.send(new ConverseCommand({ modelId: MODEL, system: [{ text: SYSTEM }], messages: [{ role: 'user', content: [{ text: `Input:\n${input}\n\nReply with the JSON object only.` }] }], inferenceConfig: { maxTokens: 3000, temperature: 0 } }))
  usage.inputTokens += r.usage?.inputTokens ?? 0; usage.outputTokens += r.usage?.outputTokens ?? 0; usage.calls++
  spent += ((r.usage?.inputTokens ?? 0) * pin + (r.usage?.outputTokens ?? 0) * pout) / 1e6
  const text = r.output?.message?.content?.find((c) => c.text)?.text ?? ''
  const a = text.indexOf('{'), b = text.lastIndexOf('}')
  const body = text.slice(a, b + 1)
  try { return (JSON.parse(body) as { cues: { cue: number; text: string }[] }).cues } catch {}
  // lenient: pull each {"cue":n,"text":"…"} object on its own (a model sometimes truncates or appends after the array)
  const out: { cue: number; text: string }[] = []
  for (const m of body.matchAll(/\{\s*"cue"\s*:\s*(\d+)\s*,\s*"text"\s*:\s*("(?:[^"\\]|\\.)*")\s*\}/g)) { try { out.push({ cue: Number(m[1]), text: JSON.parse(m[2]!) }) } catch {} }
  if (!out.length) console.warn('unreadable reply', text.slice(-300))
  else if (r.stopReason !== 'end_turn') console.warn(`stop ${r.stopReason}; salvaged ${out.length} cues`)
  return out
}

// ─── the guards ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const FEMALE = /\b(woman|girl|she|her|sintel)\b/i, MALE = /\b(man|boy|he|him|his)\b/i
/** Spike extension: a gendered pronoun is checked as the noun it stands for when that referent is licensed; else left (and rejected as new). */
function resolvePronouns(text: string, i: number, final: string[]): { resolved: string; unlicensed: string[] } {
  // the referent must be in one of the last two action cues, within 20 s and in the same scene
  const sc = sceneOf(scenes, cues[i]!.shotIndex)?.id, back: string[] = []
  for (let p = prevAction(i); p >= 0 && back.length < 2; p = prevAction(p)) {
    if (cues[i]!.startMs - cues[p]!.startMs > 20_000 || sceneOf(scenes, cues[p]!.shotIndex)?.id !== sc) break
    back.push(final[p]!)
  }
  const prevText = back.join(' ')
  const unlicensed: string[] = []
  let seenF = FEMALE.test(prevText), seenM = MALE.test(prevText.replace(/\bwoman\b/gi, ''))
  const own = new Set(cues[i]!.text.toLowerCase().split(/[^a-z']+/)) // a pronoun the old cue already had traces as itself
  const out = text.split(/(\s+)/).map((tok) => {
    const w = tok.toLowerCase().replace(/[^a-z']/g, '')
    if (own.has(w)) return tok
    if (/^(she|her|hers|herself)$/.test(w)) { if (seenF) return tok.replace(/[A-Za-z']+/, 'woman'); unlicensed.push(w) }
    else if (/^(he|him|his|himself)$/.test(w)) { if (seenM) return tok.replace(/[A-Za-z']+/, 'man'); unlicensed.push(w) }
    else { if (/^(woman|girl|sintel)$/.test(w)) seenF = true; if (/^(man|boy)$/.test(w)) seenM = true }
    return tok
  }).join('')
  return { resolved: out, unlicensed }
}
const NARRATIVE_FREE = /\b(now|here)\b/gi // connectives that state no fact

interface Row { i: number; at: string; extended: boolean; fixed: boolean; old: string; proposed?: string; final: string; accepted: boolean; edit?: string; fit?: string; verify?: string; sentence?: string; pronoun?: string }
const final: string[] = cues.map((c) => c.text)
const rows: Row[] = []
const windows: Array<[number, number]> = []
for (let f = 0; f < cues.length; f += WINDOW) windows.push([f, Math.min(cues.length, f + WINDOW)])
const only = process.env.ONLY?.split(',').map(Number) // e.g. ONLY=1,5 to run selected windows

for (const [wi, [from, to]] of windows.entries()) {
  let reply: { cue: number; text: string }[] = []
  if (!only || only.includes(wi)) {
    try { reply = await call(windowInput(from, to, final)) } catch (e) { console.warn(`window ${from}-${to - 1}:`, (e as Error).message); if (/spend cap/.test((e as Error).message)) break }
  }
  for (let i = from; i < to; i++) {
    const c = cues[i]!, row: Row = { i, at: mmss(c.startMs), extended: c.extended, fixed: isTextCue(c), old: c.text, final: c.text, accepted: false }
    rows.push(row)
    const proposed = reply.find((r) => r.cue === i)?.text?.replace(/\s+/g, ' ').trim()
    if (row.fixed || !proposed || proposed === c.text) { if (proposed) row.proposed = proposed; continue }
    row.proposed = proposed
    // edit guards (05b applyEdits), pronouns resolved for the faithful / keeps-facts check, budget on the real text
    const { resolved, unlicensed } = resolvePronouns(proposed, i, final)
    if (unlicensed.length) row.pronoun = `unlicensed pronoun: ${unlicensed.join(', ')}`
    const forGuard = hyph(resolved).replace(NARRATIVE_FREE, '').replace(/\s+/g, ' ').replace(/^\W+/, '').trim()
    const b = [...budgets]; b[i] = budgets[i]! + Math.max(0, wordCount(forGuard) - wordCount(proposed))
    const current = cues.map((x, k) => ({ ...x, text: final[k]! }))
    const base = cues.map((x, k) => (k === i ? { ...x, text: withoutCarried(x.text, proposed, carriedLook(i, final)) } : x))
    const g = applyEdits(base, shots, [{ cue: i, text: forGuard[0] ? forGuard[0].toUpperCase() + forGuard.slice(1) : forGuard }], b, [0, cues.length], 'en', { glossary, spoken, scenes, current })
    if (g.rejected.length) row.edit = g.rejected[0]!.reason
    else if (wordCount(proposed) > budgets[i]!) row.edit = `over budget (${wordCount(proposed)} > ${budgets[i]} words)`
    // fit (decision 0009 estimate) — and whether the old text passed the same estimate
    const n = wordCount(proposed)
    if (c.extended) { if (n > EXTENDED_WORDS) row.fit = `extended over ${EXTENDED_WORDS} words (${n})` }
    else {
      const room = limitOf(i) - c.startMs, est = estimateClipMs(n), oldEst = estimateClipMs(wordCount(c.text))
      if (est > room) row.fit = `estimate ${est} ms > room ${room} ms${oldEst > room ? ' (old text also over)' : ''}`
    }
    // verify (informational): a same-shot deletion guard, new connective/pronoun words fail it by design
    const v = checkVerified(c.text, { text: proposed, removed: [] }, { maxWords: wordCap(c.text, budgets[i]!), names: allowedNames(glossary, c.startMs), language: 'en' })
    if (!v.applied) row.verify = v.reason
    const s = readsAsSentences(c.text, proposed, 'en')
    if (s) row.sentence = s
    const fitOk = !row.fit || /old text also over/.test(row.fit)
    if (!row.edit && !row.pronoun && fitOk) { row.accepted = true; row.final = polishCue(proposed, 'en'); final[i] = row.final }
  }
}

await mkdir(new URL('./out/', import.meta.url), { recursive: true })
const tag = MODEL.replace(/[^a-z0-9.-]/gi, '_')
const summary = {
  model: MODEL, usage, spentUsd: Number(spent.toFixed(4)),
  cues: cues.length, fixed: rows.filter((r) => r.fixed).length,
  proposedChanges: rows.filter((r) => r.proposed && r.proposed !== r.old).length,
  accepted: rows.filter((r) => r.accepted).length,
  failEdit: rows.filter((r) => r.edit).length, failPronoun: rows.filter((r) => r.pronoun).length,
  failFit: rows.filter((r) => r.fit && !/old text also over/.test(r.fit)).length, fitOverAlsoOld: rows.filter((r) => r.fit && /old text also over/.test(r.fit)).length,
  failVerifyInformational: rows.filter((r) => r.verify).length, failShortenerSentenceInformational: rows.filter((r) => r.sentence).length,
  editReasons: Object.entries(rows.filter((r) => r.edit).reduce<Record<string, number>>((m, r) => { const k = r.edit!.replace(/:.*/, ''); m[k] = (m[k] ?? 0) + 1; return m }, {})),
}
console.log(JSON.stringify(summary, null, 1))
await writeFile(new URL(`./out/${tag}.json`, import.meta.url), JSON.stringify({ summary, rows }, null, 1))
