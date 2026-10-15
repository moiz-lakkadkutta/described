# Evaluating audio description quality (Gate C)

How a change to describe, fit, edit or voice is judged, from DESC-030 on. Tooling: `pnpm gate-c` —
[`packages/pipeline/src/eval/README.md`](../packages/pipeline/src/eval/README.md). History: decisions 0003 (Gate C), 0009 ("fits"),
0010 (verify pass), 0011 (shortener).

## The bar

A run passes when **at least 70 % of the shots are majority-usable**: rated usable by more than half of **3 blind raters**.

- A shot is usable when all five rubric criteria pass: faithful, on time, style, clean, fits
  ([rubric template](../packages/pipeline/src/eval/RUBRIC.template.md)). "Fits" is decision 0009's rule, quoted verbatim.
- The denominator is every shot of the clip except the same-as-previous shots (decision 0003: usable / (shots −
  same-as-previous)). `gate-c packets` finds them — describe marked the shot same-as-previous **and** nothing is voiced or placed
  for it — labels them "Same as previous shot — not rated", pre-fills their rows "skip" and records them in `packet.json` as
  `skipShots`. This matches DESC-017's rule (decision 0003): a continuation that has text is rated against its frames like any
  other shot; a same-as-previous shot with no cue has nothing to rate. A rater may override a skip by rating the shot; it is
  counted only when most raters rate it, and `score` warns either way.
- Only `skipShots` leave the denominator. A "skip" on any other shot counts as not usable and is warned about (`score` exits
  1), even when every rater wrote it. An empty description that describe did **not** mark same-as-previous is a pipeline
  failure: it is labelled "Not voiced: empty description" and rated (usable: no).
- Three raters, so there is no tie. A row marked usable with a failed criterion is sent back to its rater (`score` counts it
  unrated).
- Runs up to DESC-024 used two raters and counted a shot only when both said usable; those
  scores stay as they are. `pnpm gate-c score` also prints the all-raters-usable count, so the old figure is still visible.

## The procedure

1. **Fix the rules before rating.** The rubric, the 70 % bar and the clips are settled, and committed, before any packet is
   built. A rule clarified after a result (as 0009 was) is recorded as such in its decision, and earlier ratings are not
   re-scored under it.
2. **Run on a copy.** `pnpm gate-c run <source> <eval> --cap 0.30` copies the inputs of an existing work dir (never its describe
   cache, frames or outputs) and runs describe → scenes → fit → edit → voice there, under the pipeline meter, with a hard spend cap. It
   never publishes and never writes the DB. Before the first step it rebuilds the copy's gaps with the voice-activity split
   (decision 0014; no Transcribe; `--keep-gaps` to keep the copied ones). `--dry-run` first.
3. **Build blind packets.** `pnpm gate-c packets <eval> <out> --raters 3` gives each rater an identical folder: contact sheets and
   frames per shot, dialogue ±2 s, the gaps, the numbers "fits" needs (limit, clip end, speech end, next dialogue word, next placed
   cue), the voiced text or "Not voiced" with the text it would have voiced. Packets name no model or run.
   **Each voiced cue also shows the cue heard just before it** (context only): the narrative pass (decision 0017) carries
   referents, so "She kneels beside the bleeding dragon." is judged knowing who "she" is, against this shot's frames.
   **Text to rate for an unvoiced shot = fit's grounded description** (`groundedDescription` in 05-fit, the function fit reads every
   description through; the packet calls it, there is no separate cleanup): what the pipeline would voice if the shot got a slot —
   "Darkness." whole or absent, no bare light-word lead ("Dim."), no place carried from another scene. A shot fit placed but voice
   dropped shows fit's text, as before. Decision 0012 amendment (2026-10-15). The `sintel-90-210-g10` and `tos-390-510-g10` ratings
   used the raw described.json text for unvoiced shots (g10 shot 28 "… inside the tent"), so they are not strictly comparable with
   later runs.
4. **Rate independently.** Each rater sees only their own folder and does not talk to the others.
5. **Score.** `pnpm gate-c score <out>`: per-rater usable counts, majority-usable (against 70 %), all-raters-usable, agreement,
   and each disagreement with the raters' notes. Also, **informational only** (the pass rule is unchanged): voiced-usable / voiced
   (packet.json `voicedShots`, the shots with a voiced cue; for an older packet, shots a majority did not mark "On time: n/a"), the shots not voiced, and the plot events lost (shots a majority listed under
   "Plot events lost") — the gate counts an unvoiced shot like a voiced one, so a run that voices less can score higher. Printed for
   the corrected result too when there are corrections.
