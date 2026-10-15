import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Ctx } from './index'
import type { Described } from './04-describe'
import { meter } from '../cost'
import { contentWords, stem } from '../contentWords'
import { glossaryFor, placeStems, settingStems, type Glossary } from '../glossary'
import { bedrockEditSend, stripFence, type EditConverse } from '../prompts'
import { scenesModelId, scenesRequest } from '../scenePrompt'
import { sentences, stripDarkness, textSpans } from '../textClause'

/**
 * Scene grouping (DESC-029, docs/decisions/0012-characters-and-scenes.md): a text-only step after describe (and its verify pass, 04b)
 * that groups consecutive shots into scenes and names each scene's place, so fit and the edit pass know where a scene starts, where it
 * is, and when a scene returns to an earlier place. One Nova Lite call over the shot descriptions (and the title's listed places),
 * cached in {work}/cache/scenes/ like the SDH windows; its reply passes a guard (checkScenes: every shot once, in order) and each
 * setting label must be grounded (groundLabel: every word in that scene's descriptions or the glossary's places). A failed call or
 * an unreadable reply uses the deterministic grouping (fallbackScenes: place-word overlap); a label that is not grounded is replaced
 * by the deterministic label. Writes {work}/scenes.json. Never changes a description.
 */
export interface SettingEvidence { word: string; source: 'description' | 'glossary'; shot?: number; setting?: string }
export interface Scene {
  id: number
  /** shot indexes, consecutive */
  shots: number[]
  startMs: number
  endMs: number
  /** where the scene is: words from its descriptions or the glossary's places */
  setting: string
  /** the glossary setting it matches (Setting.name), when one does */
  settingName?: string
  /** an earlier, not adjacent scene was in the same place: a cue may say "Back in …" */
  returning: boolean
  evidence: SettingEvidence[]
}
export interface ScenesReport { source: 'model' | 'fallback'; model: string; cached: boolean; usage: { inputTokens: number; outputTokens: number }; reason?: string; labels: { scene: number; label: string; reason: string }[]; scenes: Scene[] }
export interface Group { firstShot: number; lastShot: number; setting: string }

export const SCENES_FILE = 'scenes.json'

export async function groupScenes(ctx: Ctx, send: EditConverse = bedrockEditSend) {
  const described = await readFile(`${ctx.work}/described.json`, 'utf8')
  const shots = JSON.parse(described) as Described[]
  const report = await sceneGroups(shots, glossaryFor(ctx), ctx.language, send, { cacheDir: `${ctx.work}/cache/scenes`, signal: ctx.signal })
  console.log(`scenes: ${report.scenes.length} scenes (${report.source}${report.reason ? `: ${report.reason}` : ''}), ${report.scenes.map((s) => `${s.shots[0]}–${s.shots.at(-1)} ${JSON.stringify(s.setting)}`).join('; ')}`)
  await writeFile(`${ctx.work}/${SCENES_FILE}`, JSON.stringify({ describedHash: describedHash(described), ...report }, null, 2))
}

/** sha256 of described.json as written: scenes.json records the descriptions it grouped, so fit can tell a stale one. */
export const describedHash = (text: string) => createHash('sha256').update(text).digest('hex')

/**
 * The scenes for fit (DESC-029): scenes.json when it was grouped from the described.json now in the work dir; otherwise (missing, or
 * stale after a describe re-run) the scene step runs first — so `--from fit` behaves like the worker's fit job, which always runs it.
 */
export async function freshScenes(ctx: Ctx, group: (ctx: Ctx) => Promise<void> = (c) => groupScenes(c)): Promise<Scene[] | undefined> {
  const described = await readFile(`${ctx.work}/described.json`, 'utf8').catch(() => undefined)
  if (described === undefined) return readScenes(ctx.work)
  const file = await readFile(`${ctx.work}/${SCENES_FILE}`, 'utf8').then((t) => JSON.parse(t) as ScenesReport & { describedHash?: string }, () => undefined)
  if (file?.describedHash === describedHash(described)) return file.scenes
  console.log(`scenes: ${file ? 'scenes.json is stale (described.json changed)' : 'no scenes.json'}; grouping scenes before fit`)
  await group(ctx)
  return readScenes(ctx.work)
}

