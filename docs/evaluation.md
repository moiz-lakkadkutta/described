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
   never publishes and never writes the DB. `--dry-run` first.
3. **Build blind packets.** `pnpm gate-c packets <eval> <out> --raters 3` gives each rater an identical folder: contact sheets and
   frames per shot, dialogue ±2 s, the gaps, the numbers "fits" needs (limit, clip end, speech end, next dialogue word, next placed
   cue), the voiced text or "Not voiced" with the text it would have voiced. Packets name no model or run.
4. **Rate independently.** Each rater sees only their own folder and does not talk to the others.
5. **Score.** `pnpm gate-c score <out>`: per-rater usable counts, majority-usable (against 70 %), all-raters-usable, agreement,
   and each disagreement with the raters' notes.
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
