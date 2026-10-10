# 0006 — Scene-level edit pass between fit and voice

Status: proposed 2026-10-10 — the orchestrator/human accept after the evaluation rerun (`DESCRIBE_EDIT=0` gives the control run)
Ticket: DESC-018 · Follows: 0003 (Gate C, faithfulness must not drop), 0005 (direct Converse calls, cost rule)

## Problem

Every shot is described and placed on its own. The viewer hears the voiced cues in a row with the dropped shots missing
(sintel-90-150-r2, on device): shot 5 "Red-haired girl watches man stir pot over fire." was dropped by fit (no room in the
dialogue), so the viewer hears "Dark room. Fire burns." … "Old man pours broth." with the link missing. Nothing knew what the
viewer had already heard.

## Decision

A text-only `edit` step (`packages/pipeline/src/steps/05b-edit.ts`) runs after `fit` and before `voice` — in `STEPS` and in the
worker's finish job — and may change the **text** of voiced cues only. One Nova Lite Converse call per window of ≤ 30 cues
(`EDIT_CHUNK_CUES`), a forced `emit_edits` tool, temperature 0, Zod on the reply. `DESCRIBE_EDIT=0` skips the call.
`EDIT_MODEL_ID` overrides the model. Cost is metered like every other step; `work/{slug}/edit.json` records what was applied,
what was rejected and why, for the evaluation.

**What the model sees** (`editRequest` in `prompts.ts`): the cues in order as the viewer hears them, each with its word count,
how many words may be added, and — under `missedJustBefore` — the descriptions of the shots dropped between the previous cue and
this one; plus the dialogue turns. Two things it does *not* see, both from the probes: the full description of a voiced shot
(shown next to its shortened cue, both models "restored" it — round 2), and dropped shots as a flat timeline (Nova folded the
shot *after* a cue into it — round 4). The nesting leaves "fold into the next cue" only one reading.

**Word budget** (`editBudgets`): a placed cue may grow to ⌊room × 2.2 words/s⌋, room = min(gap end, next placed cue − 150 ms) −
start, never below its own length; an extended cue keeps 25. fit budgets at 2.67 words/s, but Polly Joanna on r2 ran at 2.13
words/s net of the 150 ms lead-in and the r2 cue "Bearded man holds staff." ended 100 ms short of voice's drop threshold: a cue
lengthened to fit's budget would often be shortened or dropped by 06-voice, which is worse than leaving it alone.

**Guards** (`applyEdits`, deterministic, each rejection logged and the original kept):
1. the index names a cue in this window, once; one non-empty line; the text is not over the cue's budget;
2. a `Words appear: …` clause of the original is in the edit verbatim, and an edit adds none;
3. **faithful**: every content word (lower-cased, punctuation stripped, stop-words removed, inflections via a simple stem —
   stir ~ stirs ~ stirring) is in the descriptions of the shots between the previous voiced cue and this cue's shot, or in this
   or the previous cue's text. Not later shots (never before the action), not earlier ones (a dropped fact goes into the *next*
   cue only — Nova folded shot 11's "veiled face", the description Gate C flagged, into the cue of shot 14; round 7);
