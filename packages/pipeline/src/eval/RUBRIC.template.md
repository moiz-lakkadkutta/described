# Gate C rubric — audio description, {{SHOTS}} shots

You are one of {{RATERS}} independent raters. Do not look for, or talk to, the other raters, and do not look at any other rater's
folder. Rate every shot against its frames (`sheets/shot_NN.jpg`, five frames in time order; zoom into `frames/shot_NN_k.jpg` for
details such as colour, hands, eyes, direction). Write your ratings in `scores.md`: pass / fail per criterion (n/a where this
rubric says so), yes / no for usable, and a short note for every fail.

Audio description is spoken for blind and low-vision viewers in the pauses between dialogue. A cue is either **placed** (spoken
in a dialogue-free gap while the film plays) or **extended** (the film pauses while it is spoken).

## The five criteria — a shot is **usable** only when all five pass

1. **Faithful** — everything the text says is visible in this shot's frames: people, objects, actions, colours, direction,
   on-screen text. Invented people, objects, events or text, wrong colours, wrong direction, or a wrong verb (e.g. "stands" for
   someone who walks or crouches) fail. Leaving things out is not a faithfulness fail; describing the next or previous shot is.
   On-screen text must be quoted only when it is clearly legible in the frames. "Darkness." is right only when nothing can be made
   out; a visible scene called darkness, or a black frame described as a scene, fails.
2. **On time** — a placed cue starts within its shot or no later than 1 s after the shot ends, and its audio does not overlap
   dialogue (it lies inside a dialogue-free gap). An extended cue may overlap dialogue (the film is paused) but must still start
   within its shot or ≤ 1 s after.
3. **Style** — present tense, active, objective; no emotion or motivation words ("sad", "angry", "lovingly"), no interpretation,
   no film language ("the camera pans", "we see"); no character names before the dialogue has said them — a stable visible
   descriptor instead ("the red-haired woman").
4. **Clean** — nothing but description: no leaked labels or instructions ("SAME", "Nothing new", word counts, quotes around the
   whole line, preambles), no broken grammar or fragment starting mid-sentence, no doubled text.
5. **Fits** — the rule of decision 0009 (docs/decisions/0009-gate-c-fits.md), quoted:

   A **placed** cue fits when
   - its **speech** ends by its limit — the speech end is the clip with its trailing silence trimmed, measured with
     `ffmpeg -af silencedetect=noise=-45dB:d=0.05` (the start of the last silence that runs to the end of the clip), added to
     the cue's start; and
   - the clip **file** ends by limit + `OVERRUN_TOLERANCE_MS` (200 ms), before the next dialogue word starts, and before the next
     placed cue starts.

   The limit is the one 06-voice uses: the end of the cue's gap, or the next placed cue's start − 150 ms when that is earlier.
   An **extended** cue fits when it is at most 25 words.

   For every placed cue, `shots.md` gives the limit, the clip end, the speech end, the time of the next dialogue word and the
   start of the next placed cue (all in ms from the start of the segment); rate "fits" from those numbers.

## Special cases

- **Not voiced**: rate the text it would have voiced on faithful, style and clean; on time and fits are n/a (count as pass).
  If the shot carries a plot event the viewer now misses, list it at the end of `scores.md` — it does not make the shot unusable.
- **Same as previous / continuation**: a later part of one camera shot may say only what is new. Rate it against its own
  frames like any other shot.
- Rate the **voiced** text. The model description is context only (it shows what was shortened).

## Score

Usable = shots where all five criteria pass. Fill the Usable column (yes / no) for every shot and report `usable / {{SHOTS}}` and
the list of usable shot numbers at the end of `scores.md`.
