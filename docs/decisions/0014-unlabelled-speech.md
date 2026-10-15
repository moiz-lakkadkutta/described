# 0014 — Gaps are split around speech Transcribe missed (a local voice-activity check)

Status: proposed 2026-10-15 (human approved the targeted fix) — on by default, off with `SPEECH_VAD=0`
Ticket: DESC-032 · Follows: 0003 (Gate C), 0009 ("fits": before the next dialogue word) · Numbered 0014 because open PR #56 uses 0013

## Problem

On the held-out clip (Tears of Steel 6:30–8:30, `tos-390-510`, run `tos-390-510-g10`) Transcribe returned no words for a shouted
"Come on!" (subtitles 8:13, 103 s into the segment) or the yell "RAAAAH" (8:22, 112 s). 03-speech builds gaps from Transcribe's
word timings only, so the whole stretch 41.6–113.85 s was one 72 s gap, and fit placed shot 25's cue at 101853–105174 ms and
shot 28's at 110178–113177 ms, over both. Transcribe is right not to transcribe a yell; the gap is still not free.

## Decision

After Transcribe, 03-speech runs a deterministic check on the mezzanine (`packages/pipeline/src/voiceActivity.ts`, local ffmpeg,
no paid service) and splits each gap around what it finds, with the same 200 ms margin and 1.2 s minimum as around words.

