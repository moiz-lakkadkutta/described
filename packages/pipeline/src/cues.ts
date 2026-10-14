import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { serializeVtt } from '@moizp/vega-media-kit/core'
import type { FitCue } from './steps/05-fit'

/**
 * Description cue ids. Canonical order: start, then end (how the kit's parseVtt sorts, and how the API orders
 * DescriptionCue rows). fit already sorts cues.json by start; the end tie-break only matters for two cues starting on
 * the same millisecond.
 * - `d{n}` is the n-th cue (1-based) in that order: the VTT cue identifier in descriptions.vtt (08-text) and in the
 *   API's descriptions.vtt, the DescriptionCue row n of the title, and `:cueId` in GET /titles/:slug/cues/:cueId/audio.
 *   The app counts the n-th cue of the description track rather than reading the identifier.
 * - The Polly clip keeps the cues.json index `i` (06-voice writes work/{slug}/cue_{i}.mp3), and each row's pollyKey names
 *   its own clip, so order never mixes clips up.
 * - Published clip keys carry a hash of the clip's bytes — published/{slug}/cues/cue_{i}.{hash}.mp3 — because clips are
 *   cached for a year as immutable: a re-run on the same slug that changes cue i gets a new key (and a new row), never a
 *   stale cached cue_{i}.mp3.
 */
export const vttCueId = (i: number) => `d${i + 1}`
export const cueAudioFile = (i: number) => `cue_${i}.mp3`
/** First 12 hex of the clip's SHA-256. */
export const clipHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex').slice(0, 12)
export const cueAudioKey = (slug: string, i: number, hash: string) => `published/${slug}/cues/cue_${i}.${hash}.mp3`

/**
 * The latest each cue may end on the film's clock: the title's duration (probe.json), and for an extended cue also the start of the
 * next other cue at or after its own start. An extended cue's endMs from 06-voice is start + clip length, but the film is paused
 * while that clip plays, so on the film's clock it has no length of its own: left as is it overlaps the cue the voice step placed
 * TEXT_LEAD_MS after it (tears-of-steel d7/d8) and can end after the film does (tears-of-steel d15, 62.9 s on a 60.0 s title).
 * A cue sharing the extended cue's start caps it at that start, so filmEnds' 1 ms floor applies: the extended cue keeps the
 * shortest length a cue may have, sorts first (start, then end), and no start moves — the 1 ms overlap is the floor. Infinity
 * when neither cap applies.
 */
function endCaps(cues: readonly FitCue[], durationMs?: number): number[] {
  return cues.map((c, k) => {
    const next = c.extended ? Math.min(Infinity, ...cues.flatMap((d, j) => (j !== k && d.startMs >= c.startMs ? [d.startMs] : []))) : Infinity
    return Math.min(next, durationMs ?? Infinity)
  })
}
/**
 * cues with endMs clamped to their endCaps, never to or before the start (a cue keeps ≥ 1 ms). A cue starting at or after the
 * title's end is dropped: nothing plays there, so it cannot be heard, and every cue left ends by the duration (06-voice already
 * leaves such cues out, so neither Polly nor 07-mix sees them; this keeps cues.json from an older run consistent). Pure (tested).
 */
export function filmEnds<T extends FitCue>(cues: readonly T[], durationMs?: number): T[] {
  const kept = durationMs === undefined ? [...cues] : cues.filter((c) => c.startMs < durationMs)
  const caps = endCaps(kept, durationMs)
  return kept.map((c, k) => ({ ...c, endMs: Math.max(c.startMs + 1, Math.min(c.endMs, caps[k]!)) }))
}

/**
 * cues.json in canonical order (start, then end — ends clamped by filmEnds first, so the order matches the DescriptionCue rows the
 * API sorts), each with its cues.json index (its clip). Cues filmEnds drops are left out; the others keep their own index.
 */
export function ordered(cues: readonly FitCue[], durationMs?: number): (FitCue & { i: number })[] {
  return filmEnds(cues.map((c, i) => ({ ...c, i })), durationMs).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
}

/** The title's length in ms from work/probe.json; undefined when the file or the number is missing. */
export async function probeDurationMs(work: string): Promise<number | undefined> {
  const probe = JSON.parse(await readFile(`${work}/probe.json`, 'utf8').catch(() => '{}')) as { format?: { duration?: string } }
  const s = parseFloat(probe.format?.duration ?? '')
  return Number.isFinite(s) ? Math.round(s * 1000) : undefined
}

/** One line of cue text: whitespace collapsed, no `-->` or `{…}` a parser would read as timing or meta (as apps/api does). */
export const vttText = (t: string) => t.replace(/-->/g, '→').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()

/**
 * descriptions.vtt: every cue ≥ 833 ms on screen where that fits under its endCaps (an extended cue never past the next cue's start,
 * no cue past the title's end), extended ones with `{extended=1;words=N}` meta.
 */
