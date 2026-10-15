import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** DESC-030: reads the raters' filled scores.md files and computes the Gate C numbers (docs/evaluation.md). */

export const CRITERIA = ['faithful', 'onTime', 'style', 'clean', 'fits'] as const
export type Criterion = typeof CRITERIA[number]
/** The gate: majority-usable shots / (shots − same-as-previous) (docs/evaluation.md, decision 0003). */
export const GATE = 0.7

/**
 * inconsistent: the Usable column says yes while a criterion fails — counted unrated (not usable) and reported.
 * skip: the rater wrote "skip" (or "skip (empty)") — a same-as-previous shot, counted neither usable nor not usable (usable null).
 */
export interface ShotScore { shot: number; usable: boolean | null; criteria: Record<Criterion, boolean | null>; note: string; inconsistent?: true; skip?: true }

const PASS = new Set(['pass', 'p', 'yes', 'y', 'ok', '✓', '✔', 'n/a', 'na'])
const FAIL = new Set(['fail', 'f', 'no', 'n', 'x', '✗', '✘'])
const USABLE = new Set(['yes', 'y', 'usable', 'pass', '✓', '✔'])
const UNUSABLE = new Set(['no', 'n', 'unusable', 'not usable', 'fail', '✗', '✘', 'x'])
const cell = (s: string | undefined) => (s ?? '').replace(/\*\*/g, '').trim().toLowerCase()
const verdict = (s: string, yes: Set<string>, no: Set<string>) => (yes.has(s) ? true : no.has(s) ? false : null)
const isSkip = (s: string) => /^skip\b/.test(s)

/**
 * Pure (tested): the rows of a scores.md table `| Shot | Faithful | On time | Style | Clean | Fits | Usable | Note |`. A row is any
 * table line whose first cell is a shot number. Usable is read from its column; when that is blank it is derived from the five
 * criteria (all pass or n/a → usable), and stays null (unrated) while any criterion is blank or unreadable, or when it says usable
 * while a criterion fails (inconsistent). "skip" / "skip (empty)" in the Usable column (or, with Usable blank, in a criterion) marks
 * the row skip.
 */
export function parseScores(md: string): ShotScore[] {
  const rows: ShotScore[] = []
  for (const line of md.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('|')) continue
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|')
    const shot = cell(cells[0])
    if (!/^\d+$/.test(shot)) continue
    const values = CRITERIA.map((_, k) => verdict(cell(cells[k + 1]), PASS, FAIL))
    const criteria = Object.fromEntries(CRITERIA.map((c, k) => [c, values[k]!])) as Record<Criterion, boolean | null>
    const written = cell(cells[6])
    if (isSkip(written) || (!written && CRITERIA.some((_, k) => isSkip(cell(cells[k + 1]))))) {
      rows.push({ shot: Number(shot), usable: null, criteria, note: (cells.slice(7).join('|') ?? '').trim(), skip: true })
      continue
    }
    let usable = written ? verdict(written, USABLE, UNUSABLE) : null
    if (!written && values.every((v) => v !== null)) usable = values.every(Boolean)
    const inconsistent = usable === true && values.some((v) => v === false)
    rows.push({ shot: Number(shot), usable: inconsistent ? null : usable, criteria, note: (cells.slice(7).join('|') ?? '').trim(), ...(inconsistent ? { inconsistent: true as const } : {}) })
  }
  if (new Set(rows.map((r) => r.shot)).size !== rows.length) throw new Error('a shot appears twice in the scores table')
  return rows
}

export interface RaterScores { rater: string; rows: ShotScore[] }
/** What packet.json says: every shot (each rater needs a row for each) and the same-as-previous shots that are not rated. */
export interface Packet { shotIndices?: readonly number[]; skipShots?: readonly number[] }
/** packet.json's shot indices (a plain list, as before skipShots), or the packet itself. */
export type Expected = readonly number[] | Packet | undefined
export interface Summary {
  raters: string[]
  shots: number[]
  /** Same-as-previous shots (packet.json skipShots, --skip, or skipped by every rater): out of the denominator (decision 0003). */
  skipped: number[]
  /** The denominator: shots − skipped. */
  rated: number[]
  /** unrated: blank or unreadable (counted not usable). skippedByRater: a rated shot this rater marked skip (counted neither way). */
  perRater: { rater: string; usable: number; unrated: number[]; inconsistent: number[]; skippedByRater: number[] }[]
  /** Usable when more than half of the raters who voted say usable (a skip vote abstains); a tie counts as not usable. */
  majority: number[]
  ties: number[]
  /** Every voting rater says usable (the strict "both raters" figure of the two-rater runs). */
  allUsable: number[]
  /** Every voting rater gave the same verdict (usable or not). */
  agreed: number[]
  disagreements: { shot: number; votes: { rater: string; usable: boolean | null; skip?: true; note: string }[]; majority: boolean }[]
}

