import { execa } from 'execa'
import { readFile } from 'node:fs/promises'
import type { Ctx } from './index'
/**
 * Shaka Packager → HLS master with two audio renditions (main, AD with CHARACTERISTICS=public.accessibility.describes-video)
 * and three WebVTT tracks. Aligned 4 s segments (4 s GOP from 01-probe) so audio switching doesn't rebuffer.
 * Runs in the work dir with relative paths, as the docs' examples do (`playlist_name` is relative to the master playlist):
 * https://shaka-project.github.io/shaka-packager/html/tutorials/hls.html · https://shaka-project.github.io/shaka-packager/html/documentation.html
 */
export async function pack(ctx: Ctx) {
  const hasCaptions = /-->/.test(await readFile(`${ctx.work}/captions.vtt`, 'utf8'))
  await execa('packager', buildPackagerArgs(ctx.language, hasCaptions), { cwd: ctx.work, stdio: 'inherit' })
}

/**
 * Pure (tested). Descriptors are split only on `,` and `=`, so `hls_name` takes real spaces (no %20) and the multi-value
 * `hls_characteristics` list is `;`-separated ("colon or semi-colon separated list" — documentation.html); Packager joins
 * them with `,` in the playlist. `roles=description` is the DASH Role alias; the HLS AD signal is the characteristic.
 * Packager v3.9.3 rejects a zero-cue WebVTT input (`Packaging Error: 6 (END_OF_STREAM)`, DESC-001 dry run), so when the clip
 * has no dialogue (`hasCaptions=false`) the captions and SDH descriptors are omitted; the whole-file VTTs are still published.
 */
export function buildPackagerArgs(language: 'en' | 'de', hasCaptions: boolean): string[] {
  const captions = hasCaptions ? [
    `in=captions.vtt,stream=text,segment_template=hls/captions/$Number$.vtt,playlist_name=captions.m3u8,hls_group_id=text,hls_name=Captions,language=${language}`,
    `in=sdh.vtt,stream=text,segment_template=hls/sdh/$Number$.vtt,playlist_name=sdh.m3u8,hls_group_id=text,hls_name=Rich captions,language=${language},hls_characteristics=public.accessibility.transcribes-spoken-dialog;public.accessibility.describes-music-and-sound`,
  ] : []
  return [
    'in=mezz.mp4,stream=video,segment_template=hls/video/$Number$.m4s,init_segment=hls/video/init.mp4,playlist_name=video.m3u8',
    `in=mezz.mp4,stream=audio,segment_template=hls/audio_main/$Number$.m4s,init_segment=hls/audio_main/init.mp4,playlist_name=audio_main.m3u8,hls_group_id=audio,hls_name=Original,language=${language}`,
    `in=audio_ad.m4a,stream=audio,segment_template=hls/audio_ad/$Number$.m4s,init_segment=hls/audio_ad/init.mp4,playlist_name=audio_ad.m3u8,hls_group_id=audio,hls_name=Audio description,language=${language},hls_characteristics=public.accessibility.describes-video,roles=description`,
    ...captions,
    `in=descriptions.vtt,stream=text,segment_template=hls/descriptions/$Number$.vtt,playlist_name=descriptions.m3u8,hls_group_id=text,hls_name=Description text,language=${language},roles=description`,
    '--segment_duration', '4', '--hls_master_playlist_output', 'hls/master.m3u8',
  ]
}