6. **Report each clip separately, never pooled.**
   - **Primary: `sintel-90-210`** (Sintel 1:30–3:30, 29 shots). The Gate C clip since 0003; every change since has been checked on
     it, so it is **tuned** and is reported as such.
   - **Held-out: `tos-390-510`** (Tears of Steel 6:30–8:30), a stretch nothing in the repo has looked at. It is made once with
     `pnpm gate-c prepare` (cut + probe/shots/speech, ≈ $0.05) and then evaluated like the primary clip. A change that helps only
     the tuned clip is not an improvement.
   - `tears-of-steel-40-100` is **less tuned, not held out** (it shaped decision 0008 and is pinned in tests); report it only as
     an extra, labelled line.

   At 16–30 shots one shot is 3–6 points, so a single clip's score is a coarse check: a 1-shot difference between runs is noise,
   and the disagreements say more than the percentage.

Record each result in the decision or ticket it informs: commit, eval slugs, cost (`work/<eval>/gate-c.json`), the score table
for both clips, and the disagreements.

## Known limits

- **Dialogue Transcribe missed is not in the packet.** The packet shows dialogue and the dialogue-free gaps from Transcribe's
  words. A shout or a short line that Transcribe did not return is in neither, so a placed cue can talk over it and the raters
  cannot see it: "on time" and "fits" pass on the numbers. In `tos-390-510` (Tears of Steel 6:30–8:30), "Come on!" at 103 s lies
  under shot 25's cue (101853–105501 ms), and the yell at 112 s under shot 28's (110178–113274 ms); `words.json` has nothing
  between 41.2 s and 114.0 s, so both sit in one 72 s "gap". Listening to the mix is the only check.
- **Recording a correction.** The scorer does not edit a rater's `scores.md`. A correction goes in `corrections.md` next to
  `packet.json`, one row per shot and criterion, with a reason:

  ```md
  | Shot | Criterion | Verdict | Reason |
  |---|---|---|---|
  | 25 | on time | fail | talks over "Come on!" at 103 s (missed by Transcribe) |
  | 28 | on time | fail | talks over the yell at 112 s (missed by Transcribe) |
  ```

  Criterion is faithful, on time, style, clean or fits. Corrections are **fail-only**: the verdict is fail or blank, and "pass"
  is refused, so a correction can lower the score but never raise it. It applies to every rater. `pnpm gate-c score <out>` then
  prints the as-rated result, the corrections, and the corrected result, whose gate line starts "CORRECTED (not the blind
  result)". Report both; the as-rated figure is the blind one, and it alone sets the exit code.

## Gate C results

Combined re-check for DESC-029 (decisions [0009](decisions/0009-gate-c-fits.md), [0012](decisions/0012-characters-and-scenes.md))
with DESC-027 / 031 / 032 ([0010](decisions/0010-verify-pass.md), [0013](decisions/0013-legible-text.md),
[0014](decisions/0014-unlabelled-speech.md)). 3 blind raters, majority-usable, bar 70 %. Each clip is reported on its own.
Voiced-usable, not voiced and plot events lost are informational; they do not change the pass rule.

