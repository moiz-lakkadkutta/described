# 0016 — Ship on glossary titles: a Gate C exception

Status: accepted 2026-10-15 (human decision, recorded as an exception; the Gate C rule text is unchanged)
Ticket: DESC-029 (the five-title re-run) · Follows: 0003 (Gate C), 0009 ("fits"), 0012 (characters and scenes), 0015 (complete
sentences) · Results: [docs/evaluation.md#gate-c-results](../evaluation.md#gate-c-results)

## Context

The Gate C rule ([docs/evaluation.md](../evaluation.md), "The bar" and "The procedure") is: a run passes at **≥ 70 %
majority-usable** with 3 blind raters; each clip is reported on its own; the primary clip `sintel-90-210` is tuned, so "a change
that helps only the tuned clip is not an improvement"; and the five-title re-run from describe (DESC-029) waited for a pass on
**both** clips. The g12 run (main `748e2ef`, after #61 / #62, from describe) scored:

| Run | Clip | Glossary | Raters (usable) | Majority-usable | Bar | Not voiced | Result under the rule |
|---|---|---|---|---|---|---|---|
| `sintel-90-210-g12` | primary (tuned) | yes | 19 / 20 / 22 | **21 / 29 = 72.4 %** | 21 / 29 | 12 shots | pass |
| `tos-390-510-g12` | held out | no | 17 / 18 / 18 | **18 / 31 = 58.1 %** | 22 / 31 | 4 shots | fail |

The two clips differ in more than tuning: Sintel has a people-and-places glossary (decision 0012), the held-out clip has none.

## Decision

On 2026-10-15 the human decided, **as a human exception to the Gate C rule and without changing its text**:

1. **Gate C counts as passed for curated titles with a glossary**, on the evidence of the tuned clip: `sintel-90-210-g12`, 21 / 29
   = 72.4 % majority-usable (raters 19 / 20 / 22), with 12 of its 29 shots not voiced. The gate counts an unvoiced shot like a
   voiced one, so part of this score is shots that say nothing; voiced-usable was 13 / 17.
2. **New titles without a glossary are not yet at the bar.** The held-out `tos-390-510-g12` failed at 18 / 31 = 58.1 % (bar 22 /
   31). That result stands and is not re-rated or re-scored.
3. **Both scores are reported**, wherever Gate C is cited (docs/evaluation.md, docs/submission.md): never the 72.4 % alone.

This is an exception, not a new rule: the 70 % bar, the two-clip procedure and "a change that helps only the tuned clip is not an
improvement" still read as before. A later run that passes the held-out clip makes the exception unnecessary.

## Consequences

- **The five catalogue titles are re-run from describe** (DESC-029's pending paid re-run), with a spend cap of **$0.50** for all
  five. They are curated titles with a glossary in `apps/api/prisma/titles.json`.
- **Quality work stops after this.** No further describe / fit / edit tuning rounds or Gate C re-checks before submission; the
  defects below stay known and documented.
- **A title without a glossary is published only with the caveat disclosed**: its description has not reached the Gate C bar
  (held-out 58.1 %). This covers `pnpm describe` on a new video with no glossary entry. A title with a glossary written by an editor
  under decision 0012 (titles.json, or `apps/api/prisma/glossaries.json` for a title the seeder must not create, such as full-length
  `sintel`) is a curated title.

## Known remaining defects (from the g12 ratings)

- **Dropped articles from describe drafts**: telegraphic drafts on 8 held-out shots ("Boy faces giant robot.", "Man holds
  device."); verify changed only 3 of 31.
- **The edit pass removing articles**: held-out shot 24, "A man climbs a rope in a sunlit industrial ruin." → "Man climbs rope in
  sunlit industrial ruin."
- **"Dark." as a one-word cue** over a lit shaft (held-out shot 22).
- **Faithfulness misses**: details the frames do not show (Sintel shots 3, 6, 10, 16, 21; held-out 5, 20, 21, 24).
- **Other clean problems**: verbless lines (Sintel extended cue 9 and shot 14; held-out shot 9, the place-only "Dim, smoky
  chamber with glowing lines.") and a setting said twice (Sintel shot 0).

## Follow-ups (not quality tuning)

- **Full-film glossary times**: `apps/api/prisma/glossaries.json` reveal times (`revealedAtS`, `firstAtS`) are in full-film
  seconds. A `pnpm describe --start …` run restarts times at 0 (`packages/pipeline/src/own.ts` `clipSeconds` / `cutArgs`), so it
  would reveal names early; such a run needs times offset by its start, or offset handling in the loader (no code change yet).

- **`score.ts` plot-event range parse**: "Shots 7–8" is read as shot 7 only, so g12's shot 8 counted once; read by hand Sintel g12
  lost 6 plot events, not 5. Parse ranges in the plot-events column.
- **Shot-16 skip consistency**: `tos-390-510` shot 16 was same-as-previous (skipped) in g10 / g11 and rated in g12, which moved the
  bar from 21 / 30 to 22 / 31. Make the same-as-previous decision stable across runs of a clip, or report the bar change with the
  score.
