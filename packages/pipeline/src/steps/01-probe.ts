import { execa } from 'execa'
import { mkdir, writeFile } from 'node:fs/promises'
import type { Ctx } from './index'
/** Download source (s3 cp), probe, normalize to a 1080p H.264 + stereo AAC mezzanine. */
export async function probe(ctx: Ctx) {
  await mkdir(ctx.work, { recursive: true })
  await execa('aws', ['s3', 'cp', ctx.source, `${ctx.work}/source.mp4`], { stdio: 'inherit' })
  const { stdout } = await execa('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', `${ctx.work}/source.mp4`])
  await writeFile(`${ctx.work}/probe.json`, stdout)
  await execa('ffmpeg', ['-y', '-i', `${ctx.work}/source.mp4`, '-vf', 'scale=-2:1080', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-ac', '2', '-b:a', '192k', `${ctx.work}/mezz.mp4`], { stdio: 'inherit' })
}
