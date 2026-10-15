import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Ctx } from './index'
import type { Described } from './04-describe'
import type { Word } from './03-speech'
import { groundedDescription, textClauses, type FitCue } from './05-fit'
import { NEXT_CUE_SPACING_MS } from './06-voice'
import { sentences, textSpans } from '../textClause'
import { contentWords, stem } from '../contentWords'
import { editReadsAsSentences } from '../sentenceGuard'
import { editFallbackModelId, editModelId, narrativeRequest, shortenEditWithNovaLite, stripFence, type EditConverse, type NarrativeCueInput, type NarrativeInput, bedrockEditSend } from '../prompts'
import { carriedLook, excusedByCarry, faithfulText, pronounProblems, unsourcedContinuity, type NarrativeView } from '../narrative'
import { rateFactor } from '../voiceProfile'
import { meter } from '../cost'
import { allowedNames, EMPTY_GLOSSARY, glossaryFor, glossarySettingStems, isEmpty, isProperName, matchedCharacters, nameEvidence, nameRevealed, placeStems, shortOf, withoutName, withoutWithheldNames, type Glossary, type NameSource } from '../glossary'
import { foreignPlaceStems, sceneStems, statesPlace } from '../sceneSetting'
import { knownNames } from './04-describe'
import { readScenes, sceneOf, type Scene } from './04c-scenes'

export { contentWords, stem } from '../contentWords'

/** fit's cues as fit wrote them (05-fit); the edit step always starts from this file, so re-running it (a finish-job retry, --from edit) is idempotent. */
export const FIT_CUES_FILE = 'cues.fit.json'

/**
 * The narrative pass (docs/decisions/0017-narrative-pass.md; it upgrades the scene-level edit pass of DESC-018, decision 0006): after
 * fit, before voice. Every shot was described, verified and placed on its own, so the script reads as separate observations. One
 * text-only call per window of cues (one scene at a time) rewrites the voiced cues as one connected narration — a referent carried
 * ("she", "the dragon"), "the" for what was introduced, plain connectives, the place said once per scene — and nothing more. Timing is
 * fit's: the pass never adds, drops, moves or reorders a cue, and never touches an on-screen text cue (DESC-017's split "Words appear: …"
 * cues are frozen).
 *
 * Per cue the model sees: its text, the verified descriptions of the shots it covers (dropped ones included), the facts it must keep
 * (factWords minus the look words the scene already said: narrative carriedLook), its word budget (fit's room at the voice's rate),
 * the names allowed at its start (glossary reveal times and unnamedIn windows, the dialogue), and whether it opens a scene; for the
 * window, the glossary looks (never roles) and the last NARRATIVE_CONTEXT cues as heard. No synopsis. Plain JSON reply, no forced tool;
 * DeepSeek v3.2 first, Nova Pro when that call fails or its reply is unreadable (prompts editModelId / editFallbackModelId).
 *
 * Every rewrite passes the 05b guards (applyEdits, with the narrative guards of ../narrative) before it replaces the original; then the
 * repeat guard, the name grounding pass (unnamedIn withholding, reveal times) and the evidence run on every final cue, as before.
 * polishCue (0015) and 06-voice's shortenKeepingAction still run later, on the rewritten text. verify's no-new-word check (04b) and
 * fit's shortener sentence check (0011) ran before this step, on the sources; they are deletion-only and never see a rewrite.
 * An unreadable reply, or a failed call, keeps the window's original cues (the step is an improvement, never a dependency).
 * Reads cues.fit.json (cues.json when an older work dir has none), writes cues.json (same length and order) and edit.json (what
 * changed, what was rejected, the models, usage) for the evaluation. DESCRIBE_EDIT=0 makes cues.json fit's cues again, without a call.
 * A work dir without scenes.json (made before 04c-scenes) is one scene: windows of EDIT_CHUNK_CUES, no place rules.
 */
export async function editCues(ctx: Ctx, send: EditConverse = bedrockEditSend) {
  const fitFile = `${ctx.work}/${FIT_CUES_FILE}`
  const source = await readFile(fitFile, 'utf8').then(() => fitFile, () => `${ctx.work}/cues.json`)
  if (source !== fitFile) console.warn(`edit: no ${FIT_CUES_FILE} in ${ctx.work} (fit ran before DESC-018); editing cues.json in place, which is not idempotent`)
  const cues = JSON.parse(await readFile(source, 'utf8')) as FitCue[]
  if (process.env.DESCRIBE_EDIT === '0') {
    console.log('edit: skipped (DESCRIBE_EDIT=0)')
    if (source === fitFile) await copyFile(fitFile, `${ctx.work}/cues.json`)
    await writeFile(`${ctx.work}/edit.json`, JSON.stringify({ skipped: true, applied: [], rejected: [] }))
    return
  }
  const shots = JSON.parse(await readFile(`${ctx.work}/described.json`, 'utf8')) as Described[]
  const words = JSON.parse(await readFile(`${ctx.work}/words.json`, 'utf8').catch(() => '[]')) as Word[]
  const scenes = await readScenes(ctx.work) // DESC-029: windows per scene, setting and name rules; absent in older work dirs (one scene)
  const report = await editScene(cues, shots, words, ctx.language, send, ctx.signal, undefined, { scenes, glossary: glossaryFor(ctx), wps: EDIT_WPS * rateFactor(ctx.voice, ctx.engine) })
  console.log(`edit: ${report.applied.length} of ${cues.length} cues revised, ${report.rejected.length} edits rejected (${report.models.join(', ') || 'no call'})`)
  await writeFile(`${ctx.work}/cues.json`, JSON.stringify(report.cues, null, 2))
  await writeFile(`${ctx.work}/edit.json`, JSON.stringify({ pass: 'narrative', model: report.model, models: report.models, applied: report.applied, rejected: report.rejected, usage: report.usage, shorteningCalls: report.shorteningCalls, evidence: report.evidence }, null, 2))
}

/** What the edit pass knows of the title beyond its cues (DESC-029): the scenes (04c-scenes), the glossary (../glossary) and the voice's edit rate. */
export interface EditContext { scenes?: readonly Scene[]; glossary?: Glossary; /** words per second for the budgets (EDIT_WPS × ../voiceProfile rateFactor) */ wps?: number }

