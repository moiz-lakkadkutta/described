import { execa } from 'execa'
import type { Ctx } from './index'
/**
 * Shaka Packager → HLS master with two audio renditions (main, AD with CHARACTERISTICS=public.accessibility.describes-video)
 * and three WebVTT tracks. Aligned 4 s segments so audio switching doesn't rebuffer.
 */
export async function pack(ctx: Ctx) {
  const w = ctx.work
  const out = `${w}/hls`
  await execa('packager', [
    `in=${w}/mezz.mp4,stream=video,segment_template=${out}/video/$Number$.m4s,init_segment=${out}/video/init.mp4,playlist_name=video.m3u8`,
    `in=${w}/mezz.mp4,stream=audio,segment_template=${out}/audio_main/$Number$.m4s,init_segment=${out}/audio_main/init.mp4,playlist_name=audio_main.m3u8,hls_group_id=audio,hls_name=Original,language=${ctx.language}`,
    `in=${w}/audio_ad.m4a,stream=audio,segment_template=${out}/audio_ad/$Number$.m4s,init_segment=${out}/audio_ad/init.mp4,playlist_name=audio_ad.m3u8,hls_group_id=audio,hls_name=Audio%20description,language=${ctx.language},hls_characteristics=public.accessibility.describes-video,roles=description`,
    `in=${w}/captions.vtt,stream=text,segment_template=${out}/captions/$Number$.vtt,playlist_name=captions.m3u8,hls_group_id=text,hls_name=Captions,language=${ctx.language}`,
    `in=${w}/sdh.vtt,stream=text,segment_template=${out}/sdh/$Number$.vtt,playlist_name=sdh.m3u8,hls_group_id=text,hls_name=Rich%20captions,language=${ctx.language},hls_characteristics=public.accessibility.transcribes-spoken-dialog,public.accessibility.describes-music-and-sound`,
    `in=${w}/descriptions.vtt,stream=text,segment_template=${out}/descriptions/$Number$.vtt,playlist_name=descriptions.m3u8,hls_group_id=text,hls_name=Description%20text,language=${ctx.language},roles=description`,
    '--segment_duration', '4', '--hls_master_playlist_output', `${out}/master.m3u8`,
  ], { stdio: 'inherit' })
}