/** {work}/scenes.json's scenes, or undefined when the step has not run (an older work dir): fit and edit then work as before. */
export async function readScenes(work: string): Promise<Scene[] | undefined> {
  return readFile(`${work}/${SCENES_FILE}`, 'utf8').then((t) => (JSON.parse(t) as ScenesReport).scenes, () => undefined)
}
/** The scene a shot belongs to. */
export const sceneOf = (scenes: readonly Scene[], shotIndex: number) => scenes.find((s) => s.shots.includes(shotIndex))

const Reply = z.object({ scenes: z.array(z.object({ firstShot: z.coerce.number(), lastShot: z.coerce.number(), setting: z.string() }).passthrough()) })
/** The reply's groups: the toolUse input, or text holding {"scenes":[…]} (fenced or with prose around it); undefined otherwise. */
export function replyGroups(reply: unknown): Group[] | undefined {
  let json: unknown = reply
  if (typeof reply === 'string') { const t = stripFence(reply), a = t.indexOf('{'), b = t.lastIndexOf('}'); try { json = a >= 0 && b > a ? JSON.parse(t.slice(a, b + 1)) : undefined } catch { json = undefined } }
  const r = Reply.safeParse(json)
  return r.success ? r.data.scenes.map(({ firstShot, lastShot, setting }) => ({ firstShot, lastShot, setting: setting.trim() })) : undefined
}

/** Why the groups are not a partition of `shots` in order (each scene firstShot ≤ lastShot, the next starting right after), or undefined. */
export function checkScenes(groups: readonly Group[], shots: readonly Pick<Described, 'index'>[]): string | undefined {
  if (!groups.length) return 'no scenes'
  const ids = shots.map((s) => s.index)
  let at = 0
  for (const g of groups) {
    if (!Number.isInteger(g.firstShot) || !Number.isInteger(g.lastShot)) return 'shot numbers are not integers'
    if (g.firstShot !== ids[at]) return `scene starts at shot ${g.firstShot}, expected ${ids[at] ?? 'none'}`
    const end = ids.indexOf(g.lastShot)
    if (end < at) return `scene ${g.firstShot}–${g.lastShot} ends before it starts or names an unknown shot`
    at = end + 1
  }
  return at === ids.length ? undefined : `shots after ${ids[at - 1]} are in no scene`
}

const describedText = (s: Described) => (s.sameAsPrev ? '' : stripDarkness(s.description))
/** Content-word stems of the plain description (on-screen text left out). */
const plainStems = (t: string) => contentWords(textSpans(t).reduceRight((x, s) => x.slice(0, s.start) + ' ' + x.slice(s.end), t)).map(stem)

/**
 * Is a setting label grounded for these shots: every content word (by stem) in one of their descriptions, or in a glossary setting's
 * name or look? Returns the evidence per word, and the words that are not grounded.
 */
export function groundLabel(label: string, sceneShots: readonly Described[], g: Glossary): { evidence: SettingEvidence[]; bad: string[] } {
  const evidence: SettingEvidence[] = [], bad: string[] = []
  for (const w of [...new Set(contentWords(label))]) {
    const st = stem(w)
    const shot = sceneShots.find((s) => plainStems(describedText(s)).includes(st))
    if (shot) { evidence.push({ word: w, source: 'description', shot: shot.index }); continue }
    const set = g.settings.find((s) => contentWords(`${s.name} ${s.look}`).map(stem).includes(st))
    if (set) { evidence.push({ word: w, source: 'glossary', setting: set.name }); continue }
    bad.push(w)
  }
  return { evidence, bad }
}

/** The glossary settings a text points at: those sharing the most place stems with it (ties all kept); [] when none shares one. */
export function matchSettings(text: string, g: Glossary): string[] {
  const ws = new Set(plainStems(text))
  let best = 0, out: string[] = []
  for (const s of g.settings) {
    const n = [...settingStems(s)].filter((w) => ws.has(w)).length
    if (n > best) { best = n; out = [s.name] } else if (n && n === best) out.push(s.name)
  }
  return out
}

