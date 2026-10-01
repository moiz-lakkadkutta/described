# fire tv stick caps h 264 decode at 1920 wide and falls back to software silently

Task attempted: Play our packaged HLS (2534x1080 H.264 High, `avc1.640032` = Level 5.0; Sintel's native 2.39:1 width
scaled to 1080 high) on a Fire TV Stick.
Steps:
  1. Pointed ExoPlayer (react-native-video) at the CloudFront master playlist.
  2. Watched `adb logcat` during playback and seeks.
Expected: Hardware decode at 24 fps, or ExoPlayer reporting the format as unsupported.
Actual: `OMX.MTK.VIDEO.DECODER.AVC` throws IllegalArgumentException from `MediaCodec.configure`
(`configureCodec returning error -22`). ExoPlayer falls back to `OMX.google.h264.decoder`
(`Format exceeds selected codec's capabilities [codecs=avc1.640032, res=2534x1080, fps=24]`), which dropped 390 frames
in ~70 s (~5–6 of 24 fps). Seeks took ~3 s; time to first frame 3–4 s. `/vendor/etc/media_codecs.xml` caps every AVC
decoder at 1920x1088. Nothing on screen or in the player API says playback is on a software decoder.
Cause: Our pipeline scales by height only (`scale=-2:1080`), so 2.39:1 content comes out 2534 wide — above the
hardware decoder's 1920x1088 limit (and above the Level 4 the spec page lists for this model).
Severity: High — for any content wider than 1920, playback is unwatchable on this model with no error to catch.
Workaround: Encode renditions to fit inside 1920x1080 (1920x818 for 2.39:1).
Suggestion: The Fire TV Streaming Media Player specifications page lists AFTSS H.264 as "Hardware accelerated up to
1080p @ 60fps, High Profile up to Level 4." but gives no maximum width in pixels; it should state the decoder's
max frame size (1920x1088) so wider-than-16:9 1080-line content is not assumed to fit "1080p". react-native-video could
expose the selected decoder name and any capability fallback in `onLoad` (or an event) so apps can detect it.
Environment: Apple Silicon Mac, Darwin 25.2 (macOS 26); Fire TV Stick model AFTSS, Fire OS 7.7.1.6 (Android 9, API 28);
react-native-video 6.x (androidx.media3 1.8.0); stream served from CloudFront, packaged with Shaka Packager 3.9.3.
Observed 2026-10-01.
Links: https://developer.amazon.com/docs/device-specs/device-specifications-fire-tv-streaming-media-player.html