- **Signal.** ffmpeg decodes the stereo mix (every mezzanine is stereo AAC, 01-probe) into **mid** (L+R)/2 and **side** (L−R)/2,
  each band-passed to 300–3400 Hz (two 2-pole high-pass and low-pass stages), at 8 kHz, streamed as f32le and reduced to a level
  per 50 ms frame (about 0.2 MB of levels for a full-length film). There is no centre channel to read: the mezzanine is stereo.
  Film dialogue is mixed to the centre, so it is in mid and cancels in side; music beds and most effects are spread wide.
  ([pan](https://ffmpeg.org/ffmpeg-filters.html#pan), [highpass / lowpass](https://ffmpeg.org/ffmpeg-filters.html#highpass))
- **Voiced frame.** mid ≥ the gap's own **median** mid level + **6 dB** (a loud action scene raises its own bar) **and**
  mid ≥ side + **8 dB** (the sound is centred; mid power ≥ 6.3 × side power).
- **Absolute floor.** A voiced frame is also ≥ the median mid level of Transcribe's word frames − **20 dB** (−60 dBFS when there
  are no words), so a faint sound in a near-silent gap, far over that gap's median, is not speech.
- **Mono.** A mono source upmixed to stereo (L = R after 01-probe's `-ac 2`) has no side, so every loud sound would look centred.
  When the clip's median mid − side is above **30 dB**, the check is skipped with a warning, Transcribe's gaps are kept and
  `gaps.vad.json` records `mono: true`. (The four clips measure 2.0 to 8.6 dB.)
- **Segment.** Voiced frames joined across holes ≤ **50 ms**, kept when ≥ **500 ms** (single impacts, knocks and squeaks stay out).
  These are "unlabelled speech".
- **Output.** `gaps.json` holds the final gaps (fit, describe's word budget, the API's Gap rows read it unchanged).
  `gaps.vad.json` records `source` (`transcribe+vad`, or `transcribe` with a `note` when off or when ffmpeg failed), the options,
  Transcribe's gaps, the unlabelled speech, the final gaps and the gap time lost. A work dir without `gaps.vad.json` predates this
  decision and keeps working (nothing requires it). `regap(work)` (03-speech) rebuilds both files from `words.json` and
  `probe.json` without calling Transcribe; speechMap ends with it.
- **Gate C.** `pnpm gate-c run` calls `regap` on the evaluation copy after copying and before the first step, so an evaluation of
  a source dir made before this decision gets the split; `--keep-gaps` keeps the copied gaps. The manifest (`gate-c.json`)
  records `gapsSource`. `speech` is not an evaluation step. The packets list "Unlabelled speech (not transcribed)" near each shot,
  and each placed cue's "next speech" is the earlier of the next Transcribe word and the next unlabelled segment. Decision 0009 and
  the rubric add: "fits" also means before unlabelled speech; a rater who sees from the frames and timing that a segment is not
  speech rates as if it were not there and says so in the note.
- **Failure.** If ffmpeg cannot read the mezzanine, the step does not fail: the gaps stay Transcribe's, with a warning and the note.
- **Off:** `SPEECH_VAD=0`.

## Evidence

Measured with the code in this PR (absolute floor and mono check included: the numbers did not change; floors −42.3, −63.6,
−47.5 and −64.1 dBFS, centre medians 2.0, 8.6, 5.4 and 8.0 dB) on the four recorded clips (read from the work dirs, nothing modified). "Cues over it" counts
the placed (not extended) cues of each clip's latest run that overlap a detected segment, i.e. the cues that move or go.

| Clip | Unlabelled speech found | Gap time, Transcribe → after | Lost | Placed cues over it |
|---|---|---|---|---|
| `tos-390-510` (held out) | 4 segments, 3.0 s: 43.60–44.10, 46.05–47.25, **102.90–103.40**, **112.75–113.60** | 103.3 s → 98.6 s | 4.7 s, **4.5 %** | 4 / 20 (g10 shots 10, 11, **25**, **28**) |
| `sintel-90-150-r2` | none | 32.8 s → 32.8 s | **0 %** | 0 / 9 |
| `tears-of-steel-40-100` | none | 48.7 s → 48.7 s | **0 %** | 0 / 10 |
| `sintel-90-210` (Gate C primary) | 8 segments, 6.0 s: 69.20–69.90, 70.00–70.90, 92.15–92.65, 92.75–93.35, 93.45–94.50, 98.50–99.00, 105.45–106.15, 115.10–116.10 | 84.2 s → 76.1 s | 8.1 s, **9.6 %** | 4 / 18 (g10 shots 15, 18, 20, 25) |

**Both misses are caught**: the "Come on!" segment 102.90–103.40 s lies inside shot 25's old cue and the yell 112.75–113.60 s
inside shot 28's, so neither cue fits its old place any more (fit has to find another slot, or the shot becomes extended / an event /
no cue, as for any shot without room). ffmpeg takes 0.2–0.4 s per 1–2 min clip.

**What the other segments are** (read from spectrograms, `showspectrumpic`, not by ear):

- `tos-390-510` 43.6–47.25 s: harmonic, pitch-varying bands over the battle noise, most likely more shouting the subtitles do not
  carry — probably correct.
- `sintel-90-210` 69.2–70.9 s: broadband impacts (a fall, hits), **not speech**. 92.15–94.5 and 98.5–99.0 s: the baby dragon's
  squeaks (steady harmonics with glides) — a creature's voice, not dialogue. 105.45–106.15 s: a noise burst at 2–3 kHz, an effect.
  115.1–116.1 s: a whistle-like tone right before Transcribe's "Hey, shh shh" (116.5 s) — Sintel calling or the dragon.

So the check is a detector of **centred, loud voice-band sound**, not of words: it also takes centred creature sounds and some
impacts. On these clips that costs 0–9.6 % of gap time.

**Sensitivity.** Grid over the four parameters (loss tos-390-510 / sintel-90-150-r2 / tears-of-steel-40-100 / sintel-90-210):

| centre dB | above median dB | bridge ms | min ms | both misses caught | gap time lost |
|---|---|---|---|---|---|
| 6 | 3 | 150 | 300 | yes | 18 / 32 / 7 / 40 % |
| 8 | 3 | 150 | 300 | yes | 12 / 22 / 2 / 32 % |
| 8 | 6 | 150 | 300 | yes | 8 / 12 / 0 / 27 % |
| 8 | 4.5 | 50 | 500 | yes | 7 / 0 / 0 / 14 % |
| **8** | **6** | **50** | **500** | **yes** | **5 / 0 / 0 / 10 %** |
| 8 | 7.5 | 50 | 500 | **no** (neither) | 1 / 0 / 0 / 6 % |
| 10 | 6 | 50 | 500 | 112 s only | 2 / 0 / 0 / 9 % |

The chosen point is the least gap time lost among the settings that catch both. Its margin is thin upward: at 7.5 dB above the
median both misses are lost, because in that scene the shouts stand only 6–7.5 dB over the battle around them. Lower bars (or a 150 ms bridge
that joins impacts into "speech") eat a quarter to a third of Sintel's gaps.

**Tried and not used.** Spectral flatness and pitch periodicity (autocorrelation 80–400 Hz) per segment: the shout "Come on!" under
gunfire measured flatness 0.36 and periodicity 0.26, worse than Sintel's music (0.01, 0.85) — shouted speech in noise does not
look voiced, and centred music does. Averaging levels over 3 or 5 frames lost the "Come on!" segment and kept more of Sintel.

**Held-out caveat.** The thresholds were chosen with the held-out clip's two misses in view, so for this check `tos-390-510` is
no longer held out; report it as such. The other three clips had no known misses: their numbers are the cost side only.

## Consequences

- Existing work dirs keep their old `gaps.json`; nothing rewrites them. The next Gate C runs (`tos-390-510`, `sintel-90-210`)
  get the new gaps on their copies through `pnpm gate-c run` (no Transcribe, no extra cost); 4 placed cues on each clip move or
  go. Do **not** use `pnpm pipeline describe --from speech` for this: it runs every later step and publishes.
- 06-voice's limit is the gap end, so "fits" (0009) now also means before unlabelled speech, and the packets show it.
- No AWS call is added; the check is not metered (it is local ffmpeg).
- If the false positives cost too many cues on a full-length film, the next step is a real speech / music / effects classifier,
  not a lower threshold.
