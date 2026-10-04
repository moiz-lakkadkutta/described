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
  const { stdout } = await execa('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', `${ctx.work}/source.mp4`], { cancelSignal: ctx.signal })
  await writeFile(`${ctx.work}/probe.json`, stdout)
  const video = (JSON.parse(stdout) as { streams: Array<{ codec_type: string; r_frame_rate?: string; avg_frame_rate?: string }> }).streams.find((s) => s.codec_type === 'video')
  const rate = (r?: string) => { const [n, d] = (r ?? '0/0').split('/').map(Number); return n && d ? n / d : 0 }
  await execa('ffmpeg', mezzanineArgs(ctx.work, rate(video?.r_frame_rate) || rate(video?.avg_frame_rate)), { stdio: 'inherit', cancelSignal: ctx.signal })
  const duration = Number((JSON.parse(stdout) as { format?: { duration?: string } }).format?.duration) || 0
  await extractArt(ctx, artAtS(process.env.PIPELINE_ART_AT_S, duration))
}

/** PIPELINE_ART_AT_S when set to a number (0 included: the first frame), else 30 % into the title. */
export const artAtS = (env: string | undefined, durationS: number) => (env !== undefined && env.trim() !== '' && Number.isFinite(Number(env)) ? Number(env) : durationS * 0.3)

/**
 * Hero + poster stills from the mezzanine into work/art/ (10-publish uploads them to published/{slug}/art/; persist('finish')
 * fills a null Title.posterKey/heroKey). Art is optional: a failed grab logs and the run continues.
 */
async function extractArt(ctx: Ctx, atS: number) {
  try {
    await mkdir(`${ctx.work}/art`, { recursive: true })
    const { hero, poster } = artArgs(ctx.work, atS)
    for (const a of [hero, poster]) await execa('ffmpeg', a, { cancelSignal: ctx.signal })
  } catch (e) {
    if (ctx.signal?.aborted) throw e
    console.warn(`probe: art not extracted for ${ctx.slug}; continuing`, e)
  }
}

/**
 * Pure (tested). One frame at `atS` (input seek, before -i: fast) → hero 1488×560 (the Title screen's hero band at 1920×1080:
 * scaled to cover, centre-cropped) and poster 480×720 (2:3, a centre crop of the full height).
 * https://ffmpeg.org/ffmpeg.html#Main-options (-ss, -frames:v) · https://ffmpeg.org/ffmpeg-filters.html#crop · https://ffmpeg.org/ffmpeg-filters.html#scale-1
 */
export function artArgs(work: string, atS: number): { hero: string[]; poster: string[] } {
  const grab = (vf: string, out: string) => ['-y', '-ss', String(atS), '-i', `${work}/mezz.mp4`, '-frames:v', '1', '-vf', vf, '-q:v', '3', `${work}/art/${out}`]
  return { hero: grab('scale=1488:560:force_original_aspect_ratio=increase,crop=1488:560', 'hero.jpg'), poster: grab('crop=ih*2/3:ih,scale=480:720', 'poster.jpg') }
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