export function descriptionsVtt(cues: readonly FitCue[], durationMs?: number): string {
  const o = ordered(cues, durationMs)
  const caps = endCaps(o, durationMs)
  return serializeVtt(o.map((c, n) => ({
    trackId: 'desc', id: vttCueId(n), start: c.startMs / 1000, end: Math.max(c.endMs, Math.min(c.startMs + 833, caps[n]!)) / 1000, text: vttText(c.text),
    ...(c.extended ? { meta: { extended: '1', words: String(c.wordCount) } } : {}),
  })))
}

export interface DescriptionCueRow { titleId: string; startMs: number; endMs: number; text: string; extended: boolean; wordCount: number; pollyKey: string | null }
/** DescriptionCue rows in canonical order; pollyKey only where the clip was published (`published`: cues.json index → key). */
export function descriptionCueRows(titleId: string, cues: readonly FitCue[], published: ReadonlyMap<number, string>, durationMs?: number): DescriptionCueRow[] {
  return ordered(cues, durationMs).map((c) => ({
    titleId, startMs: c.startMs, endMs: c.endMs, text: c.text, extended: c.extended, wordCount: c.wordCount,
    pollyKey: published.get(c.i) ?? null,
  }))
}

/** work/{slug}/clips.json: cues.json index → published clip key, written by 10-publish after the uploads. */
export const CLIPS_FILE = 'clips.json'
export const writeClips = (work: string, clips: ReadonlyMap<number, string>) => writeFile(`${work}/${CLIPS_FILE}`, JSON.stringify(Object.fromEntries(clips)))
export const readClips = async (work: string) => new Map(Object.entries(JSON.parse(await readFile(`${work}/${CLIPS_FILE}`, 'utf8')) as Record<string, string>).map(([i, k]) => [Number(i), k]))

/** What writing DescriptionCue rows needs, structurally (Prisma's client satisfies it). */
export interface CueDb {
  descriptionCue: { deleteMany(a: { where: { titleId: string } }): unknown; createMany(a: { data: DescriptionCueRow[] }): unknown }
  $transaction(ops: never[]): Promise<unknown>
}
/** The two writes that replace the title's DescriptionCue rows from cues.json, clips.json and probe.json, not yet run (Prisma's are lazy). */
export async function descriptionCueOps(db: CueDb, titleId: string, work: string): Promise<unknown[]> {
  const cues = JSON.parse(await readFile(`${work}/cues.json`, 'utf8')) as FitCue[]
  const rows = descriptionCueRows(titleId, cues, await readClips(work), await probeDurationMs(work))
  return [db.descriptionCue.deleteMany({ where: { titleId } }), db.descriptionCue.createMany({ data: rows })]
}
/**
 * Replaces the title's DescriptionCue rows in one transaction. The worker calls it from persist('finish') (src/jobs.ts):
 * only after steps 6–10 succeeded inside the job's deadline, with the job's own db and titleId.
 */
export async function writeDescriptionCues(db: CueDb, titleId: string, work: string) {
  await db.$transaction((await descriptionCueOps(db, titleId, work)) as never[])
}

/** What the CLI path needs: the worker's Db plus a lookup by slug and a disconnect (Prisma's client satisfies it). */
export type CliDb = import('./jobs').Db & { $disconnect(): Promise<void> }
/** What the run spoke: --lang and the resolved --voice. */
export interface Spoken { language: string; voice: string }

/**
 * The CLI's path (no job, no titleId): looks the title up by slug and writes what the worker's jobs write —
 * DescriptionCue rows, Rendition and TextTrack rows, the art keys (src/jobs.ts trackRowOps), Title.durationS from probe.json
 * (persist('probe')) — plus Title.voice and Title.language from the run (`spoken`: what was actually spoken, which labels the AD
 * track; the worker reads them from the row, so there they already agree), and status = published last. All of it in one
 * transaction: a failure leaves the previous rows, and a --from re-run of a published title never serves a mix of old and new
 * rows. Without DATABASE_URL, or without a Title row, it warns and skips.
 */
export async function persistForCli(slug: string, work: string, spoken?: Spoken, open?: () => Promise<CliDb>) {
  if (!open && !process.env.DATABASE_URL) { console.warn('no DATABASE_URL: DescriptionCue, Rendition and TextTrack rows not written'); return }
  const db = open ? await open() : (new (await import('@prisma/client')).PrismaClient() as CliDb)
  try {
    const t = await db.title.findUnique({ where: { slug }, select: { id: true } })
    if (!t) { console.warn(`no Title row for ${slug}: DescriptionCue, Rendition and TextTrack rows not written`); return }
    const { trackRowOps } = await import('./jobs') // dynamic: jobs.ts imports this module
    const durationMs = await probeDurationMs(work)
    const durationS = durationMs === undefined ? undefined : durationMs / 1000
    const rows = [...(await descriptionCueOps(db as never, t.id, work)), ...(await trackRowOps(t.id, work, db))]
    const title = db.title.update({ where: { id: t.id }, data: { ...(durationS !== undefined ? { durationS } : {}), ...(spoken ? { voice: spoken.voice, language: spoken.language } : {}), status: 'published' } })
    await db.$transaction([...rows, title] as never) // Prisma runs a batch in order: status is the last write
    console.log(`${slug}: published${durationS !== undefined ? ` (${durationS.toFixed(1)} s)` : ''}`)
  } finally { await db.$disconnect() }
}
