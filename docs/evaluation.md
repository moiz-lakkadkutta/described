# Evaluating audio description quality (Gate C)

How a change to describe, fit, edit or voice is judged, from DESC-030 on. Tooling: `pnpm gate-c` —
[`packages/pipeline/src/eval/README.md`](../packages/pipeline/src/eval/README.md). History: decisions 0003 (Gate C), 0009 ("fits"),
0010 (verify pass), 0011 (shortener).

## The bar

A run passes when **at least 70 % of the shots are majority-usable**: rated usable by more than half of **3 blind raters**.

- A shot is usable when all five rubric criteria pass: faithful, on time, style, clean, fits
  ([rubric template](../packages/pipeline/src/eval/RUBRIC.template.md)). "Fits" is decision 0009's rule, quoted verbatim.
- The denominator is every shot of the clip.
- Three raters, so there is no tie. Runs up to DESC-024 used two raters and counted a shot only when both said usable; those
  scores stay as they are. `pnpm gate-c score` also prints the all-raters-usable count, so the old figure is still visible.

## The procedure

1. **Fix the rules before rating.** The rubric, the 70 % bar and the clips are settled, and committed, before any packet is
   built. A rule clarified after a result (as 0009 was) is recorded as such in its decision, and earlier ratings are not
   re-scored under it.
2. **Run on a copy.** `pnpm gate-c run <source> <eval> --cap 0.30` copies the inputs of an existing work dir (never its describe
   cache, frames or outputs) and runs describe → fit → edit → voice there, under the pipeline meter, with a hard spend cap. It
   never publishes and never writes the DB. `--dry-run` first.
3. **Build blind packets.** `pnpm gate-c packets <eval> <out> --raters 3` gives each rater an identical folder: contact sheets and
   frames per shot, dialogue ±2 s, the gaps, the numbers "fits" needs (limit, clip end, speech end, next dialogue word, next placed
   cue), the voiced text or "Not voiced" with the text it would have voiced. Packets name no model or run.
4. **Rate independently.** Each rater sees only their own folder and does not talk to the others.
5. **Score.** `pnpm gate-c score <out>`: per-rater usable counts, majority-usable (against 70 %), all-raters-usable, agreement,
   and each disagreement with the raters' notes.
6. **Report both clips, separately.** The Gate C clip `sintel-90-210` (29 shots) has been tuned on since 0003, so every
   evaluation also runs the held-out clip `tears-of-steel-40-100` (16 shots) and reports its score on its own line, never pooled
   with the tuned clip. A change that helps only the tuned clip is not an improvement.

Record each result in the decision or ticket it informs: commit, eval slugs, cost (`work/<eval>/gate-c.json`), the score table
for both clips, and the disagreements.