4. **keeps facts**: no content word of the original is lost unless the previous cue already said it (that is the repetition the
   pass removes) or it is a size/age/texture adjective or manner adverb (what fit's shortener drops first). Nova dropped
   "Logo fades." as if it were repetition in 2 of 3 replies (round 4).

An edit over budget gets one shortening call (`shortenEditWithNovaLite`: "at most N words, must still state «original cue»") and
the result passes the same guards; the model appends a dropped description whole rather than compressing it (17 words into an
11-word room, round 5), and fit's generic shortener kept the wrong half (dropped "pours broth", round 6).
A forced-tool call that fails (Nova Lite: `ModelErrorException: Model produced invalid sequence as part of ToolUse`, 3 times on
the flat-timeline input) is asked once more for plain JSON text; a second failure or an unreadable reply keeps the window's
original cues. An abort (job time up) is rethrown. Timing, count, order, `extended`, `shotIndex` and `limitMs` never change.

## Model choice (probes on r2, text-only, 41 Converse calls, ≈ $0.012)

| | Nova Lite v1 (`amazon.nova-lite-v1:0`) | Qwen3-VL 235B (`qwen.qwen3-vl-235b-a22b`, text only) |
|---|---|---|
| Forced tool over `bedrock-runtime` Converse | yes (documented) | works too (stop reason `tool_use`) although the model card lists tool calling under `bedrock-mantle` only |
| Per window of 9 cues | ≈ 1,700 in / 120 out tokens, ≈ $0.00014, 1.3–1.5 s | ≈ 1,600 / 100, ≈ $0.001, 2.5–8 s |
| Counts words | no (every round) | no (14–16 words into 11, every round) |
| Fold in the right direction | yes once nested (`missedJustBefore`) | folded the shot *after* the cue (shot 8 into shot 7's cue) in 3 of 4 replies |
| Invented words | none in 12 replies | none in 7 replies; adds relations ("pours broth *to the red-haired girl*") |
| Failure modes | `ModelErrorException` on the forced tool, 3 of 12 calls (flat-timeline input only; none since nesting) | none |

**Decision: Nova Lite**, the model already used for text, 7× cheaper, and the only one that produced the target fold within
budget ("The man stirs a pot over the fire, then pours broth.", round 3, 11 words in an 11-word room). Neither model counts; the
budget guard and the shortening retry are what make the pass safe, not the model.
Docs: https://docs.aws.amazon.com/nova/latest/userguide/tool-use-definition.html ·
https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ToolChoice.html ·
https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-vl-235b-a22b.html

## Before / after on sintel-90-150-r2 (final code, Nova Lite, ≈ $0.00014 for the window, 0 rejections)

Input = r2's cues.json as voiced on the device (its budgets are the rooms voice measured). Dropped shots: 5 (girl watches man stir
pot), 6 (woman, eyes close), 8 (girl accepts bowl), 10 (woman opens eyes), 11 (hands hold bowl, veiled face), 13 (woman stares).

| Cue (shot) | Room → budget | Before (heard on device) | After |
|---|---|---|---|
| 0 (0) | 5.45 s → 11 | Snowy mountains. A lone figure walks left, carrying a spear. | unchanged |
| 1 (1) | 5.45 s → 11 | Snowy mountains. A figure walks, falls. Logo fades. | **A figure walks, falls. Logo fades.** (repetition removed) |
| 2 (2) | 3.9 s → 9 | Darkness. A faint fire glows in a stone pit. | unchanged |
| 3 (3) | 1.45 s → 3 | Fire burns. | **A fire burns.** |
| 4 (4) | 1.7 s → 4 | Bearded man holds staff. | unchanged (no room for "Red-haired woman watches") |
| 5 (7) | 1.65 s → 4 | Old man pours broth. | unchanged — the stir-pot fold needs ≥ 10 words; this pause holds 4 |
| 6 (9) | 1.3 s → 2 | Tent glows. | unchanged |
| 7 (12) | 2.1 s → 4 | Bearded man speaks. | unchanged |
| 8 (14) | 2.0 s → 4 | Darkness. | **Darkness. Woman stares intently.** (dropped shot 13 folded, 4 words) |

The problem's own example cannot be fixed on r2 by this pass: the pause after "Old man pours broth." is 1.65 s. With that one
cue's gap widened to 5.1 s (the "roomy" variant used in the tests and probes), Nova proposed the fold in rounds 3 and 5 (the
second time 17 words, cut to size by the shortening call only when the shortener kept "pours broth"); on the last two runs of the
identical input it proposed "An old man pours broth." instead — Nova Lite at temperature 0 is not fully deterministic. The fold
test fixture (`test/edit.test.ts`) pins the intended behaviour.

## Risks for the evaluation

- **Faithfulness cannot drop below describe's**: every word of an edit is traceable to a shot description or the cue texts, and
  timing is untouched. It can *propagate* an unfaithful dropped description (shot 11's "veiled face") into the next cue — the
  guard bounds this to the next cue, it cannot judge the description. Expect raters to see dropped-shot text they did not see before.
- **Lateness by design**: a folded fact is heard at the next cue, 1–5 s after its shot. The rubric's "on time" was written for
  fit's placement; a late fact is better than none for the viewer, but a rater may mark it.
- **Small effect on dialogue-dense scenes**: budgets of 2–4 words leave room only for articles and repetition removal (r2: 3 of
  9 cues changed, 1 fold). sintel-90-210's larger gaps should show more folds.
- **Voice may still shorten a lengthened cue**: the 2.2 words/s budget is from one voice (Joanna) on one minute; German (Vicki)
  and multi-sentence lines are slower. A dropped lengthened cue would lose the original too — watch `voice:` drop logs in the rerun.
- **Nova non-determinism**: the same input gave different edits on consecutive runs; an eval comparing runs sees noise of ± 1 edit.
- Cost: ≈ $0.00015 per 30 cues; a 90-minute title (≈ 1,000 cues) ≈ $0.005 plus a shortening call per over-budget edit.