/**
 * Pure (tested). Every rater must have rated the same shots; an unrated shot counts as not usable and is listed. Same-as-previous
 * shots leave the denominator and are never unrated; a skip on any other shot counts neither way and is listed.
 */
export function summarise(raters: RaterScores[], expected?: Expected): Summary {
  if (!raters.length) throw new Error('no raters')
  const packet: Packet = Array.isArray(expected) ? { shotIndices: expected } : (expected ?? {}) as Packet
  const want = packet.shotIndices
  if (want) for (const r of raters) {
    const have = new Set(r.rows.map((x) => x.shot))
    const missing = want.filter((s) => !have.has(s)), extra = [...have].filter((s) => !want.includes(s))
    if (missing.length || extra.length) throw new Error(`${r.rater}/scores.md does not match packet.json (${want.length} shots):${missing.length ? ` missing rows for shots ${missing.join(', ')};` : ''}${extra.length ? ` rows for unknown shots ${extra.join(', ')};` : ''} fix the sheet before scoring`)
  }
  const shots = raters[0]!.rows.map((r) => r.shot).sort((a, b) => a - b)
  for (const r of raters) {
    const mine = r.rows.map((x) => x.shot).sort((a, b) => a - b)
    if (mine.join() !== shots.join()) throw new Error(`${r.rater} rated shots ${mine.join(',')} but ${raters[0]!.rater} rated ${shots.join(',')}`)
  }
  const byShot = (r: RaterScores, s: number) => r.rows.find((x) => x.shot === s)!
  const unknown = (packet.skipShots ?? []).filter((x) => !shots.includes(x))
  if (unknown.length) throw new Error(`skip shots ${unknown.join(', ')} are not in the score sheets`)
  const skipSet = new Set([...(packet.skipShots ?? []), ...shots.filter((x) => raters.every((r) => byShot(r, x).skip))])
  const skipped = shots.filter((x) => skipSet.has(x)), rated = shots.filter((x) => !skipSet.has(x))
  const mine = (r: RaterScores) => r.rows.filter((x) => !skipSet.has(x.shot))
  const s: Summary = {
    raters: raters.map((r) => r.rater), shots, skipped, rated,
    perRater: raters.map((r) => ({
      rater: r.rater, usable: mine(r).filter((x) => x.usable === true).length, unrated: mine(r).filter((x) => x.usable === null && !x.skip).map((x) => x.shot),
      inconsistent: mine(r).filter((x) => x.inconsistent).map((x) => x.shot), skippedByRater: mine(r).filter((x) => x.skip).map((x) => x.shot),
    })),
    majority: [], ties: [], allUsable: [], agreed: [], disagreements: [],
  }
  for (const shot of rated) {
    const votes = raters.map((r) => { const x = byShot(r, shot); return { rater: r.rater, usable: x.usable, ...(x.skip ? { skip: true as const } : {}), note: x.note } })
    const voting = votes.filter((v) => !v.skip), n = voting.length
    const yes = voting.filter((v) => v.usable === true).length
    const majority = yes * 2 > n
    if (majority) s.majority.push(shot)
    if (n && yes * 2 === n) s.ties.push(shot)
    if (n && yes === n) s.allUsable.push(shot)
    if (n && (yes === n || voting.every((v) => v.usable === false)) && voting.length === votes.length) s.agreed.push(shot)
    else s.disagreements.push({ shot, votes, majority })
  }
  return s
}

const pct = (k: number, of: number) => `${k} / ${of} = ${((100 * k) / of).toFixed(1)} %`

