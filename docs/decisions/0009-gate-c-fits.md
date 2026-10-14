# 0009 — Gate C "fits": speech end, not file end; darkness example removed; fit's clip overhead

Status: accepted 2026-10-14 (human: "Fix, re-run, re-rate") — Gate C re-check DESC-024, round 2
Ticket: DESC-024 · Follows: 0003 (Gate C), 0008 (text and darkness)

## Evidence (`sintel-90-210-g8`, decision-0008 prompt, edit pass on)

The Gate C re-check with the 0008 prompt scored **20 / 29 = 69.0 %** (both raters must call a shot usable; the gate is ≥ 70 %).
Three causes were found after the result:

1. **Shots 4 and 13 failed only "fits"**: the clip file ended 100 ms and 120 ms past the limit. The extra is the silence Polly
   leaves at the end of a clip. 06-voice allows it on purpose (`OVERRUN_TOLERANCE_MS` = 200); the limit is already 200 ms before
   the next dialogue word (03-speech, `gapsFromWords` margin); the speech itself ended by the limit (shot 13) or 7 ms after it
   (shot 4), and neither clip overlapped dialogue.
2. **The darkness rule's example was copied.** The 0008 prompt said `say dim (e.g. "A dim room. A fire glows.")`; shot 2 was
   described with that sentence, word for word, and "dim" appeared in shots 6, 9 and 13, which made them longer.
3. **fit's clip estimate is too short for short lines.** 05-fit estimated a clip as words ÷ 2.67 words/s + 300 ms. Measured
   3-word clips run 1512–1800 ms (150 ms SSML lead-in break, ~150 ms silence before Polly's first word, ~100–150 ms after the last),
   so fit placed short cues in slots they could not fit and 06-voice then dropped them (shots 3 and 9).

## Decisions

1. **"Fits" (rubric criterion 5) is clarified.** A **placed** cue fits when
   - its **speech** ends by its limit — the speech end is the clip with its trailing silence trimmed, measured with
     `ffmpeg -af silencedetect=noise=-45dB:d=0.05` (the start of the last silence that runs to the end of the clip), added to
     the cue's start; and
   - the clip **file** ends by limit + `OVERRUN_TOLERANCE_MS` (200 ms), and before the next dialogue word starts.

   The limit is the one 06-voice uses: the end of the cue's gap, or the next placed cue's start − 150 ms when that is earlier.
   An **extended** cue fits when it is at most 25 words.

   This was decided **after** the 69 % result, and the record says so. The earlier wording in 0003 (DESC-017: "the measured clip
   still ends within its limit") was written for where 06-voice puts a split action cue, not as the rating rule; the raters of
   run A2 (75.9 %) passed clips that ended 4 ms and 6 ms past their limits. Trailing silence is not heard over dialogue, and the
   pipeline already accepts it, so a rule that fails it measures the file, not what a viewer hears. The packets for the re-rating
   show, for every placed cue: the limit, the clip end, the speech end, and the time of the next dialogue word.
   There is no silence threshold in the pipeline itself; −45 dB is the level the 69 % diagnosis measured with (shot 4's speech
   end, 7 ms past its limit). Under this rule shot 4 of g8 would still fail "fits" by those 7 ms.
2. **Darkness rule without a quotable example** (`packages/pipeline/src/prompts.ts`): `Write only "Darkness." when the frames are
   black and nothing can be made out. If anything is visible, even dimly, describe it and do not write "Darkness."; if the scene
   is visible but dim, say dim.` No example sentence: the model copies examples.
3. **fit's estimate carries the measured overhead** (`packages/pipeline/src/steps/05-fit.ts`): a clip is estimated as
   words ÷ `WPS` + `CLIP_OVERHEAD_MS` (450 ms: `LEAD_BREAK_MS` 150 + `LEAD_SILENCE_MS` 150 + `TAIL_SILENCE_MS` 150), and a gap
   slot holds only the words whose estimate fits the room left (room − 450 ms at 2.67 words/s), so a 3-word cue needs about
   1.6 s. A shot with no such room is handled as before: another gap in its window, an extended cue when it introduces
   something new, an event cue (0007), or no cue.

## Consequences

- Gate C is re-run (`sintel-90-210-g9`: describe → fit → edit → voice on the g8 inputs, the same 29 shots) and re-rated by two
  independent raters with this rubric. The g8 ratings stay as they are; they are not re-scored under the new rule.
- Short gaps (< ~1.6 s of room) no longer take a 3-word placed cue; such a shot becomes an extended or event cue, or none.
