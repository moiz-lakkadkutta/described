import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** DESC-030: reads the raters' filled scores.md files and computes the Gate C numbers (docs/evaluation.md). */

export const CRITERIA = ['faithful', 'onTime', 'style', 'clean', 'fits'] as const
export type Criterion = typeof CRITERIA[number]
/** The gate: majority-usable shots / all shots (docs/evaluation.md, decision 0003). */
export const GATE = 0.7

/** inconsistent: the Usable column says yes while a criterion fails — counted unrated (not usable) and reported. */
export interface ShotScore { shot: number; usable: boolean | null; criteria: Record<Criterion, boolean | null>; note: string; inconsistent?: true }

const PASS = new Set(['pass', 'p', 'yes', 'y', 'ok', '✓', '✔', 'n/a', 'na'])
const FAIL = new Set(['fail', 'f', 'no', 'n', 'x', '✗', '✘'])
const USABLE = new Set(['yes', 'y', 'usable', 'pass', '✓', '✔'])
const UNUSABLE = new Set(['no', 'n', 'unusable', 'not usable', 'fail', '✗', '✘', 'x'])
const cell = (s: string | undefined) => (s ?? '').replace(/\*\*/g, '').trim().toLowerCase()
const verdict = (s: string, yes: Set<string>, no: Set<string>) => (yes.has(s) ? true : no.has(s) ? false : null)

/**
 * Pure (tested): the rows of a scores.md table `| Shot | Faithful | On time | Style | Clean | Fits | Usable | Note |`. A row is any
 * table line whose first cell is a shot number. Usable is read from its column; when that is blank it is derived from the five
 * criteria (all pass or n/a → usable), and stays null (unrated) while any criterion is blank or unreadable, or when it says usable
 * while a criterion fails (inconsistent).
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
    let usable = written ? verdict(written, USABLE, UNUSABLE) : null
    if (!written && values.every((v) => v !== null)) usable = values.every(Boolean)
    const inconsistent = usable === true && values.some((v) => v === false)
    rows.push({ shot: Number(shot), usable: inconsistent ? null : usable, criteria, note: (cells.slice(7).join('|') ?? '').trim(), ...(inconsistent ? { inconsistent: true as const } : {}) })
  }
  if (new Set(rows.map((r) => r.shot)).size !== rows.length) throw new Error('a shot appears twice in the scores table')
  return rows
}

export interface RaterScores { rater: string; rows: ShotScore[] }
/** packet.json's shot indices, when the packets came from `gate-c packets`: every rater must have a row for each. */
export type Expected = readonly number[] | undefined
export interface Summary {
  raters: string[]
  shots: number[]
  perRater: { rater: string; usable: number; unrated: number[]; inconsistent: number[] }[]
  /** Usable when more than half of the raters say usable; with an even number of raters a tie counts as not usable. */
  majority: number[]
  ties: number[]
  /** Every rater says usable (the strict "both raters" figure of the two-rater runs). */
  allUsable: number[]
  /** Every rater gave the same verdict (usable or not). */
  agreed: number[]
  disagreements: { shot: number; votes: { rater: string; usable: boolean | null; note: string }[]; majority: boolean }[]
}

/** Pure (tested). Every rater must have rated the same shots; an unrated shot counts as not usable and is listed. */
export function summarise(raters: RaterScores[], expected?: Expected): Summary {
  if (!raters.length) throw new Error('no raters')
  if (expected) for (const r of raters) {
    const have = new Set(r.rows.map((x) => x.shot))
    const missing = expected.filter((s) => !have.has(s)), extra = [...have].filter((s) => !expected.includes(s))
    if (missing.length || extra.length) throw new Error(`${r.rater}/scores.md does not match packet.json (${expected.length} shots):${missing.length ? ` missing rows for shots ${missing.join(', ')};` : ''}${extra.length ? ` rows for unknown shots ${extra.join(', ')};` : ''} fix the sheet before scoring`)
  }
  const shots = raters[0]!.rows.map((r) => r.shot).sort((a, b) => a - b)
  for (const r of raters) {
    const mine = r.rows.map((x) => x.shot).sort((a, b) => a - b)
    if (mine.join() !== shots.join()) throw new Error(`${r.rater} rated shots ${mine.join(',')} but ${raters[0]!.rater} rated ${shots.join(',')}`)
  }
  const byShot = (r: RaterScores, s: number) => r.rows.find((x) => x.shot === s)!
  const n = raters.length
  const s: Summary = {
    raters: raters.map((r) => r.rater), shots,
    perRater: raters.map((r) => ({ rater: r.rater, usable: r.rows.filter((x) => x.usable === true).length, unrated: r.rows.filter((x) => x.usable === null).map((x) => x.shot), inconsistent: r.rows.filter((x) => x.inconsistent).map((x) => x.shot) })),
    majority: [], ties: [], allUsable: [], agreed: [], disagreements: [],
  }
  for (const shot of shots) {
    const votes = raters.map((r) => ({ rater: r.rater, usable: byShot(r, shot).usable, note: byShot(r, shot).note }))
    const yes = votes.filter((v) => v.usable === true).length
    const majority = yes * 2 > n
    if (majority) s.majority.push(shot)
    if (yes * 2 === n) s.ties.push(shot)
    if (yes === n) s.allUsable.push(shot)
    if (yes === n || votes.every((v) => v.usable === false)) s.agreed.push(shot)
    else s.disagreements.push({ shot, votes, majority })
  }
  return s
}

const pct = (k: number, of: number) => `${k} / ${of} = ${((100 * k) / of).toFixed(1)} %`

/** Pure (tested): the printed report. */
export function formatSummary(s: Summary): string[] {
  const N = s.shots.length, n = s.raters.length
  const out = [`${n} raters (${s.raters.join(', ')}), ${N} shots`, '']
  for (const r of s.perRater) {
    out.push(`${r.rater}: usable ${pct(r.usable, N)}${r.unrated.length ? `; UNRATED shots ${r.unrated.join(', ')} (counted not usable)` : ''}`)
    if (r.inconsistent.length) out.push(`  warning: ${r.rater} marked shots ${r.inconsistent.join(', ')} usable with a failed criterion; counted unrated — ask the rater`)
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
    for (const v of d.votes) out.push(`    ${v.rater}: ${v.usable === null ? 'unrated' : v.usable ? 'usable' : 'not usable'}${v.note ? ` — ${v.note}` : ''}`)
  }
  return out
}

/** Reads {outDir}/rater<k>/scores.md for every rater folder, in rater order. */
export async function readExpected(outDir: string): Promise<Expected> {
  const p = await readFile(join(outDir, 'packet.json'), 'utf8').then((t) => JSON.parse(t) as { shotIndices?: number[] }, () => undefined)
  return p?.shotIndices
}
export async function readRaters(outDir: string): Promise<RaterScores[]> {
  const dirs = (await readdir(outDir, { withFileTypes: true })).filter((d) => d.isDirectory() && /^rater\d+$/.test(d.name)).map((d) => d.name)
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
  if (!dirs.length) throw new Error(`no rater*/ folders in ${outDir}`)
  return Promise.all(dirs.map(async (rater) => ({ rater, rows: parseScores(await readFile(join(outDir, rater, 'scores.md'), 'utf8')) })))
}
