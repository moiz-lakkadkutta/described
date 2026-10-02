import { execa } from 'execa'
import { readFile, writeFile } from 'node:fs/promises'
import type { Ctx } from './index'
export interface Shot { index: number; startMs: number; endMs: number }

/** ffmpeg scene score above which a frame starts a new shot. 0.3 found 3 of 11 real cuts in Sintel's dark firelit scene; 0.1 finds all 11 (Gate C plan D4). */
export const SCENE_THRESHOLD = 0.1
/** The `-vf` for scene-cut detection (pure, tested) — https://ffmpeg.org/ffmpeg-filters.html#select_002c-aselect */
export const sceneFilter = () => `select='gt(scene,${SCENE_THRESHOLD})',showinfo`

/** Scene cuts at SCENE_THRESHOLD; merge < 1.5 s; split > 8 s so each describe call sees one visual idea. */
export async function detectShots(ctx: Ctx) {
  const probe = JSON.parse(await readFile(`${ctx.work}/probe.json`, 'utf8')) as { format: { duration: string } }
  const durationMs = Math.round(parseFloat(probe.format.duration) * 1000)
  const { stderr } = await execa('ffmpeg', ['-i', `${ctx.work}/mezz.mp4`, '-vf', sceneFilter(), '-f', 'null', '-'], { reject: false })
  const cuts = [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Math.round(parseFloat(m[1]!) * 1000))
  const shots = shotsFromCuts(cuts, durationMs)
  await writeFile(`${ctx.work}/shots.json`, JSON.stringify(shots, null, 2))
  // No per-shot clips: describe (04) grabs its own key frames from mezz.mp4 (Gate C, decision 0003).
}

export function shotsFromCuts(cutsMs: number[], durationMs: number, minMs = 1500, maxMs = 8000): Shot[] {
  const bounds = [0, ...cutsMs.filter((c) => c > 0 && c < durationMs), durationMs]
  const raw: Array<[number, number]> = []
  for (let i = 0; i < bounds.length - 1; i++) raw.push([bounds[i]!, bounds[i + 1]!])
  // merge short shots into the previous
  const merged: Array<[number, number]> = []
  for (const [s, e] of raw) { const prev = merged.at(-1); if (prev && e - s < minMs) prev[1] = e; else merged.push([s, e]) }
  // split long shots into n equal parts (fixed maxMs pieces left sub-minMs tails)
  const out: Shot[] = []
  for (const [s, e] of merged) { const n = Math.ceil((e - s) / maxMs); const len = (e - s) / n; for (let k = 0; k < n; k++) out.push({ index: out.length, startMs: Math.round(s + k * len), endMs: Math.round(s + (k + 1) * len) }) }
  return out
}