/**
 * The windows of one Converse call each, as [from, to) cue ranges: one scene at a time when scenes are known (consecutive cues whose shot
 * is in one scene; a scene of more than EDIT_CHUNK_CUES cues is split), else blocks of EDIT_CHUNK_CUES cues as before.
 */
export function editWindows(cues: readonly FitCue[], scenes?: readonly Scene[]): Array<[number, number]> {
  const out: Array<[number, number]> = []
  if (!scenes?.length) { for (let from = 0; from < cues.length; from += EDIT_CHUNK_CUES) out.push([from, Math.min(cues.length, from + EDIT_CHUNK_CUES)]); return out }
  let from = 0
  for (let i = 1; i <= cues.length; i++) {
    const same = i < cues.length && sceneOf(scenes, cues[i]!.shotIndex)?.id === sceneOf(scenes, cues[from]!.shotIndex)?.id
    if (same && i - from < EDIT_CHUNK_CUES) continue
    out.push([from, i])
    from = i
  }
  return out
}

/** Names the dialogue says, each with the first time (s) knownNames allows it: the dialogue evidence of the grounding guard. */
export function spokenNames(words: readonly Word[], language: 'en' | 'de'): { name: string; at: number }[] {
  const out: { name: string; at: number }[] = []
  for (const w of words) for (const n of knownNames(words as Word[], w.end * 1000, language)) if (!out.some((x) => x.name === n)) out.push({ name: n, at: w.end })
  return out
}

/** Per cue, the names and place words it says and where each comes from (edit.json `evidence`; like SDH's speaker evidence, #39 / 0008). */
export interface CueEvidence { i: number; names: NameSource[]; setting: { scene?: number; words: { word: string; source: 'description' | 'glossary' | 'scene'; shot?: number; setting?: string }[] } }

/** Cues per Converse call: one scene, split at this many (≈ 30 output tokens per cue: well inside the reply budget). */
export const EDIT_CHUNK_CUES = 30
/** The cues before a window the model hears again (heardJustBefore), as rewritten (the spike's 6). */
export const NARRATIVE_CONTEXT = 6
/**
 * Words per second the edit budget assumes for Joanna neural (other voices: × ../voiceProfile rateFactor). fit budgets at WPS (2.67);
 * Polly Joanna neural on sintel-90-150-r2 ran at 2.13 words/s net of the 150 ms lead-in (43 words in 20.2 s), and sentence ends cost
 * ~0.4 s each, so a cue lengthened to fit's budget would often overrun its limit and be shortened or dropped by 06-voice. 2.2 keeps a
 * lengthened cue inside voice's tolerance.
 */
export const EDIT_WPS = 2.2

export interface TokenUsage { inputTokens: number; outputTokens: number }
export interface EditReport { cues: FitCue[]; applied: { i: number; from: string; to: string; by?: 'repeat' | 'name' }[]; rejected: { i: number; text: string; reason: string }[]; model: string; /** the models whose replies were used, in order of first use */ models: string[]; usage: TokenUsage; shorteningCalls: number; evidence: CueEvidence[] }

/** Shortens `text` to maxWords keeping every fact of `keep` (the cue's original text): one Nova Lite call by default (with its usage); tests inject their own. */
export type ShortenReply = string | { text: string; usage?: Partial<TokenUsage> }
export type Shorten = (text: string, maxWords: number, keep: string, mustSay: string[]) => Promise<ShortenReply> | ShortenReply

/** An extended cue that is only on-screen text (DESC-017 split it from its action, or voice did): frozen for this pass. */
export const isTextCue = (c: FitCue) => c.extended && textClauses(c.text)?.rest === ''
/** The previous cue that carries action (not an on-screen text cue), the one continuity is measured against; -1 when none. */
const prevActionIndex = (cues: readonly FitCue[], i: number) => { for (let k = i - 1; k >= 0; k--) if (!isTextCue(cues[k]!)) return k; return -1 }
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

/** The facts cue i must keep as the request names them: factWords minus the look words its scene already said (narrative carriedLook). */
export function mustStillSay(cues: readonly FitCue[], i: number, heard: (k: number) => string, scenes: readonly Scene[] | undefined, glossary: Glossary): string[] {
  const p = prevActionIndex(cues, i)
  const carried = carriedLook({ cues, heard, scenes, glossary, isTextCue }, i)
  return factWords(cues[i]!.text, p < 0 ? '' : heard(p)).filter((w) => !carried.has(stem(w)))
}

/**
 * The narrative request's input for cues [from, to): `heard` is the text of each cue as the viewer hears it so far (accepted rewrites of
 * earlier windows), the source of heardJustBefore, the previous cue's facts and the carried look.
 */
export function narrativeInput(cues: readonly FitCue[], shots: readonly Described[], [from, to]: [number, number], language: 'en' | 'de', budgets: readonly number[], heard: (k: number) => string, guard: EditGuard): NarrativeInput {
  const { glossary, scenes, spoken } = guard
  const items: NarrativeCueInput[] = []
  const mayNames = new Set<string>()
  for (let i = from; i < to; i++) {
    const c = cues[i]!
    if (isTextCue(c)) { items.push({ cue: i, at: mmss(c.startMs), fixed: true, text: c.text }); continue }
    const p = prevActionIndex(cues, i)
    const sc = scenes?.length ? sceneOf(scenes, c.shotIndex) : undefined
    const psc = scenes?.length && p >= 0 ? sceneOf(scenes, cues[p]!.shotIndex) : undefined
    const mayName = allowedNames(glossary, c.startMs, spoken.filter((s) => s.at * 1000 <= c.startMs).map((s) => s.name))
    mayName.forEach((n) => mayNames.add(n))
    items.push({
      cue: i, at: mmss(c.startMs), ...(c.extended ? { extended: true as const } : {}),
      ...(sc && sc.id !== psc?.id ? { newScene: { place: sc.setting, ...(sc.returning ? { returning: true as const } : {}) } } : {}),
      text: c.text, sources: cueShotTexts(cues, shots, i).filter(Boolean), mustStillSay: mustStillSay(cues, i, heard, scenes, glossary), maxWords: budgets[i]!, mayName,
    })
  }
  const people = isEmpty(glossary) ? undefined : glossary.characters.map((c) => ({ look: c.look, short: shortOf(c), ...(isProperName(c) && mayNames.has(c.name) ? { name: c.name } : {}) }))
  const before = Array.from({ length: from }, (_, k) => k).filter((k) => !isTextCue(cues[k]!)).slice(-NARRATIVE_CONTEXT).map(heard)
  return { language, ...(people?.length ? { people } : {}), ...(before.length ? { heardJustBefore: before } : {}), cues: items }
}

