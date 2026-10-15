import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { cueAudioFile } from '../cues'
import type { Shot } from '../steps/02-shots'
import type { Gap, Word } from '../steps/03-speech'
import type { Described } from '../steps/04-describe'
import type { FitCue } from '../steps/05-fit'
import { ffmpegSpeechMs, ffprobeClipMs, NEXT_CUE_SPACING_MS, OVERRUN_TOLERANCE_MS } from '../steps/06-voice'

/**
 * DESC-030: N byte-identical blind rater packets from an evaluation work dir (TypeScript port of the DESC-024 packet builder).
 * Per shot: a five-frame contact sheet and the full frames, dialogue ±2 s, the dialogue-free gaps, and for the voiced text the
 * numbers decision 0009's "fits" rule needs (limit, clip end, speech end by silencedetect −45 dB d=0.05, next dialogue word, next
 * placed cue) — or "Not voiced" and the text it would have voiced.
 */

export const RUBRIC_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), 'RUBRIC.template.md')
/** Frame k of a shot sits at this fraction of [start, end − CUT_LAG_MS] (the sampling of every Gate C packet so far). */
export const FRAME_FRACTIONS = [0.08, 0.3, 0.5, 0.7, 0.92] as const
/** Cuts land ~2 frames late, so the last frame stops this far before the next cut. */
export const CUT_LAG_MS = 120
const SHEET_FRAME_W = 560, SHEET_GAP = 8, SHEET_LABEL_H = 42, SHEET_BOTTOM = 8
const FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'

export interface PacketData { shots: Shot[]; described: Described[]; gaps: Gap[]; words: Word[]; cues: FitCue[]; fitCues: FitCue[] }
export interface Line { start: number; end: number; speaker?: string; text: string }