/** Pure (tested): the printed report. */
export function formatSummary(s: Summary): string[] {
  const N = s.rated.length, n = s.raters.length
  const out = [`${n} raters (${s.raters.join(', ')}), ${s.shots.length} shots${s.skipped.length ? `, ${N} rated` : ''}`]
  if (s.skipped.length) out.push(`same as previous, not rated (decision 0003): shot${s.skipped.length > 1 ? 's' : ''} ${s.skipped.join(', ')} — score = usable / (${s.shots.length} − ${s.skipped.length})`)
  out.push('')
  for (const r of s.perRater) {
    out.push(`${r.rater}: usable ${pct(r.usable, N)}${r.unrated.length ? `; UNRATED shots ${r.unrated.join(', ')} (counted not usable)` : ''}`)
    if (r.inconsistent.length) out.push(`  warning: ${r.rater} marked shots ${r.inconsistent.join(', ')} usable with a failed criterion; counted unrated — ask the rater`)
    for (const k of r.skippedByRater) out.push(`  note: ${r.rater} marked shot ${k} skip, but it is not a same-as-previous shot; counted neither usable nor not usable (the other raters decide)`)
  }
  out.push('',
    `majority-usable (≥ ${Math.floor(n / 2) + 1} of ${n} raters usable): ${pct(s.majority.length, N)} — gate ≥ ${GATE * 100} %: ${s.majority.length / N >= GATE ? 'PASS' : 'FAIL'}`,
    `  shots: ${s.majority.join(', ') || 'none'}`,
    `all raters usable: ${pct(s.allUsable.length, N)}`,
    `all raters agree (same verdict): ${s.agreed.length} / ${N}`)
  if (s.ties.length) out.push(`ties (even number of raters; counted not usable): ${s.ties.join(', ')}`)
  out.push('', s.disagreements.length ? 'disagreements:' : 'disagreements: none')
  for (const d of s.disagreements) {
    out.push(`  shot ${d.shot} → ${d.majority ? 'usable' : 'not usable'} by majority`)
    for (const v of d.votes) out.push(`    ${v.rater}: ${v.skip ? 'skip' : v.usable === null ? 'unrated' : v.usable ? 'usable' : 'not usable'}${v.note ? ` — ${v.note}` : ''}`)
  }
  return out
}

/** packet.json's shotIndices and skipShots (each undefined when the file or the field is missing). */
export async function readPacket(outDir: string): Promise<Packet> {
  const p = await readFile(join(outDir, 'packet.json'), 'utf8').then((t) => JSON.parse(t) as Packet, () => undefined)
  return { shotIndices: p?.shotIndices, skipShots: p?.skipShots }
}
export const readExpected = async (outDir: string): Promise<readonly number[] | undefined> => (await readPacket(outDir)).shotIndices
/** Reads {outDir}/rater<k>/scores.md for every rater folder, in rater order. */
export async function readRaters(outDir: string): Promise<RaterScores[]> {
  const dirs = (await readdir(outDir, { withFileTypes: true })).filter((d) => d.isDirectory() && /^rater\d+$/.test(d.name)).map((d) => d.name)
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
  if (!dirs.length) throw new Error(`no rater*/ folders in ${outDir}`)
  return Promise.all(dirs.map(async (rater) => ({ rater, rows: parseScores(await readFile(join(outDir, rater, 'scores.md'), 'utf8')) })))
}

/** Pure (tested): `--skip 16,3` → [3, 16]. */
export function parseShotList(v: string): number[] {
  const out = v.split(',').map((x) => x.trim()).filter(Boolean)
  if (!out.length || out.some((x) => !/^\d+$/.test(x))) throw new Error(`a comma-separated list of shot numbers; got "${v}"`)
  return [...new Set(out.map(Number))].sort((a, b) => a - b)
}

/**
 * The scorer's corrections, from `corrections.md` next to packet.json (docs/evaluation.md, "Known limits"): a correction is for
 * something the packet did not show the raters (e.g. dialogue Transcribe missed, so a cue talks over it unseen). It sets one
 * criterion of one shot for every rater; the raters' scores.md files are never changed, and `score` prints both results.
 */
export interface Correction { shot: number; criterion: Criterion; verdict: boolean; reason: string }
const CRITERION_NAMES: Record<string, Criterion> = { faithful: 'faithful', ontime: 'onTime', style: 'style', clean: 'clean', fits: 'fits' }
export const criterionLabel = (c: Criterion) => (c === 'onTime' ? 'on time' : c)