/** Words for "an inside": with no glossary, one describer's "Dark room." and the next shot's "Tent interior." are one place. */
const INSIDE = new Set(['room', 'interior', 'tent', 'hut', 'house', 'hall', 'chamber', 'inside', 'raum', 'zimmer', 'zelt'].map(stem))
/** A scene opens when the time jumps: "Night." / "Dawn." opening a description, or "… LATER" in on-screen text ("40 YEARS LATER"). */
const timeJump = (t: string) => /^(?:night|dawn|dusk|day|morning|evening|nacht|morgen|abend)\b[.,]/iu.test(t.trim()) || /\blater\b|\bspäter\b/iu.test(t)

/**
 * The deterministic grouping (the fallback, and the label source when the model's label is not grounded). A shot opens a new scene
 * when the time jumps, or when it points at a place and shares nothing with the current scene's place: the same glossary setting
 * (matchSettings) when both point at one, otherwise a place noun (PLACE_NOUNS and the glossary's place words). Shots that point at no
 * place stay in the current scene. Cut-to-cut differences in people never split a scene.
 */
export function fallbackScenes(shots: readonly Described[], g: Glossary): Group[] {
  const extra = new Set(g.settings.flatMap((s) => [...settingStems(s)]))
  const out: Array<Group & { places: Set<string>; named: Set<string>; shots: Described[] }> = []
  for (const s of shots) {
    const t = describedText(s)
    const places = placeStems(t, extra), named = matchSettings(t, g)
    const cur = out.at(-1)
    const same = (p: string) => cur!.places.has(p) || (INSIDE.has(p) && [...cur!.places].some((q) => INSIDE.has(q))) // "Dark room." then "Tent interior."
    const differs = cur && ((named.length && cur.named.size) ? !named.some((n) => cur.named.has(n)) : (places.length > 0 && cur.places.size > 0 && !places.some(same)))
    if (!cur || (t && (differs || timeJump(t)))) out.push({ firstShot: s.index, lastShot: s.index, setting: '', places: new Set(places), named: new Set(named), shots: [s] })
    else { cur.lastShot = s.index; cur.shots.push(s); places.forEach((p) => cur.places.add(p)); named.forEach((n) => cur.named.add(n)) }
  }
  return out.map((x) => ({ firstShot: x.firstShot, lastShot: x.lastShot, setting: fallbackLabel(x.shots, g) }))
}

/**
 * A scene's label from its own shots: the glossary setting most of them point at; else the first short, verbless sentence that names a
 * place ("Dark room.", "Tent interior.", "Snowy mountains."); else its first place noun as written; else ''.
 */
export function fallbackLabel(sceneShots: readonly Described[], g: Glossary): string {
  const votes = new Map<string, number>()
  for (const s of sceneShots) for (const n of matchSettings(describedText(s), g)) votes.set(n, (votes.get(n) ?? 0) + 1)
  const top = [...votes].sort((a, b) => b[1] - a[1])[0]
  if (top) return top[0]
  const extra = new Set(g.settings.flatMap((s) => [...settingStems(s)]))
  for (const s of sceneShots) for (const u of sentences(describedText(s))) {
    const ws = u.replace(/[.!?…]+$/u, '').split(/\s+/)
    if (ws.length <= 4 && !textSpans(u).length && placeStems(u, extra).length && !ws.some((w, i) => i > 0 && /^\p{Ll}+[^s]s$/u.test(w) && !placeStems(w).length)) return u.replace(/[.!?…]+$/u, '').replace(/^\p{Lu}/u, (c) => c.toLowerCase())
  }
  for (const s of sceneShots) { const t = describedText(s); const w = contentWords(t).find((x) => placeStems(x, extra).length); if (w) return w }
  return ''
}

