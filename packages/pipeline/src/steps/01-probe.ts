import { execa } from 'execa'
import { mkdir, writeFile } from 'node:fs/promises'
import { download } from '../s3'
import type { Ctx } from './index'
/**
 * Download source (S3 GetObject), probe, normalize to an H.264 (≤ 1920×1080) + stereo AAC 48 kHz mezzanine.
 * Keyframes are forced every 4 s (and scene-cut keyframes disabled) so Packager's `--segment_duration 4` yields
 * identical segment boundaries for both audio renditions — https://ffmpeg.org/ffmpeg.html#Main-options (-force_key_frames expr:).
 */
export async function probe(ctx: Ctx) {
  await mkdir(ctx.work, { recursive: true })
  await download(ctx.source, `${ctx.work}/source.mp4`)
  const { stdout } = await execa('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', `${ctx.work}/source.mp4`])
  await writeFile(`${ctx.work}/probe.json`, stdout)
  const video = (JSON.parse(stdout) as { streams: Array<{ codec_type: string; r_frame_rate?: string; avg_frame_rate?: string }> }).streams.find((s) => s.codec_type === 'video')
  const rate = (r?: string) => { const [n, d] = (r ?? '0/0').split('/').map(Number); return n && d ? n / d : 0 }
  await execa('ffmpeg', mezzanineArgs(ctx.work, rate(video?.r_frame_rate) || rate(video?.avg_frame_rate)), { stdio: 'inherit' })
}

/**
 * Pure (tested). Fits inside 1920×1080 without upscaling (keeps aspect, even dimensions), High Profile Level 4.0 with a
 * VBV inside the level (High: 25 Mbit/s, 31.25 Mbit CPB), and ≤ 30 fps (also when the rate is unknown, sourceFps 0) so 1080p stays under Level 4.0's 245,760 MB/s —
 * the Fire TV Stick decodes "H.264 … High Profile up to Level 4" in hardware and falls back to a software decoder above
 * 1920×1088 (Gate A spike): https://developer.amazon.com/docs/device-specs/device-specifications-fire-tv-streaming-media-player.html
 * Only the first video and first audio stream are kept (`-map 0:v:0 -map 0:a:0`, `-sn -dn`): a second audio track or a subtitle/data
 * stream in the source would otherwise reach Packager — https://ffmpeg.org/ffmpeg.html#Advanced-options
 * Filters: https://ffmpeg.org/ffmpeg-filters.html#scale-1 · https://ffmpeg.org/ffmpeg-filters.html#fps-1
 */
export function mezzanineArgs(work: string, sourceFps: number): string[] {
  const vf = `scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2${!(sourceFps > 0 && sourceFps <= 30) ? ',fps=30' : ''}`
  return ['-y', '-i', `${work}/source.mp4`, '-map', '0:v:0', '-map', '0:a:0', '-sn', '-dn', '-vf', vf, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-profile:v', 'high', '-level:v', '4.0', '-maxrate', '16M', '-bufsize', '24M', '-pix_fmt', 'yuv420p', '-force_key_frames', 'expr:gte(t,n_forced*4)', '-sc_threshold', '0', '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '192k', '-movflags', '+faststart', `${work}/mezz.mp4`]
}