| Run (date, code) | Clip | Rated | Raters | Majority-usable | Voiced-usable | Not voiced | Plot events lost | Cost | Result |
|---|---|---|---|---|---|---|---|---|---|
| `sintel-90-210-g10` (2026-10-15, main after #54; describe → voice, glossary) | primary (tuned) | 29 | 16 / 15 / 11 | **14 / 29 = 48.3 %** (bar 21) | 10 / 22 | 7 | 3 (shots 3, 11, 28) | $0.098 | FAIL |
| `tos-390-510-g10` (2026-10-15, same code; no glossary) | held out | 30 (shot 16 skipped, 0003) | 21 / 20 / 20 | **20 / 30 = 66.7 %** (bar 21) | 17 / 26 | 4 | 2 (shots 26, 30) | $0.100 | FAIL |
| `sintel-90-210-g11` (2026-10-15, after #55 / #56 / #57 / #59; from describe, voice-activity regap on) | primary (tuned) | 29 | 20 / 18 / 21 | **19 / 29 = 65.5 %** (bar 21) | 14 / 20 | 9 | 5 (shots 7, 8, 11, 27, 28) | $0.098 | FAIL |
| `tos-390-510-g11` (2026-10-15, same code; no glossary) | held out | 30 (shot 16 skipped) | 19 / 20 / 20 | **20 / 30 = 66.7 %** (bar 21) | 16 / 24 | 6 | 2 (shots 26, 27) | $0.101 | FAIL |
| `sintel-90-210-g12` (2026-10-15, main `748e2ef` after #61 / #62; from describe, glossary) | primary (tuned) | 29 | 19 / 20 / 22 | **21 / 29 = 72.4 %** (bar 21; all raters 16) | 13 / 17 | 12 | 5 (shots 7, 11, 14, 27, 28) | $0.099 | PASS |
| `tos-390-510-g12` (2026-10-15, same code; no glossary) | held out | 31 (none skipped) | 17 / 18 / 18 | **18 / 31 = 58.1 %** (bar 22; all raters 16) | 17 / 27 | 4 | 3 (shots 23, 26, 30) | $0.103 | FAIL |
| `sintel-90-210-g13` (2026-10-15, main `0bed29c` after #80: narrative pass on DeepSeek v3.2, Ruth generative; fit → edit → voice on the clip's existing describe output, glossary) | primary (tuned) | 29 | 24 / 22 / 23 | **24 / 29 = 82.8 %** (bar 21; all raters 20) | 11 / 15 | 14 | 10 (shots 3, 5, 7, 8, 11, 14, 24, 26, 27, 28) | $0.028 | PASS |
| `tos-390-510-g13` (2026-10-15, same code; fit → edit → voice on the clip's existing describe output; no glossary) | held out | 31 (none skipped) | 26 / 23 / 25 | **24 / 31 = 77.4 %** (bar 22; all raters 23) | 20 / 26 | 5 | 1 (shot 7) | $0.048 | PASS |

**g10 and g11 are not strictly comparable.** The g10 packets rated an unvoiced shot on its raw described.json text (g10 shot 28
"… inside the tent"); from g11 on, the text to rate is fit's grounded description (step 3 above; 0012 amendment of 2026-10-15).

**`sintel-90-210-g10`** — main causes (all fixed in #59, 0012 amendment of 2026-10-15):

- place-only fragments: "In the tent." voiced for shots 4, 5, 7, 8 and a "The tent." pause on shot 10; "Dim." lead (shot 2);
- "Darkness." over a lit shot (14, a sunlit walled town);
- late extended cues (19: 1575 ms, 24: 1025 ms after the shot ends; limit 1 s);
- a place from another scene (28, "inside the tent" for a stone den);
- an apostrophe tokeniser bug in the guards ("drops a fact: s", which rejected an edit);
- also faithful fails on shots 3, 16 and 21, and a telegraphic "Man speaks softly." (12) and a verbless "The woman with red
  hair." (27).

**`tos-390-510-g10`** — mostly describer faithfulness: 7 shots (5, 7, 10, 14, 20, 21, 26: wrong verb, object, colour or age).
Also a misquoted on-screen text (4, → 0013), a "Towering." lead (11) and one late extended cue (13, 1397 ms). **18 / 30** if the
dialogue Transcribe missed is counted: shot 25's cue talks over "Come on!" at 103 s and shot 28's over the yell at 112 s (see
Known limits; both shots were majority-usable as rated, and 0014 now splits those gaps).

**`sintel-90-210-g11`** — the place-only, darkness, late-pause and cross-scene failures are gone; no on-time fail. Left:

- clean (6): telegraphic grammar with dropped articles ("Man holds staff.", "Small tan dragon bleeds on rooftop."),
  lower-case starts with no full stop (10, 19, 27) and "Man speaks, tent." (12);
- faithful (4): an invented detail (3, 7 "steaming"), a "sleeve" that is a sack or lid (16), the fruit's colour (17);
- fewer shots voiced (20 of 29, was 22): 9 not voiced, and the raters listed 5 plot events lost — the ladle pour and bowl hand-over
  (7, 8), the face in the bowl (11), the dragon roaring (27) and the woman cradling the dragon (28).

**`tos-390-510-g11`** — no on-time fail; the late cue is fixed and the "Towering." lead gone. Left:

- faithful (5): the describer's errors on 14, 20, 21, 26 as in g10, and shot 4's text still quoted as legible ("CULP") although a
  word is hidden;
- clean (5): verbless setting-only fragments ("Dim, smoky chamber with glowing lines.", "Ornate clock tower with golden dials,
  debris flying.", "Dark, rope-laced industrial shaft.") on 9, 13, 22, a verbless shot 2, and doubled text on 29 ("In the
  Cluttered tech lab … in a cluttered tech lab");
- 2 plot events lost: the man on the rope firing as a robot smashes the organ pillars (26), the robot's crash (27).

Neither clip passes in g10 or g11.

**`sintel-90-210-g12`** (after DESC-033, decision [0015](decisions/0015-complete-sentences.md), and DESC-029 round 3) passes at
the bar exactly: 21 of 29, with no on-time fail. The pass comes with fewer shots voiced: 17 of 29 (20 in g11), so 12 are not
voiced (3, 5, 6, 7, 8, 10, 11, 14, 23, 26, 27, 28) against 9 in g11. The gate counts an unvoiced shot like a voiced one (step 5),
so part of the gain is shots that say nothing. Voiced-usable is 13 / 17. Plot events lost (listed by a majority): the ladle pour
(7), the face in the bowl (11), the cut to the sunlit town (14), the smile and the roar (27), the woman cradling the dragon (28).
Rater 2 listed "Shots 7–8" and rater 3 "Shot 5/7/8"; `score` reads the dash as shot 7 only, so shot 8 counts once; read by hand
it is listed twice, which would make 6. Left (8 shots):

- clean: extended cue 9 ends on a verbless sentence, "An old man with a grey beard, in red-brown robes." (the shortener cut
  his action); shot 0 says its setting twice ("In the snowy mountains, … a white mountainside deep in snow"); shot 14 is a
  verbless line ("The town, sunlit, dense with rooftops, …");
- faithful: details the frames do not show on 3 (face paint, grey beard), 6 and 10 ("blinks slowly"), 16 (a dark cloth, not a
  "sleeve") and 21 ("stands in the town" for a woman crouched on a rooftop; two raters also failed it as setting-only filler).

**`tos-390-510-g12`** is worse than g11: 18 of 31 against 20 of 30 (shot 16 is no longer same-as-previous, so it is rated and
the bar is 22). More shots are voiced (27 of 31, 24 in g11). Plot events lost: the man on the rope firing as a robot crashes
through the organ columns (26), the man on the tower readying a device (23, minor), the argument at the end (30). Left (13
shots):

- clean, dropped articles from describe drafts (8 shots: 3, 5, 7, 10, 11, 13, 23, 30, e.g. "Boy faces giant robot.", "Man
  holds device."): the drafts are telegraphic and verify changed only 3 of 31 (shots 2, 19, 29);
- clean, the edit pass removed articles: shot 24 "A man climbs a rope in a sunlit industrial ruin." → "Man climbs rope in
  sunlit industrial ruin.";
- "Dark." as a one-word cue over a lit shaft (22: faithful and clean);
- a verbless setting-only line, "Dim, smoky chamber with glowing lines." (9, not voiced);
- faithful: the hand at his cheek, not the eyepiece (5), robots that charge rather than clash, with no crumbling pillars (20),
  not all four figures in white (21), and on 24 (one rater) a drop into a dark shaft rather than a climb.

**`sintel-90-210-g13`** and **`tos-390-510-g13`** (decision [0017](decisions/0017-narrative-pass.md): the 05b narrative pass on
DeepSeek v3.2 and the Ruth generative voice; `pnpm gate-c run … --steps fit,edit,voice` on copies of each clip's existing
`described.json`, with no describe call, so only placement, the narrative pass and the voice changed). **Both clips pass**, with the official
scorer (`pnpm gate-c score`, no corrections file):

| Clip | rater 1 | rater 2 | rater 3 | Majority-usable | All raters usable | Raters agree | g12 |
|---|---|---|---|---|---|---|---|
| `sintel-90-210-g13` | 24 / 29 (82.8 %) | 22 / 29 (75.9 %) | 23 / 29 (79.3 %) | **24 / 29 = 82.8 %** | 20 / 29 = 69.0 % | 24 / 29 | 21 / 29 |
| `tos-390-510-g13` | 26 / 31 (83.9 %) | 23 / 31 (74.2 %) | 25 / 31 (80.6 %) | **24 / 31 = 77.4 %** | 23 / 31 = 74.2 % | 27 / 31 | 18 / 31 |

This is the first run in which the held-out clip passes. Rater outputs: `~/gate-c/g13/rater{1,2,3}/scores.md` and
`~/gate-c/g13-heldout/rater{1,2,3}/scores.md`; run dirs `~/gate-c/work-g13/` (commit `0bed29c`, clean tree).

The Sintel pass still comes with few shots voiced: 15 of 29 (17 in g12), so 14 are not voiced, and a majority listed 10 plot
events lost (`score` count; 5 in g12). Voiced-usable is 11 / 15. The held-out clip voices 26 of 31 and loses 1 plot event (7).

Disagreements (majority verdict first):

- Sintel: 4 usable (rater 2: a curved blade, not a staff), 7 usable (rater 3: "steaming" invented), 14 usable (rater 2: verbless
  "The town, sunlit, …"), 16 not usable (raters 1 and 2: a dark cloth or awning, not a "sleeve"), 17 usable (rater 3: the fruit is
  grey-brown, not green).
- Held out: 7 not usable (raters 1 and 2: the young man is called "a boy"), 14 usable (rater 2: no hand lifts the lid), 21 not
  usable (raters 2 and 3: not all four kneeling figures wear white), 24 not usable (raters 2 and 3: he grabs the rope to go down,
  he does not climb, and it is not a sunlit ruin).

Failed by all three raters: Sintel 3, 9, 15, 21; held out 5, 6, 11, 20. Recurring failure kinds:

- **Details borrowed from adjacent shots** (describe): Sintel 3 gives the old man a grey beard and red face paint that only shot 4
  shows (his face is in shadow); held-out 24's "sunlit industrial ruin" and climb, 21's four white suits, 20's clash and crumbling
  pillars, 5's "adjusts eyepiece" (he rubs his cheek below it).
- **Verbless or article-less fragments**: Sintel 9, extended cue ending "An old man with a grey beard, in red-brown robes." (fit's
  shortening cut his action); Sintel 15, "Woman lifts a wooden plank." (no article, and it passed the sentence guard); held-out 5,
  "Man adjusts eyepiece."; Sintel 14 (one rater) "The town, sunlit, …".
- **A label leak**: held-out 11 opens "Ruin:", which all three raters read as a leaked location label, not narration.
- **Wrong referent**: held-out 6 says "the man" right after "Man adjusts eyepiece.", so it points at the eyepiece man; the shot
  shows the red-haired woman touching the young dark-haired man's face. This is the narrative pass's kind-noun / one-candidate
  risk named in 0017 Consequences.
- Faithfulness carried from g12: Sintel 16 ("sleeve"), 21 ("stands in the town" for a woman crouched on a rooftop).

**After g12, under the rule, Gate C was not passed.** A run passes at ≥ 70 % majority-usable (The bar); each clip is reported on its own (step 6); the
primary clip is tuned, and "a change that helps only the tuned clip is not an improvement"; the five-title re-run from describe
(DESC-029) is on hold until Gate C passes on **both** clips. g12 passes on the tuned clip only, so the re-run stays on hold.

**g13 passes both clips (2026-10-15)**: `sintel-90-210-g13` 24 / 29 = 82.8 % and the held-out `tos-390-510-g13` 24 / 31 =
77.4 %. The rule is met as written, so the 0016 exception below is superseded ([decision 0017](decisions/0017-narrative-pass.md),
"Gate C after the narrative pass"). The paragraphs above it record g12 as it stood.

**Exception for glossary titles ([decision 0016](decisions/0016-ship-on-glossary-titles.md), human, 2026-10-15).** The rule
above is unchanged. As a human exception, Gate C counts as passed for **curated titles with a glossary**, on the tuned clip
(`sintel-90-210-g12`, 21 / 29 = 72.4 %, raters 19 / 20 / 22, 12 shots not voiced). **Titles without a glossary are not yet at
the bar** (held-out `tos-390-510-g12`, 18 / 31 = 58.1 %, bar 22 / 31). Both scores are reported together. Consequences: the
five catalogue titles are re-run from describe (cap $0.50); quality work stops after this; a title without a glossary is
published only with that caveat disclosed.