/**
 * The pass over one title's cues, pure apart from `send` and `shorten`; fixtures in test/edit.test.ts and test/narrative.test.ts.
 * An edit over its budget gets one shortening call (Nova Lite), and the shortened text goes through the same guards; it is dropped
 * when it still does not fit.
 */
export async function editScene(cues: FitCue[], shots: Described[], words: Word[], language: 'en' | 'de', send: EditConverse, signal?: AbortSignal, shorten: Shorten = (t, n, keep, must) => shortenEditWithNovaLite(t, n, keep, must, language), context: EditContext = {}): Promise<EditReport> {
  // as fit read them (groundedDescription): "Darkness." never comes back through an edit, nor a bare "Dim." lead, nor another scene's place;
  // and no name withheld in the shot (unnamedIn, decision 0012 "Name windows"), so the model is never shown one there (a missed shot's text)
  shots = shots.map((s) => ({ ...s, description: withoutWithheldNames(groundedDescription(s, context.scenes, context.glossary ?? EMPTY_GLOSSARY), context.glossary ?? EMPTY_GLOSSARY, s.startMs, s.endMs) }))
  const model = editModelId()
  const models = [...new Set([model, editFallbackModelId()].filter(Boolean))]
  const report: EditReport = { cues: cues.map((c) => ({ ...c })), applied: [], rejected: [], model, models: [], usage: { inputTokens: 0, outputTokens: 0 }, shorteningCalls: 0, evidence: [] }
  if (!cues.length) return report
  const glossary = context.glossary ?? EMPTY_GLOSSARY, scenes = context.scenes
  const guard: EditGuard = { glossary, spoken: spokenNames(words, language), scenes, narrative: true }
  const budgets = editBudgets(cues, context.wps)
  const add = (u: Partial<TokenUsage> | undefined) => { report.usage.inputTokens += u?.inputTokens ?? 0; report.usage.outputTokens += u?.outputTokens ?? 0 }
  for (const [from, to] of editWindows(cues, scenes)) {
    const input = narrativeInput(cues, shots, [from, to], language, budgets, (k) => report.cues[k]!.text, guard)
    let edits: Edit[] | undefined
    // The first model; when its call fails or its reply is unreadable, the fallback once. A second failure keeps the window's cues.
    for (const m of models) {
      try {
        const r = await send(narrativeRequest(input, m))
        meter()?.bedrock(m, r.usage)
        add(r.usage)
        const content = r.output?.message?.content ?? []
        const reply = content.find((c) => c.toolUse)?.toolUse?.input ?? content.find((c) => c.text)?.text ?? ''
        edits = replyEdits(reply)
        if (edits) { if (!report.models.includes(m)) report.models.push(m); break }
        console.warn(`edit: ${m} reply for cues ${from}–${to - 1} is not {"cues":[…]}${m === models.at(-1) ? '; keeping the original cues' : '; asking the fallback model'}`, (typeof reply === 'string' ? reply : JSON.stringify(reply) ?? '').slice(0, 200))
      } catch (e) {
        if (signal?.aborted) throw e
        console.warn(`edit: ${m} call failed for cues ${from}–${to - 1}${m === models.at(-1) ? '; keeping the original cues' : '; asking the fallback model'}:`, (e as Error)?.message ?? e)
      }
    }
    if (!edits) continue
    const out = applyEdits(cues, shots, edits, budgets, [from, to], language, { ...guard, current: report.cues })
    const retry: Edit[] = []
    for (const r of out.rejected) {
      if (!r.reason.startsWith('over budget')) { report.rejected.push(r); continue }
      let shorter: string
      try {
        report.shorteningCalls++
        const s = await shorten(r.text, budgets[r.i]!, cues[r.i]!.text, mustStillSay(cues, r.i, (k) => report.cues[k]!.text, scenes, glossary))
        if (typeof s === 'string') shorter = cleanShortening(s); else { shorter = cleanShortening(s.text); add(s.usage) }
      } catch (e) { if (signal?.aborted) throw e; report.rejected.push(r); continue }
      // An empty reply, or one that was only an annotation, is no shortening: the edit's own over-budget rejection stands.
      if (shorter && shorter !== r.text) retry.push({ cue: r.i, text: shorter }); else report.rejected.push(r)
    }
    // the retry sees the window's accepted rewrites as heard (a pronoun licensed by the cue before it)
    const current = report.cues.map((c, k) => out.applied.find((a) => a.i === k) ? { ...c, text: out.cues[k]!.text } : c)
    const again = retry.length ? applyEdits(cues, shots, retry, budgets, [from, to], language, { ...guard, current }) : { applied: [], rejected: [] }
    for (const a of [...out.applied, ...again.applied]) { report.cues[a.i]!.text = a.to; report.cues[a.i]!.wordCount = wordCount(a.to); report.applied.push(a) }
    report.rejected.push(...again.rejected.map((r) => ({ ...r, reason: `${r.reason} (after shortening)` })))
  }
  // The model's repetition removal is not reliable (sintel-90-150-r2, 2026-10-14: no proposal removed the second "Snowy mountains."),
  // so a lead sentence the viewer has just heard is dropped deterministically, after the model's edits and whether or not a call worked.
  // A trim of a cue the model already edited is its own entry (from = the model's text), so edit.json shows both steps.
  const deduped = dropRepeatedLeads(report.cues, language)
  deduped.forEach((c, i) => {
    if (c.text === report.cues[i]!.text) return
    report.applied.push({ i, from: report.cues[i]!.text, to: c.text, by: 'repeat' })
    report.cues[i] = c
  })
  // DESC-029 grounding guard, on every final cue (the rewrites and fit's own text alike): a glossary name not yet revealed is
  // replaced by the character's short look; each cue records where its names and place words come from (edit.json `evidence`).
  // A name withheld at the cue's start (unnamedIn, decision 0012 "Name windows") is replaced by the neutral reference ("the dragon"),
  // with its appositive look phrase: whoever wrote it, the describer included, and whatever the dialogue said.
  report.cues.forEach((c, i) => {
    if (isTextCue(c)) return
    const check = nameEvidence(c.text, c.startMs, glossary, guard.spoken, cueShotTexts(cues, shots, i))
    const text = check.withheld.reduce((t, n) => withoutName(t, n, glossary, { withheld: true }), [...check.premature, ...check.unbound].reduce((t, n) => withoutName(t, n, glossary), c.text))
    if (text !== c.text) { report.applied.push({ i, from: c.text, to: text, by: 'name' }); report.cues[i] = { ...c, text, wordCount: wordCount(text) } }
    report.evidence.push(cueEvidence(i, report.cues[i]!, shots, guard, cueShotTexts(cues, shots, i)))
  })
  report.applied.sort((x, y) => x.i - y.i) // stable: a cue's model edit stays before its trim
  for (const r of report.rejected) console.warn(`edit: rejected edit of cue ${r.i} (${r.reason}):`, JSON.stringify(r.text))
  return report
}