export const frameTimes = (s: Shot) => FRAME_FRACTIONS.map((f) => s.startMs + (s.endMs - CUT_LAG_MS - s.startMs) * f)
/** Film timecode m:ss.mmm of a segment time, the segment starting offsetMs into the film. */
export function tc(ms: number, offsetMs = 0) {
  const s = (offsetMs + ms) / 1000
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`
}
/** Words → dialogue lines: a new line after a 0.6 s pause or a change of speaker. */
export function dialogueLines(words: readonly Word[]): Line[] {
  const out: Line[] = []
  let cur: Line | undefined
  for (const w of words) {
    if (cur && (w.start - cur.end > 0.6 || w.speaker !== cur.speaker)) { out.push(cur); cur = undefined }
    if (!cur) cur = { start: w.start, end: w.end, speaker: w.speaker, text: w.text }
    else { cur.end = w.end; cur.text += ` ${w.text}` }
  }
  if (cur) out.push(cur)
  return out
}
const placedAfter = (c: FitCue, cues: readonly FitCue[]) => cues.find((x) => !x.extended && x.startMs > c.startMs)
/** 06-voice's limit: the cue's gap end, or the next placed cue's start − NEXT_CUE_SPACING_MS when earlier. */
export function limitOf(c: FitCue, cues: readonly FitCue[]): number | undefined {
  const next = placedAfter(c, cues)
  const lims = [c.limitMs, next && next.startMs - NEXT_CUE_SPACING_MS].filter((x): x is number => x !== undefined)
  return lims.length ? Math.min(...lims) : undefined
}
export const nextWordMs = (words: readonly Word[], t: number) => { const w = words.find((x) => x.start * 1000 >= t); return w && Math.round(w.start * 1000) }

/** The label of a shot that is not rated (decision 0003: score = usable / (shots − same-as-previous)). */
export const SKIP_LABEL = 'Same as previous shot — not rated'
/**
 * Pure (tested): the same-as-previous shots, which are not rated and leave the denominator (decision 0003). A shot is one when
 * nothing would be voiced for it — no cue in cues.json, none placed by fit — and describe marked it same-as-previous or left its text
 * empty (a continuation with nothing new). A voiced shot is always rated, whatever describe marked.
 */
export function skipShots(d: Pick<PacketData, 'shots' | 'described' | 'cues' | 'fitCues'>): number[] {
  const has = (cs: readonly FitCue[], i: number) => cs.some((c) => c.shotIndex === i && c.text.trim())
  return d.shots.map((s) => s.index).filter((i) => {
    if (has(d.cues, i) || has(d.fitCues, i)) return false
    const desc = d.described.find((x) => x.index === i)
    return !!desc && (desc.sameAsPrev || !desc.description.trim())
  })
}

/**
 * Pure (tested): shots.md. speechMs maps a placed cue's index in cues.json to its clip's speech length (undefined: not measured,
 * the clip end is shown as the speech end, as before).
 */
export function shotsMd(d: PacketData, speechMs: ReadonlyMap<number, number | undefined>, o: { title: string; offsetMs: number; credit?: string }): string {
  const t = (ms: number) => tc(ms, o.offsetMs)
  const lines = dialogueLines(d.words)
  const skip = new Set(skipShots(d))
  const md = [`# ${o.title} — ${d.shots.length} shots`, '',
    `Read RUBRIC.md first. Times in ms are from the start of the segment (0 = film ${t(0)}).`, '', ...(o.credit ? [`Credit: ${o.credit}`, ''] : [])]
  for (const s of d.shots) {
    const desc = d.described.find((x) => x.index === s.index)
    const { index: i, startMs: a, endMs: b } = s
    const nn = String(i).padStart(2, '0')
    md.push(`## Shot ${i}`, '')
    md.push(`- Time: ${a} – ${b} ms in the segment (film ${t(a)} – ${t(b)}), ${((b - a) / 1000).toFixed(1)} s`
      + (s.part ? `; part ${s.part.i + 1} of ${s.part.of} of one camera shot` : ''))
    md.push(`- Contact sheet: \`sheets/shot_${nn}.jpg\`; full frames \`frames/shot_${nn}_0.jpg\` … \`_4.jpg\``)
    const near = lines.filter((l) => l.end * 1000 > a - 2000 && l.start * 1000 < b + 2000)
    md.push(`- Dialogue near the shot (±2 s): ${near.length ? '' : 'none'}`)
    for (const l of near) md.push(`  - ${t(l.start * 1000)} – ${t(l.end * 1000)} (${l.speaker ?? 'speaker ?'}): "${l.text}"`)
    const g = d.gaps.filter((x) => x.endMs > a && x.startMs < b + 1000)
    md.push(`- Dialogue-free gaps overlapping the shot (+1 s): ${g.map((x) => `${x.startMs}–${x.endMs} ms`).join(', ') || 'none'}`)
    if (desc) md.push(`- Model description (before placement and shortening): "${desc.description}"${desc.sameAsPrev ? ' — marked same-as-previous' : ''}`)
    const voiced = d.cues.map((c, k) => ({ c, k })).filter(({ c }) => c.shotIndex === i)
    for (const { c, k } of voiced) {
      if (c.extended) {
        md.push(`- **Voiced — rate this:** "${c.text}" — ${c.startMs}–${c.endMs} ms (audio length), EXTENDED${c.event ? ' (plot event)' : ''} (the film pauses while it plays), ${c.text.split(/\s+/).filter(Boolean).length} words`)
        continue
      }
      const lim = limitOf(c, d.cues), sp = speechMs.get(k), nw = nextWordMs(d.words, c.startMs), np = placedAfter(c, d.cues)
      md.push(`- **Voiced — rate this:** "${c.text}" — placed in a gap, starts ${c.startMs} ms`)
      md.push(`  - Limit: ${lim ?? 'none'}${lim === undefined ? '' : ' ms'} · clip end: ${c.endMs} ms${lim === undefined ? '' : ` (limit + ${OVERRUN_TOLERANCE_MS} ms = ${lim + OVERRUN_TOLERANCE_MS})`}`
        + ` · speech end: ${sp === undefined ? c.endMs : c.startMs + sp} ms · next dialogue word: ${nw === undefined ? 'none' : `${nw} ms`}`
        + ` · next placed cue: ${np ? `${np.startMs} ms` : 'none'}`)
    }
    if (skip.has(i)) md.push(`- **${SKIP_LABEL}.** Nothing new to voice; leave its pre-filled "skip" row in scores.md as it is.`)
    else if (!voiced.length) {
      const fc = d.fitCues.find((c) => c.shotIndex === i)
      const would = fc?.text ?? desc?.description ?? ''
      const why = fc ? 'placed by fit but dropped by the voice step (the spoken clip ran past its slot)' : 'no room in the dialogue gaps'
      md.push(`- **Not voiced** (${why}). Rate the text it would have voiced: "${would}". On time and fits: n/a.`)
    }
    md.push('')
  }
  return md.join('\n')
}

