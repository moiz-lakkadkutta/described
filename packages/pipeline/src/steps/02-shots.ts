import { execa } from 'execa'
import { readFile, writeFile } from 'node:fs/promises'
import type { Ctx } from './index'
export interface Shot { index: number; startMs: number; endMs: number }

/** Scene cuts at threshold 0.3; merge < 1.5 s; split > 8 s so each Nova call sees one visual idea. */
export async function detectShots(ctx: Ctx) {
  const probe = JSON.parse(await readFile(`${ctx.work}/probe.json`, 'utf8')) as { format: { duration: string } }
  const durationMs = Math.round(parseFloat(probe.format.duration) * 1000)
  const { stderr } = await execa('ffmpeg', ['-i', `${ctx.work}/mezz.mp4`, '-vf', "select='gt(scene,0.3)',showinfo", '-f', 'null', '-'], { reject: false })
  const cuts = [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Math.round(parseFloat(m[1]!) * 1000))
  const shots = shotsFromCuts(cuts, durationMs)
  await writeFile(`${ctx.work}/shots.json`, JSON.stringify(shots, null, 2))
  // Extract each shot as a small clip for Nova (S3 URI input; ≤ 25 MB base64 alternative not needed).
  for (const s of shots) await execa('ffmpeg', ['-y', '-ss', `${s.startMs / 1000}`, '-to', `${s.endMs / 1000}`, '-i', `${ctx.work}/mezz.mp4`, '-vf', 'scale=-2:480', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', `${ctx.work}/shot_${s.index}.mp4`], { stdio: 'ignore' })
}

export function shotsFromCuts(cutsMs: number[], durationMs: number, minMs = 1500, maxMs = 8000): Shot[] {
  const bounds = [0, ...cutsMs.filter((c) => c > 0 && c < durationMs), durationMs]
  const raw: Array<[number, number]> = []
  for (let i = 0; i < bounds.length - 1; i++) raw.push([bounds[i]!, bounds[i + 1]!])
  // merge short shots into the previous
  const merged: Array<[number, number]> = []
  for (const [s, e] of raw) { const prev = merged.at(-1); if (prev && e - s < minMs) prev[1] = e; else merged.push([s, e]) }
  // split long shots
  const out: Shot[] = []
  for (const [s, e] of merged) for (let a = s; a < e; a += maxMs) out.push({ index: out.length, startMs: a, endMs: Math.min(a + maxMs, e) })
  return out
}
