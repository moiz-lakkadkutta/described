import { execa } from 'execa'
import { mkdir, writeFile } from 'node:fs/promises'
import { download } from '../s3'
import type { Ctx } from './index'
/**
 * Download source (S3 GetObject), probe, normalize to a 1080p H.264 + stereo AAC 48 kHz mezzanine.
 * Keyframes are forced every 4 s (and scene-cut keyframes disabled) so Packager's `--segment_duration 4` yields
 * identical segment boundaries for both audio renditions — https://ffmpeg.org/ffmpeg.html#Main-options (-force_key_frames expr:).
 */
export async function probe(ctx: Ctx) {
  await mkdir(ctx.work, { recursive: true })
  await download(ctx.source, `${ctx.work}/source.mp4`)
  const { stdout } = await execa('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', `${ctx.work}/source.mp4`])
  await writeFile(`${ctx.work}/probe.json`, stdout)
  await execa('ffmpeg', ['-y', '-i', `${ctx.work}/source.mp4`, '-vf', 'scale=-2:1080', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-force_key_frames', 'expr:gte(t,n_forced*4)', '-sc_threshold', '0', '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '192k', '-movflags', '+faststart', `${ctx.work}/mezz.mp4`], { stdio: 'inherit' })
}