/**
 * What the guards know of the title (DESC-029): its glossary, the names the dialogue says (spokenNames), the scenes, and `current` —
 * the cues as the viewer hears them so far (earlier windows' accepted edits), for "the place was already said".
 */
export interface EditGuard { glossary: Glossary; spoken: readonly { name: string; at: number }[]; scenes?: readonly Scene[]; current?: readonly FitCue[]; /** the narrative pass's guards (../narrative): pronoun licence, carried look, free and source-only words */ narrative?: boolean }

/** The descriptions of cue i's shots: the shots between the previous action cue and its own (dropped ones it may absorb included). */
export function cueShotTexts(cues: readonly FitCue[], shots: readonly Described[], i: number): string[] {
  const p = prevActionIndex(cues, i), prevShot = p < 0 ? -1 : cues[p]!.shotIndex
  return shots.filter((s) => s.index > prevShot && s.index <= cues[i]!.shotIndex && !s.sameAsPrev).map((s) => s.description)
}

/**
 * One cue's evidence: its names (nameEvidence: glossary once revealed, or the dialogue), names with none (`unbacked`: a capitalised word
 * no glossary or dialogue backs — left in a fit cue for review, rejected in an edit), and its place words (PLACE_NOUNS and the scene's
 * place words), each from a description of the scene's shots, the scene label's evidence, or the glossary.
 */
export function cueEvidence(i: number, c: FitCue, shots: readonly Described[], guard: EditGuard, own: readonly string[] = shots.filter((s) => s.index === c.shotIndex).map((s) => s.description)): CueEvidence & { unbacked?: string[] } {
  const check = nameEvidence(c.text, c.startMs, guard.glossary, guard.spoken, own)
  const sc = guard.scenes ? sceneOf(guard.scenes, c.shotIndex) : undefined
  const sceneShots = sc ? shots.filter((s) => sc.shots.includes(s.index)) : shots.filter((s) => s.index === c.shotIndex)
  const extra = new Set([...glossarySettingStems(guard.glossary), ...(sc ? sceneStems(sc, guard.glossary) : [])])
  const placeWords = [...new Set(contentWords(c.text).filter((w) => placeStems(w, extra).length))]
  const setting: CueEvidence['setting'] = { ...(sc ? { scene: sc.id } : {}), words: [] }
  const unbacked = [...check.invented, ...check.premature, ...check.unbound, ...check.withheld]
  for (const w of placeWords) {
    const st = stem(w)
    const shot = sceneShots.find((s) => contentWords(s.description).some((x) => stem(x) === st))
    const label = sc?.evidence.find((e) => stem(e.word) === st)
    const set = guard.glossary.settings.find((s) => contentWords(`${s.name} ${s.look}`).some((x) => stem(x) === st))
    if (shot) setting.words.push({ word: w, source: 'description', shot: shot.index })
    else if (label) setting.words.push({ word: w, source: 'scene', ...(label.shot !== undefined ? { shot: label.shot } : {}), ...(label.setting ? { setting: label.setting } : {}) })
    else if (set) setting.words.push({ word: w, source: 'glossary', setting: set.name })
    else unbacked.push(w)
  }
  return { i, names: check.names, setting, ...(unbacked.length ? { unbacked } : {}) }
}

/** The repeat guard compares a cue only with the previous action cue that starts at most this long before it. */
export const REPEAT_WINDOW_MS = 15_000