/** Pure (tested): rows `| Shot | Criterion | Verdict | Reason |` (verdict pass / fail, blank = fail) or `| Shot | Criterion | Reason |`. */
export function parseCorrections(md: string): Correction[] {
  const out: Correction[] = []
  for (const line of md.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('|')) continue
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    if (!/^\d+$/.test(cell(cells[0]))) continue
    const shot = Number(cell(cells[0]))
    const criterion = CRITERION_NAMES[cell(cells[1]).replace(/[^a-z]/g, '')]
    if (!criterion) throw new Error(`corrections.md shot ${shot}: unknown criterion "${cells[1]}" (faithful, on time, style, clean, fits)`)
    const v = cell(cells[2])
    const hasVerdict = cells.length >= 4 && (v === '' || PASS.has(v) || FAIL.has(v))
    if (cells.length >= 4 && !hasVerdict) throw new Error(`corrections.md shot ${shot}: verdict must be pass or fail; got "${cells[2]}"`)
    const reason = (hasVerdict ? cells.slice(3) : cells.slice(2)).join('|').trim()
    if (!reason) throw new Error(`corrections.md shot ${shot}: a correction needs a reason`)
    out.push({ shot, criterion, verdict: hasVerdict && PASS.has(v), reason })
  }
  return out
}

/** Pure: the raters' rows with the corrections applied (a skip row is left as it is). Usable follows the corrected criteria. */
export function applyCorrections(raters: RaterScores[], corrections: readonly Correction[]): RaterScores[] {
  return raters.map((r) => ({
    rater: r.rater,
    rows: r.rows.map((row) => {
      const mine = corrections.filter((c) => c.shot === row.shot)
      if (!mine.length || row.skip) return row
      const criteria = { ...row.criteria }
      for (const c of mine) criteria[c.criterion] = c.verdict
      const values = CRITERIA.map((c) => criteria[c])
      const usable = values.some((v) => v === false) ? false : values.every((v) => v === true) ? true : row.inconsistent ? null : row.usable
      return { shot: row.shot, usable, criteria, note: row.note }
    }),
  }))
}

/**
 * `gate-c score <outDir>`: reads packet.json, rater<k>/scores.md and, when present, corrections.md (or o.corrections), and returns
 * the printed lines — the as-rated result, then the corrected one when there are corrections. o.skip adds same-as-previous shots
 * for a packet.json written before skipShots existed. Reads only; never writes a file.
 */
export async function scoreDir(outDir: string, o: { skip?: readonly number[]; corrections?: string } = {}): Promise<{ lines: string[]; unrated: boolean }> {
  const raters = await readRaters(outDir)
  const packet = await readPacket(outDir)
  const skipShots = [...new Set([...(packet.skipShots ?? []), ...(o.skip ?? [])])].sort((a, b) => a - b)
  const s = summarise(raters, { shotIndices: packet.shotIndices, skipShots })
  const lines: string[] = []
  if (o.skip?.length) lines.push(`--skip ${o.skip.join(',')}: not rated as same as previous${packet.skipShots ? ` (packet.json skipShots: ${packet.skipShots.join(', ') || 'none'})` : ' (packet.json has no skipShots)'}`, '')
  const file = o.corrections ?? join(outDir, 'corrections.md')
  const corrections = existsSync(file) ? parseCorrections(await readFile(file, 'utf8')) : []
  if (o.corrections && !existsSync(file)) throw new Error(`no corrections file ${file}`)
  if (!corrections.length) return { lines: [...lines, ...formatSummary(s)], unrated: s.perRater.some((r) => r.unrated.length > 0) }
  const unknown = corrections.filter((c) => !s.shots.includes(c.shot))
  if (unknown.length) throw new Error(`${basename(file)}: shots ${unknown.map((c) => c.shot).join(', ')} are not in the score sheets`)
  const c = summarise(applyCorrections(raters, corrections), { shotIndices: packet.shotIndices, skipShots })
  lines.push('== as rated ==', ...formatSummary(s), '', `== corrected (${basename(file)}, ${corrections.length} correction${corrections.length > 1 ? 's' : ''}) ==`)
  for (const k of corrections) lines.push(`  shot ${k.shot} ${criterionLabel(k.criterion)} → ${k.verdict ? 'pass' : 'fail'}: ${k.reason}${s.skipped.includes(k.shot) ? ' (same-as-previous shot: not rated, no effect)' : ''}`)
  lines.push('', ...formatSummary(c))
  return { lines, unrated: s.perRater.some((r) => r.unrated.length > 0) }
}
