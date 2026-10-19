# Polly extended clips play louder than the narration mixed into the AD track

Task attempted: play extended descriptions (the film pauses, a Polly clip plays, the film resumes) on full-length Sintel on
the Fire TV stick, next to standard descriptions mixed into the audio-description track.
Steps:
  1. Description on; watched Sintel on the stick.
  2. Report: "there are two description voices, one while the video is playing and one when the video pauses."
  3. Checked: both are the same Polly voice; the pause clips are byte-identical (md5) to the synthesized `cue_{i}.mp3`.
     Correlating the raw clips against the published `audio_ad` at cues 10, 12 and 50 gave −7.5 dB for the voice in the track.
Expected: one narrator at one level, whether a cue is mixed into the track or played in a pause.
Actual: the track's narration goes through the mix's 48 kHz stereo `aformat`, `alimiter=limit=0.9` and a linear loudnorm
  gain (Sintel: −18.69 LUFS measured, −5.31 dB applied). The app played Polly's 24 kHz mono MP3 with none of that, 7.5 dB
  louder, over a paused, silent film — so it sounded like a second narrator. Polly returns audio at its own fixed level;
  there is no loudness target to ask for, and its docs give no LUFS figure to plan a mix around.
Severity: Medium — decoding and correlating the published tracks took most of a session; it was the first thing a tester noticed on the full-length film (PR #77).
Workaround: `07-mix` writes `cue_{i}.track.mp3` per cue through the same chain (48 kHz stereo, the mix's limiter, the gain the
  loudnorm apply pass reports); `10-publish` uploads it when it is current. When loudnorm runs `dynamic`, no fixed gain can
  match it, so the Polly clip is used and the mix warns.
Suggestion: a documented output loudness for each Polly engine (neural, generative), or an optional loudness target on
  `SynthesizeSpeech` (for example −23 LUFS / EBU R128), so clips played alone and clips mixed into a track can match.
Environment: macOS, ffmpeg 7, Amazon Polly (Joanna, neural; later Ruth, generative), us-east-1, Fire TV Stick (AFTSS), 2026-10-15.
Links: https://docs.aws.amazon.com/polly/latest/dg/API_SynthesizeSpeech.html ·
  https://docs.aws.amazon.com/polly/latest/dg/generative-voices.html · https://ffmpeg.org/ffmpeg-filters.html#loudnorm · PR #77