/** Pure (tested): the empty score sheet every rater fills. */
export function scoresMd(shots: readonly Shot[], skip: readonly number[] = []): string {
  return '# Scores\n\nCriteria: pass / fail (n/a where RUBRIC.md says so). Usable: yes / no.\n\n'
    + '| Shot | Faithful | On time | Style | Clean | Fits | Usable | Note (required for any fail) |\n|---|---|---|---|---|---|---|---|\n'
    + shots.map((s) => (skip.includes(s.index) ? `| ${s.index} | n/a | n/a | n/a | n/a | n/a | skip | ${SKIP_LABEL} |\n` : `| ${s.index} | | | | | | | |\n`)).join('')
    + `\nUsable: __ / ${shots.length - shots.filter((s) => skip.includes(s.index)).length}${skip.length ? ` (shot${skip.length > 1 ? 's' : ''} ${skip.join(', ')}: same as previous, not rated)` : ''}\n\nPlot events lost (not voiced and plot-relevant): \n`
}

export const rubricMd = (template: string, raters: number, shots: number) => template.replaceAll('{{RATERS}}', String(raters)).replaceAll('{{SHOTS}}', String(shots))

/** ffmpeg arguments for one full frame, as every Gate C packet so far (≤ 1280 px wide, JPEG q 2). */
export const frameArgs = (mezz: string, ms: number, out: string) => ['-v', 'error', '-y', '-ss', (ms / 1000).toFixed(3), '-i', mezz, '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2", '-q:v', '2', out]
const drawLabel = (label: string, font: string) => `,drawtext=${existsSync(font) ? `fontfile='${font}':` : ''}text='${label.replace(/[\\':]/g, (c) => `\\${c}`)}':x=${SHEET_GAP}:y=8:fontsize=26:fontcolor=white`
/** The contact sheet: five frames 560 px wide side by side on a dark ground, each with "shot i  frame k  m:ss.mmm" above it. */
export function sheetArgs(frames: readonly string[], labels: readonly string[] | undefined, out: string, font = FONT) {
  const tiles = frames.map((_, k) => `[${k}:v]scale=${SHEET_FRAME_W}:-2,pad=iw+${SHEET_GAP}:ih+${SHEET_LABEL_H + SHEET_BOTTOM}:${SHEET_GAP}:${SHEET_LABEL_H}:color=0x141414${labels ? drawLabel(labels[k]!, font) : ''}[t${k}]`)
  const graph = `${tiles.join(';')};${frames.map((_, k) => `[t${k}]`).join('')}hstack=inputs=${frames.length}[out]`
  return ['-v', 'error', '-y', ...frames.flatMap((f) => ['-i', f]), '-filter_complex', graph, '-map', '[out]', '-frames:v', '1', '-q:v', '3', out]
}

export interface PacketDeps {
  ffmpeg: (args: string[]) => Promise<unknown>
  speechMs: (file: string) => Promise<number | undefined>
  log: (line: string) => void
}
export const realDeps: PacketDeps = {
  ffmpeg: (args) => execa('ffmpeg', args),
  speechMs: async (file) => { const dur = await ffprobeClipMs()(file); return ffmpegSpeechMs()(file, dur) },
  log: (l) => console.log(l),
}

const readJson = async <T>(work: string, f: string, fallback?: T): Promise<T> => {
  try { return JSON.parse(await readFile(join(work, f), 'utf8')) as T } catch (e) { if (fallback !== undefined) return fallback; throw new Error(`${join(work, f)}: ${(e as Error).message}`) }
}

export async function loadPacketData(work: string): Promise<PacketData> {
  return {
    shots: await readJson<Shot[]>(work, 'shots.json'), described: await readJson<Described[]>(work, 'described.json'),
    gaps: await readJson<Gap[]>(work, 'gaps.json'), words: await readJson<Word[]>(work, 'words.json', []),
    cues: await readJson<FitCue[]>(work, 'cues.json'), fitCues: await readJson<FitCue[]>(work, 'cues.fit.json', []),
  }
}

/** SHA-256 over a folder's relative paths and bytes, to prove the packets are identical. */
export async function treeHash(dir: string): Promise<string> {
  const h = createHash('sha256')
  const walk = async (d: string): Promise<string[]> => (await Promise.all((await readdir(d, { withFileTypes: true })).map((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))).flat()
  for (const f of (await walk(dir)).sort()) h.update(relative(dir, f)).update('\0').update(await readFile(f)).update('\0')
  return h.digest('hex')
}

/**
 * Builds {outDir}/rater1 … raterN, byte-identical (one staged copy, copied N times; checked by treeHash), plus {outDir}/packet.json
 * (which work dir, when, the hash, and skipShots — the same-as-previous shots `score` leaves out). Refuses an even N (a majority needs an odd number of raters) and an outDir that has files,
 * so filled score sheets are never overwritten.
 */
export async function buildPackets(o: { work: string; outDir: string; raters: number; offsetMs?: number; title?: string; credit?: string }, deps: PacketDeps = realDeps) {
  if (!Number.isInteger(o.raters) || o.raters < 1 || o.raters % 2 === 0) throw new Error(`--raters must be an odd number ≥ 1 (a majority needs one); got ${o.raters}`)
  if (existsSync(o.outDir) && (await readdir(o.outDir)).length) throw new Error(`${o.outDir} is not empty; packets never overwrite (a filled scores.md would be lost)`)
  const d = await loadPacketData(o.work)
  const offsetMs = o.offsetMs ?? 0, title = o.title ?? 'Gate C clip'
  /** The film's credit: --credit, else what `gate-c prepare` recorded and `gate-c run` carried into the work dir. */
  const credit = o.credit ?? await readJson<{ credit?: string }>(o.work, 'gate-c.json', {}).then((m) => m.credit)
  const stage = join(o.outDir, '_stage')
  await mkdir(join(stage, 'sheets'), { recursive: true })
  await mkdir(join(stage, 'frames'), { recursive: true })
  for (const s of d.shots) {
    const nn = String(s.index).padStart(2, '0')
    const times = frameTimes(s)
    const frames = times.map((_, k) => join(stage, 'frames', `shot_${nn}_${k}.jpg`))
    for (const [k, ms] of times.entries()) await deps.ffmpeg(frameArgs(join(o.work, 'mezz.mp4'), ms, frames[k]!))
    const sheet = join(stage, 'sheets', `shot_${nn}.jpg`)
    const labels = times.map((ms, k) => `shot ${s.index}  frame ${k}  ${tc(ms, offsetMs)}`)
    await deps.ffmpeg(sheetArgs(frames, labels, sheet)).catch(async () => {
      deps.log(`shot ${s.index}: ffmpeg drawtext failed; contact sheet without labels (the file names carry shot and frame)`)
      await deps.ffmpeg(sheetArgs(frames, undefined, sheet))
    })
  }
  const speech = new Map<number, number | undefined>()
  for (const [k, c] of d.cues.entries()) if (!c.extended) speech.set(k, await deps.speechMs(join(o.work, cueAudioFile(k))).catch(() => undefined))
  await writeFile(join(stage, 'shots.md'), shotsMd(d, speech, { title, offsetMs, credit }))
  const skip = skipShots(d)
  await writeFile(join(stage, 'RUBRIC.md'), rubricMd(await readFile(RUBRIC_TEMPLATE, 'utf8'), o.raters, d.shots.length - skip.length))
  await writeFile(join(stage, 'scores.md'), scoresMd(d.shots, skip))
  const hashes: string[] = []
  for (let r = 1; r <= o.raters; r++) {
    const dir = join(o.outDir, `rater${r}`)
    await cp(stage, dir, { recursive: true, errorOnExist: true, force: false })
    hashes.push(await treeHash(dir))
  }
  await rm(stage, { recursive: true })
  if (new Set(hashes).size !== 1) throw new Error('rater packets differ; this is a bug')
  await writeFile(join(o.outDir, 'packet.json'), JSON.stringify({ work: o.work, raters: o.raters, shots: d.shots.length, shotIndices: d.shots.map((s) => s.index), skipShots: skip, offsetMs, title, credit, sha256: hashes[0], at: new Date().toISOString() }, null, 2))
  return { shots: d.shots.length, sha256: hashes[0]! }
}