/** Scenes with times, glossary setting, returns and the label's evidence; a label that is not grounded becomes the fallback label. */
export function finishScenes(groups: readonly Group[], shots: readonly Described[], g: Glossary, labels: ScenesReport['labels'] = []): Scene[] {
  const scenes: Scene[] = []
  groups.forEach((x, id) => {
    const own = shots.filter((s) => s.index >= x.firstShot && s.index <= x.lastShot)
    let setting = x.setting, { evidence, bad } = groundLabel(setting, own, g)
    if (bad.length || !setting) {
      if (setting) labels.push({ scene: id, label: setting, reason: `not in its descriptions or the glossary: ${bad.join(', ')}` })
      setting = fallbackLabel(own, g);
      ({ evidence } = groundLabel(setting, own, g))
    }
    const named = matchSettings(`${setting} ${own.map(describedText).join(' ')}`, g)
    const settingName = g.settings.find((s) => s.name.toLowerCase() === setting.toLowerCase())?.name ?? (named.length === 1 ? named[0] : undefined)
    const key = (settingName ?? setting).toLowerCase()
    const returning = !!key && scenes.slice(0, -1).some((p) => (p.settingName ?? p.setting).toLowerCase() === key) && (scenes.at(-1)?.settingName ?? scenes.at(-1)?.setting ?? '').toLowerCase() !== key
    scenes.push({ id, shots: own.map((s) => s.index), startMs: own[0]!.startMs, endMs: own.at(-1)!.endMs, setting, ...(settingName ? { settingName } : {}), returning, evidence })
  })
  return scenes
}

/** sha256 of the whole request: the cache key of its reply. */
export const scenesCacheKey = (input: unknown) => createHash('sha256').update(`scenes-v1\n${JSON.stringify(input)}`).digest('hex')

/**
 * The grouping for one title (pure apart from `send` and the cache). The forced tool first, then plain JSON once when that call fails
 * (Nova Lite's ModelErrorException on a forced tool, as in the edit pass); a second failure, an unreadable reply or one that fails
 * checkScenes uses fallbackScenes. An abort is rethrown. A readable, valid reply is cached under cacheDir.
 */
export async function sceneGroups(shots: readonly Described[], g: Glossary, language: 'en' | 'de', send: EditConverse, opts: { cacheDir?: string; signal?: AbortSignal } = {}): Promise<ScenesReport> {
  const model = scenesModelId()
  const report: ScenesReport = { source: 'fallback', model, cached: false, usage: { inputTokens: 0, outputTokens: 0 }, labels: [], scenes: [] }
  if (!shots.length) return report
  const input = shots.map((s) => ({ shot: s.index, start: Math.round(s.startMs / 100) / 10, description: s.sameAsPrev ? '(same as the shot before)' : describedText(s) || '(nothing described)' }))
  let groups: Group[] | undefined
  for (const mode of ['tool', 'json'] as const) {
    const req = scenesRequest(input, g.settings, language, mode)
    const file = opts.cacheDir && `${opts.cacheDir}/${scenesCacheKey(req)}.json`
    try {
      const hit = file ? await readFile(file, 'utf8').then((t) => JSON.parse(t) as { reply: unknown }, () => undefined) : undefined
      let reply = hit?.reply
      if (hit) report.cached = true
      else {
        const r = await send(req)
        meter()?.bedrock(model, r.usage)
        report.usage.inputTokens += r.usage?.inputTokens ?? 0
        report.usage.outputTokens += r.usage?.outputTokens ?? 0
        const content = r.output?.message?.content ?? []
        reply = content.find((c) => c.toolUse)?.toolUse?.input ?? content.find((c) => c.text)?.text ?? ''
      }
      const got = replyGroups(reply)
      const why = got ? checkScenes(got, shots) : 'reply is not {"scenes":[…]}'
      if (why) { report.reason = why; break }
      groups = got
      if (file && !hit) { await mkdir(opts.cacheDir!, { recursive: true }); await writeFile(`${file}.tmp`, JSON.stringify({ reply })); await rename(`${file}.tmp`, file) }
      break
    } catch (e) {
      if (opts.signal?.aborted) throw e
      report.reason = `${mode} call failed: ${(e as Error)?.message ?? e}`
      console.warn(`scenes: ${report.reason}${mode === 'tool' ? '; asking once more for JSON text' : '; using the deterministic grouping'}`)
    }
  }
  if (groups) { report.source = 'model'; delete report.reason }
  report.scenes = finishScenes(groups ?? fallbackScenes(shots, g), shots, g, report.labels)
  return report
}
