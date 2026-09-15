# 0001 — Week-0 gates

Status: pending (fill in Sept 17)

- Gate A (media pipeline tests 1–6):
- Gate B (Vega blocks > 1 day):
- Gate C (AI quality):

Decision:

## Local dry runs (DESC-001 part 1)

Free checks on 2026-09-15 before any paid call (runbook §7). Tools: ffmpeg 8.0, Shaka Packager v3.9.3 (`packager-osx-arm64`),
AWS CLI 2.36.45 (installed, unused). Every check drives the *real* arg builders (`buildPackagerArgs`, `buildMixArgs`,
`buildLoudnormMeasureArgs`, `buildLoudnormApplyArgs`) from `packages/pipeline/src/steps/`.

### 1. Packager dry run — PASS (with one finding)

Inputs, 10 s synthetic clip + silent "AD" + three VTTs:
```
ffmpeg -y -f lavfi -i testsrc=size=640x360:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 10 \
  -c:v libx264 -pix_fmt yuv420p -force_key_frames 'expr:gte(t,n_forced*4)' -sc_threshold 0 -c:a aac -ac 2 -ar 48000 -movflags +faststart mezz.mp4
ffmpeg -y -f lavfi -i anullsrc=r=48000:cl=stereo -t 10 -c:a aac -b:a 192k audio_ad.m4a
# descriptions.vtt: 2 cues, the second ending in " {extended=1;words=12}"; captions.vtt and sdh.vtt: "WEBVTT\n" only
packager <buildPackagerArgs('en', hasCaptions)…>   # cwd = the work dir, relative paths
```
| Check | Result |
|---|---|
| `#EXT-X-MEDIA:TYPE=AUDIO` lines | **2** (`NAME="Original"`, `NAME="Audio description"`), both `AUTOSELECT=YES` |
| AD line carries `CHARACTERISTICS="public.accessibility.describes-video"` | **yes** (1 line) |
| `%20` anywhere in master.m3u8 | **no** — real spaces in `NAME=` |
| `TYPE=SUBTITLES` lines with 1-cue captions/sdh (`hasCaptions=true`) | **3** (`Captions`, `Rich captions` with `CHARACTERISTICS="public.accessibility.transcribes-spoken-dialog,public.accessibility.describes-music-and-sound"`, `Description text`) |
| `TYPE=SUBTITLES` lines with zero-cue captions/sdh (`hasCaptions=false`) | **1** (`Description text`) — see finding |
| `parseVtt(hls/descriptions/2.vtt, {trackId:'desc'})` from `@moizp/vega-media-kit/core` | 1 cue, `meta.extended === '1'`, `meta.words === '12'` (Packager appends `align:center` to the timing line; the kit ignores unknown settings) |

**Finding:** Packager v3.9.3 rejects a zero-cue WebVTT input with `Packaging Error: 6 (END_OF_STREAM)` — tried `WEBVTT\n`,
`WEBVTT\n\n` and `WEBVTT\n\nNOTE …\n\n`; all fail, and the run produces no master playlist. `09-package` therefore omits the
captions and SDH descriptors when `captions.vtt` has no cue (Sintel 0:00–1:00 has no dialogue, so both files are header-only
there), and the whole-file VTTs are still published. Gate A2 for that window will show 1 text track, not 3.

### 2. Duck depth — PASS: 9.03 dB (target 9.0 ± 0.5)

20 s bed (`sine=frequency=440:sample_rate=48000`, `volume=1dB` → peak −19.77 dBFS, RMS −23.09 dB) with one cue at 6000–9000 ms;
duck-only stem = `buildMixArgs(work, [cue], 20)` with the final `amix` replaced by `[narr]anullsink;[ducked]anull[out]`.
```
ffmpeg -ss 6.5 -t 1 -i ducked.wav -af astats=measure_overall=RMS_level:measure_perchannel=none -f null -   # RMS level dB: -32.12
ffmpeg -ss 12  -t 1 -i ducked.wav -af astats=measure_overall=RMS_level:measure_perchannel=none -f null -   # RMS level dB: -23.09
```
Difference **9.03 dB** — exactly the arithmetic for `sidechaincompress=threshold=0.25:ratio=4:knee=1:detection=peak` keyed by a 0 dBFS
`aevalsrc` envelope (`exprs='between(t,6,9)|between(t,6,9)'`, one expression per channel; the `'…'` quoting keeps the commas inside the option).

### 3. Termination — PASS: 20.000 s (bed 20 s, ± 0.1 s)

`ffmpeg <buildMixArgs(work, [cue], 20)>` exits 0 in 0.1 s; `ffprobe -show_entries format=duration premix.wav` → **20.000**.
Loudnorm passes B + C run on the same premix (free, not required): measured `input_i −21.27, input_tp −19.77, input_lra 3.4,
input_thresh −31.27` → linear apply → `audio_ad.m4a` 20.000 s, aac 48000 Hz stereo, `ebur128` I = **−24.1 LUFS**, peak −22.4 dBFS.