/** Words that open a sentence about someone already named: a lead before one is kept, or "He stops." would lose its referent. */
const PRONOUN_OPENERS = new Set(['he', 'she', 'it', 'they', 'his', 'her', 'its', 'their', 'him', 'them', 'er', 'sie', 'es', 'ihr', 'ihre', 'ihren', 'ihm', 'ihn', 'ihnen', 'sein', 'seine', 'seinen', 'seiner'])
/** Abbreviations whose period is not a sentence end; ../textClause's plain split cuts after them ("Mr." | "Smith walks."). */
const ABBREVIATION = /(?:^|\s)(?:mr|mrs|ms|dr|st|jr|sr|prof|mt|lt|sgt|capt|gen|col|no|vs|etc|hr|fr|nr|bzw|ca|str)\.$/i
/** A unit that ends a sentence: . ! ? or … with optional closing quotes or brackets after it (sentences() splits after . ! ? only; a unit ending in … is one it did not split). */
const SENTENCE_END = /[.!?…]["'”’»)\]]*$/

interface Unit { start: number; end: number; text: string; onScreen: boolean }
/**
 * `text` as units with their positions: ../textClause's sentences(), each on-screen text clause its own unit, with a unit that is
 * three characters or less or ends in an abbreviation joined to the next plain unit ("Mr. Jones sits." stays one sentence).
 */
function units(text: string): Unit[] {
  const spans = textSpans(text)
  const out: Unit[] = []
  let at = 0
  for (const u of sentences(text)) {
    const start = text.indexOf(u, at)
    if (start < 0) return [{ start: 0, end: text.length, text, onScreen: false }] // cannot place: one unit, never trimmed
    at = start + u.length
    const onScreen = spans.some((s) => s.start <= start && s.end >= at)
    const prev = out[out.length - 1]
    if (prev && !prev.onScreen && !onScreen && (prev.text.length <= 3 || ABBREVIATION.test(prev.text))) { prev.end = at; prev.text = text.slice(prev.start, at); continue }
    out.push({ start, end: at, text: u, onScreen })
  }
  return out
}
/** A negation (en, de): "The car is not burning." and "The car is burning." share every content word in order but say opposite things. */
const NEGATION = /(?:^|[^\p{L}])(?:not|no|never|cannot|nobody|nothing|none|nowhere|neither|nor|without|\p{L}+n['’]t|nicht|kein\p{L}*|nie|niemals|niemand|nichts|nirgends|ohne)(?![\p{L}])/iu
/** The only words the repeat guard ignores: the articles of the title's language. One set for both would make English "die", "den", "des" articles. */
const ARTICLES: Record<'en' | 'de', ReadonlySet<string>> = {
  en: new Set(['a', 'an', 'the']),
  de: new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines']),
}
/**
 * A sentence's words for the repeat guard: lower-cased, punctuation stripped (apostrophes and hyphens inside a word kept, and a minus
 * sign before a digit: "-5" ≠ "5"), the language's articles removed.
 */
const repeatWords = (t: string, language: 'en' | 'de') => t.toLowerCase().replace(/[^\p{L}\p{N}\s'’\-−]/gu, ' ').split(/\s+/)
  .map((w) => w.replace(/['’\-−]+$/u, '').replace(/^(?:['’]|[-−](?!\p{N}))+/u, '').replace(/^−/, '-'))
  .filter((w) => w && !ARTICLES[language].has(w))
/**
 * Does `earlier` say `unit`: the same words in the same order, only articles may differ (human decision 2026-10-14, PR #44 rounds 3–4).
 * Deliberately not ../contentWords: its STOP list drops direction words ("Das Licht geht an." / "…aus.", "flies to" / "from the tree")
 * and its Porter stem folds number ("A dog barks." / "Dogs bark."), so either would let an opposite or a new fact pass as a repeat.
 * The negation check is kept as a second, explicit guard.
 */
const saidIn = (unit: string, earlier: string, language: 'en' | 'de') => {
  if (NEGATION.test(unit) !== NEGATION.test(earlier)) return false
  const want = repeatWords(unit, language), have = repeatWords(earlier, language)
  return want.length > 0 && want.length === have.length && want.every((w, k) => w === have[k])
}

/**
 * The deterministic repeat guard (DESC-010 follow-up, ADR 0006): every shot is described from scratch, so two shots of one place both
 * open with it ("Snowy mountains. A lone figure walks left." / "Snowy mountains. A figure walks, falls. Logo fades."). A cue's leading
 * sentences are dropped, in order, while each one is said by ONE sentence of the previous action cue: the same words in the same
 * order with only articles allowed to differ (saidIn: no stop list, no stemming), and both negated or neither. Only the immediately
 * previous action cue (on-screen text cues skipped), and only when it starts within REPEAT_WINDOW_MS: a cut back to a place after another place keeps the place. The trim stops at the first unit
 * that is not a whole plain sentence (an on-screen text clause, or a piece cut by a mid-sentence one, which does not end in . ! ? …),
 * and nothing is dropped when the text left would not open with a capital letter or would open with a pronoun ("He stops."), or when
 * no plain sentence would be left. The rest of the text is kept verbatim; timing never changes. Pure: returns copies.
 */
export function dropRepeatedLeads(cues: readonly FitCue[], language: 'en' | 'de' = 'en'): FitCue[] {
  const out = cues.map((c) => ({ ...c }))
  out.forEach((c, i) => {
    if (isTextCue(c)) return
    let k = i - 1
    while (k >= 0 && isTextCue(out[k]!)) k--
    if (k < 0 || c.startMs - out[k]!.startMs > REPEAT_WINDOW_MS) return
    const earlier = units(out[k]!.text).filter((u) => !u.onScreen).map((u) => u.text)
    const us = units(c.text)
    let drop = 0
    while (drop < us.length) {
      const u = us[drop]!
      if (u.onScreen || !SENTENCE_END.test(u.text) || !earlier.some((e) => saidIn(u.text, e, language))) break
      drop++
    }
    if (!drop || !us.slice(drop).some((u) => !u.onScreen)) return
    const text = c.text.slice(us[drop]!.start).trim()
    const first = text.split(/\s+/)[0]!.replace(/[^\p{L}]/gu, '').toLowerCase()
    if (!/^["'“„«]?\p{Lu}/u.test(text) || PRONOUN_OPENERS.has(first)) return
    out[i] = { ...c, text, wordCount: wordCount(text) }
  })
  return out
}

const EditItem = z.object({ cue: z.coerce.number(), text: z.string() }).passthrough()
const EditReply = z.union([z.object({ cues: z.array(EditItem) }).transform((r) => r.cues), z.object({ edits: z.array(EditItem) }).transform((r) => r.edits)])
export type Edit = z.infer<typeof EditItem>
/** One {"cue": n, "text": "…"} object, for a reply that is not one whole JSON object (cut off at maxTokens, or text after the array). */
const ITEM = /\{\s*"cue"\s*:\s*"?(\d+)"?\s*,\s*"text"\s*:\s*("(?:[^"\\]|\\.)*")\s*\}/g
/**
 * The reply's rewrites: text holding {"cues":[…]} (the narrative pass's plain-JSON reply) or {"edits":[…]} — fenced or not, with prose
 * around it (the first `{` to the last `}` is read) — or such an object as a tool input. When that does not parse, each complete
 * {"cue":n,"text":"…"} object is salvaged on its own (the spike's lenient parse: a reply cut off at maxTokens keeps its whole cues).
 * undefined when nothing is readable. An empty list is valid.
 */
export function replyEdits(reply: unknown): Edit[] | undefined {
  let json: unknown = reply
  let body = ''
  if (typeof reply === 'string') {
    const t = stripFence(reply), a = t.indexOf('{'), b = t.lastIndexOf('}')
    body = a >= 0 ? t.slice(a, b > a ? b + 1 : undefined) : ''
    try { json = a >= 0 && b > a ? JSON.parse(t.slice(a, b + 1)) : undefined } catch { json = undefined }
  }
  const parsed = EditReply.safeParse(json)
  if (parsed.success) return parsed.data
  const out: Edit[] = []
  for (const m of body.matchAll(ITEM)) { try { out.push({ cue: Number(m[1]), text: JSON.parse(m[2]!) as string }) } catch { /* a broken string: skip that cue */ } }
  return out.length ? out : undefined
}

/**
 * A word-count annotation as Nova Lite writes one: "(9 words)", "[9 words]", "9 words", "— 9 words", "Word count: 9", "(Word count: 9)".
 * Whole words only: "9 wordsmiths gather" and "raises a sword 2" are text.
 */
const COUNT = String.raw`[([]?\s*(?:\b(?:word\s*count|words?)\s*[:=]?\s*\d+\b|\b\d+\s*words?\b)\s*[)\]]?`
const LEADING_COUNT = new RegExp(String.raw`^\s*(?:${COUNT})\s*[:.,;—–-]?\s*`, 'i')
const TRAILING_COUNT = new RegExp(String.raw`\s*[—–-]?\s*(?:${COUNT})\s*\.?\s*$`, 'i')
/**
 * A shortening reply as text: a leading or trailing word-count annotation and wrapping quotes stripped, whitespace collapsed. '' when
 * nothing else is left — the caller treats that as no reply (sintel-90-210: the whole reply was "(9 words)", 3 of 3 calls).
 */
export function cleanShortening(reply: string): string {
  let t = reply.trim()
  for (let k = 0; k < 3; k++) t = unquote(t.replace(LEADING_COUNT, '').replace(TRAILING_COUNT, '').trim())
  return t.replace(/\s+/g, ' ')
}
/** Are the quotes inside a wrapping pair balanced (straight quotes in even numbers, each curly or angle opener closed)? `"a "b"` is not: its last quote is the clause's. */
const balanced = (inner: string) => {
  const n = (q: string) => inner.split(q).length - 1
  return n('"') % 2 === 0 && n("'") % 2 === 0 && n('«') === n('»') && (n('“') === n('”') || n('„') === n('“'))
}
/** Opening quote → the closing quote that pairs with it around a whole reply. */
const QUOTE_PAIRS: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’', '«': '»', '»': '«', '„': '“' }
/**
 * Wrapping quotes come off only as a matching pair around the whole reply (“…”, "…", «…»), or — any run of leading or trailing quote
 * marks — when no on-screen text clause runs to the end of the line: the closing quote of `Words appear: “The End.”` or `… "SINTEL"` is
 * the clause's own, and stripping it changed the clause (the guard then rejected the edit as "on-screen text clause changed").
 */
function unquote(t: string): string {
  const close = QUOTE_PAIRS[t[0] ?? '']
  if (close && t.length > 1 && t.endsWith(close) && balanced(t.slice(1, -1))) return t.slice(1, -1).trim()
  if (textSpans(t).some((s) => s.end >= t.length)) return t
  return t.replace(/^["'“”‘’«»„]+|["'“”‘’«»„]+$/g, '').trim()
}

export const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length

/**
 * Word budget per cue. A placed cue's room is its limit (the gap's end, or the next cue of any kind − NEXT_CUE_SPACING_MS: a clip
 * must not run into a text pause either) minus its start, at EDIT_WPS, never below the cue's own word count: the original was placed
 * by fit and stays valid, so a tight window means "no lengthening", not "shorten". An extended cue keeps its own length — it pauses
 * the film, and 25 words is fit's cap for that, not room.
 */
export function editBudgets(cues: readonly FitCue[], wps = EDIT_WPS): number[] {
  return cues.map((c, i) => {
    if (c.extended) return c.wordCount
    const next = cues[i + 1]
    const limit = Math.min(c.limitMs ?? Infinity, next ? next.startMs - NEXT_CUE_SPACING_MS : Infinity)
    const room = Number.isFinite(limit) ? Math.max(0, limit - c.startMs) : 0
    return Math.max(c.wordCount, Math.floor((room / 1000) * wps))
  })
}

/** The on-screen text clauses of a line, label and text as written (../textClause), in order. */
export const textClauseStrings = (t: string) => textSpans(t).map((s) => t.slice(s.start, s.end).trim())

/**
 * The guard. Each edit replaces its cue only when: the index names a cue (once) inside `window` [from, to); the text is one non-empty
 * line; the cue is not an on-screen text cue; the on-screen text clauses of the original are in the edit verbatim and in order, and
 * the edit adds none; the text is faithful and keeps the original's facts (below); and it is within the cue's budget — last, so a
 * rejection for budget is the only kind worth a shortening call. Timing, order, count, extended and shotIndex are never touched.
 * Returns the cues (copies) and what was applied / rejected.
 */
export function applyEdits(cues: readonly FitCue[], shots: readonly Described[], edits: readonly Edit[], budgets = editBudgets(cues), window: [number, number] = [0, cues.length], language: 'en' | 'de' = 'en', guard?: EditGuard): { cues: FitCue[]; applied: EditReport['applied']; rejected: EditReport['rejected'] } {
  const out = cues.map((c) => ({ ...c }))
  const applied: EditReport['applied'] = [], rejected: EditReport['rejected'] = []
  const seen = new Set<number>(), changed = new Set<number>()
  // In cue order, so "the place was already said" sees the edits accepted before this one (`out`), whatever order the model sent.
  const order = new Map(edits.map((e, k) => [e, k]))
  const rank = new Map<object, number>()
  for (const e of [...edits].sort((a, b) => (Number.isInteger(a.cue) && Number.isInteger(b.cue) ? a.cue - b.cue : 0))) {
    const i = e.cue, text = e.text.replace(/\s+/g, ' ').trim()
    const reject = (reason: string) => { const r = { i, text: e.text, reason }; rank.set(r, order.get(e)!); rejected.push(r) }
    if (!Number.isInteger(i) || i < 0 || i >= cues.length) { reject('unknown cue'); continue }
    if (i < window[0] || i >= window[1]) { reject('cue outside this window'); continue }
    if (seen.has(i)) { reject('cue edited twice'); continue }
    seen.add(i)
    const c = cues[i]!
    if (!text || /[\r\n]/.test(e.text.trim())) { reject('empty or multi-line'); continue }
    if (text === c.text) continue
    if (isTextCue(c)) { reject('on-screen text cue'); continue }
    const was = textClauseStrings(c.text), now = textClauseStrings(text)
    if (was.length !== now.length || was.some((x, k) => x !== now[k])) { reject(was.length ? 'on-screen text clause changed' : 'on-screen text clause added'); continue }
    // What this cue may say: the shots between the previous action cue and its own (the ones it may absorb), its own text and that
    // previous cue's (continuity words). Not later shots (never before the action) and not earlier ones (a dropped fact goes into the
    // NEXT cue only; probe round 7: Nova folded shot 11's "veiled face" — the description Gate C flagged — into the cue of shot 14).
    const p = prevActionIndex(cues, i), prevShot = p < 0 ? -1 : cues[p]!.shotIndex, previous = p < 0 ? '' : cues[p]!.text
    const allowed = [...shots.filter((s) => s.index > prevShot && s.index <= c.shotIndex).map((s) => s.description), c.text, previous]
    // DESC-029: names only once revealed (glossary or dialogue), never invented; a scene's place said once, then not again.
    // cue k as the viewer hears it: this call's accepted edit, else what earlier windows (and a first pass) left in `current`
    const heard = (k: number) => (changed.has(k) ? out[k]! : (guard?.current?.[k] ?? cues[k]!))
    const sc = guard?.scenes ? sceneOf(guard.scenes, c.shotIndex) : undefined
    const own = shots.filter((s) => s.index > prevShot && s.index <= c.shotIndex).map((s) => s.description) // this cue's shots, missed ones included
    if (guard) {
      // A capitalised word a description of these shots says is grounded there (a missed shot's "Dr. Smith"); a glossary name must be
      // revealed by the cue's start and shown by look in these shots (binding: "Thom" never on the sniper's shot).
      const grounded = new Set(own.flatMap((d) => nameEvidence(d, c.startMs, guard.glossary, guard.spoken).invented))
      const before = nameEvidence(c.text, c.startMs, guard.glossary, guard.spoken, own), after = nameEvidence(text, c.startMs, guard.glossary, guard.spoken, own)
      const had = [...before.premature, ...before.invented, ...before.unbound, ...before.withheld]
      const wrong = [...after.premature, ...after.invented.filter((n) => !grounded.has(n)), ...after.unbound, ...after.withheld].filter((n) => !had.includes(n))
      if (wrong.length) { reject(`name not revealed, not shown in its shots, withheld here, or in no glossary or dialogue: ${wrong.join(', ')}`); continue }
    }
    const firstOfScene = !!sc && !cues.slice(0, i).some((x) => !isTextCue(x) && sc.shots.includes(x.shotIndex))
    const set = sc?.settingName && guard ? guard.glossary.settings.find((x) => x.name === sc.settingName) : undefined
    const gate = guard && { glossary: guard.glossary, atMs: c.startMs, spoken: guard.spoken, shots: [...own, c.text], extra: sc ? [sc.setting, ...(set ? [`${set.name} ${set.look}`] : []), ...(sc.returning && firstOfScene ? ['back in'] : [])] : [] }
    const view: NarrativeView | undefined = guard?.narrative ? { cues, heard: (k) => heard(k).text, scenes: guard.scenes, glossary: guard.glossary, isTextCue } : undefined
    if (view) {
      // decision 0017: a new she/he/it needs its referent nearby; still/again/meanwhile/later/night only from this cue's own shots
      const pronoun = pronounProblems(view, i, c.text, text, own)
      if (pronoun.length) { reject(pronoun[0]!); continue }
      const unsourced = unsourcedContinuity(text, own, c.text)
      if (unsourced.length) { reject(`not in this cue's shot descriptions: ${unsourced.join(', ')}`); continue }
    }
    // the narrative pass's free words ("now", "here") and licensed she/he are not facts for this check (../narrative faithfulText)
    const bad = unfaithfulWords(view ? faithfulText(text) : text, allowed, gate)
    if (bad.length) { reject(`not in any shot description: ${bad.join(', ')}`); continue }
    // decision 0012 amendment (2026-10-15): a place word is grounded in the cue's own scene, never carried from another scene's shots
    if (sc && guard?.scenes) {
      const foreign = foreignPlaceStems(sc, guard.scenes, guard.glossary), had = new Set(placeStems(c.text))
      const carried = placeStems(text).filter((w) => foreign.has(w) && !had.has(w))
      if (carried.length) { reject(`another scene's place: ${carried.join(', ')}`); continue }
    }
    if (sc && guard) {
      const stems = sceneStems(sc, guard.glossary)
      const said = Array.from({ length: i }, (_, k) => heard(k)).some((x) => sc.shots.includes(x.shotIndex) && statesPlace(x.text, stems))
      if (said && !statesPlace(c.text, stems) && statesPlace(text, stems)) { reject('says the scene\'s place again'); continue }
    }
    // decision 0017: a look word the scene already said is carried while the rewrite still refers to that character (heard, not fit's text)
    const lostAll = droppedFacts(c.text, text, view && p >= 0 ? heard(p).text : previous)
    const excused = view ? excusedByCarry(lostAll, text, carriedLook(view, i)) : new Set<string>()
    const lost = lostAll.filter((w) => !excused.has(w))
    if (lost.length) { reject(`drops a fact: ${lost.join(', ')}`); continue }
    const fragment = editReadsAsSentences(c.text, text, allowed, language) // DESC-028: g9 shot 26 "Scaled creature, horns, bloodied wing, stares."
    if (fragment) { reject(`not a sentence: ${fragment}`); continue }
    if (wordCount(text) > budgets[i]!) { reject(`over budget (${wordCount(text)} > ${budgets[i]} words)`); continue }
    out[i] = { ...c, text, wordCount: wordCount(text) }
    changed.add(i)
    applied.push({ i, from: c.text, to: text })
  }
  rejected.sort((a, b) => rank.get(a)! - rank.get(b)!) // reported in the order the model sent them
  return { cues: out, applied, rejected }
}

/**
 * Content words of `text` whose stem is in none of `allowed` (the shot descriptions the cue may absorb and the cue texts, see applyEdits).
 * Lower-cased, punctuation stripped, stop-words removed; inflections match through stem(): "stir" ~ "stirs" ~ "stirring".
 * Empty means faithful: the edit names nothing a description did not.
 * DESC-029 (`gate`): the glossary is evidence only where it applies — a character's look and short reference only when the cue's shot
 * descriptions (`shots`) show that character (matchedCharacters), and its name only once revealed at `atMs` as well; a name the dialogue
 * has said by then; and `extra` (the cue's own scene: its label and glossary place, "back in" on a return). Never a role, never another
 * scene's place, never a look the shots do not show.
 */
export interface NameGate { glossary: Glossary; atMs: number; spoken?: readonly { name: string; at: number }[]; extra?: readonly string[]; shots?: readonly string[] }
export function unfaithfulWords(text: string, allowed: readonly string[], gate?: NameGate): string[] {
  const more: string[] = []
  if (gate) {
    const shown = matchedCharacters(gate.shots ?? allowed, gate.glossary)
    const revealed = allowedNames(gate.glossary, gate.atMs)
    const spoken = (gate.spoken ?? []).filter((s) => s.at * 1000 <= gate.atMs).map((s) => s.name)
    for (const c of gate.glossary.characters.filter((x) => shown.has(x.name))) more.push(c.look, shortOf(c), ...(revealed.includes(c.name) ? [c.name] : []))
    more.push(...spoken, ...(gate.extra ?? [])) // a name the dialogue has said by then is evidence on any shot, as before DESC-029
  }
  const ok = new Set([...allowed, ...more].flatMap((a) => contentWords(a).map(stem)))
  return [...new Set(contentWords(text))].filter((w) => !ok.has(stem(w)))
}

/**
 * Content words of the original cue that the edit no longer has (by stem), except those the previous action cue already said (that is
 * the repetition the pass removes) and the size/age/texture adjectives and manner adverbs fit's shortener drops first (so "Old man pours
 * broth" may become "The man stirs a pot, then pours broth"). Empty means the edit kept every fact. The pass adds context; it never loses any.
 * Probe round 4: Nova Lite dropped "Logo fades." from "Snowy mountains. A figure walks, falls. Logo fades." in 2 of 3 replies.
 */
export function droppedFacts(original: string, edited: string, previous: string): string[] {
  const kept = new Set(contentWords(edited).map(stem))
  return factWords(original, previous).filter((w) => !kept.has(stem(w)))
}
/**
 * The content words of a cue an edit must keep (droppedFacts' list): not a droppable adjective or adverb, not said by the previous action
 * cue. The request names them per cue (mustStillSay) and the shortening request names them first: on sintel-90-210 Nova Lite replaced
 * "Old man pours broth." with the dropped shot ("…watches the old man stir a pot over the fire.") instead of folding it in.
 */
export function factWords(original: string, previous: string): string[] {
  const said = new Set(contentWords(previous).map(stem))
  return [...new Set(contentWords(original))].filter((w) => !DROPPABLE.has(w) && !said.has(stem(w)))
}
/** The words 05-fit's shortenDeterministic drops first (its ADJECTIVES and ADVERBS lists); colours are facts and stay. */
const DROPPABLE = new Set(['large', 'small', 'big', 'little', 'tiny', 'huge', 'tall', 'short', 'long', 'wide', 'narrow', 'thick', 'thin', 'heavy', 'old', 'young', 'ancient', 'bright', 'dim', 'faint', 'soft', 'rough', 'smooth', 'sharp', 'wooden', 'snowy', 'rocky', 'icy', 'dusty', 'muddy', 'wet', 'dry', 'distant', 'nearby', 'vast', 'massive', 'slender', 'ornate', 'simple', 'various', 'several',
  'slowly', 'quickly', 'suddenly', 'gently', 'quietly', 'softly', 'carefully', 'briefly', 'slightly', 'rapidly', 'swiftly', 'steadily', 'firmly', 'tightly', 'calmly', 'silently', 'gracefully', 'cautiously', 'intently'])

// contentWords / stem (the STOP list, the Porter stem): ../contentWords, shared with the plot-event test (DESC-020); re-exported above.

export interface DialogueTurn { start: number; end: number; speaker?: string; text: string }
/** Speaker turns (words joined, speaker changes split) overlapping [fromMs, toMs], for the model's "what the viewer hears" context. */
export function dialogueTurns(words: readonly Word[], fromMs: number, toMs: number): DialogueTurn[] {
  const turns: DialogueTurn[] = []
  let cur: DialogueTurn | undefined
  for (const w of words) {
    if (w.end * 1000 < fromMs || w.start * 1000 > toMs) continue
    if (!cur || w.speaker !== cur.speaker || w.start - cur.end > 2) { cur = { start: w.start, end: w.end, ...(w.speaker ? { speaker: w.speaker } : {}), text: w.text }; turns.push(cur) }
    else { cur.text += ' ' + w.text; cur.end = w.end }
  }
  return turns.map((t) => ({ ...t, start: Math.round(t.start * 100) / 100, end: Math.round(t.end * 100) / 100 }))
}
