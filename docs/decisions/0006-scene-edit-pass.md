# 0006 — Scene-level edit pass between fit and voice

Status: proposed 2026-10-10 — the orchestrator/human accept after the evaluation rerun (`DESCRIBE_EDIT=0` gives the control run)
Ticket: DESC-018 · Follows: 0003 (Gate C, faithfulness must not drop), 0005 (direct Converse calls, cost rule), DESC-017 (PR #25:
shared on-screen text parser `src/textClause.ts`, split text cues, `byStart`)

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
what was rejected and why, the token usage (edit and shortening calls) and the number of shortening calls, for the evaluation.

**Idempotent.** fit writes `cues.fit.json` beside `cues.json`; edit always reads `cues.fit.json` and writes `cues.json`, so a
finish-job retry or `--from edit` starts from fit's cues, never from its own edits, and `DESCRIBE_EDIT=0` copies fit's cues back
(an older work dir without `cues.fit.json` is edited in place, with a warning).

**What the model sees** (`editRequest` in `prompts.ts`): the cues in order as the viewer hears them, each with its word count,
how many words may be added, and — under `missedJustBefore` — the descriptions of the shots dropped between the previous action
cue and this one; plus the dialogue turns. Two things it does *not* see, both from the probes: the full description of a voiced
shot (shown next to its shortened cue, both models "restored" it — round 2), and dropped shots as a flat timeline (Nova folded
the shot *after* a cue into it — round 4). The nesting leaves "fold into the next cue" only one reading.
**On-screen text cues** (DESC-017 splits "Words appear: …" into its own extended cue before the action; `textClauses(text).rest
=== ''`) are frozen: listed as `fixed`, no room, no dropped shots, any edit rejected ("on-screen text cue"). Context (previous
cue, dropped shots, continuity) is measured from the previous *action* cue, so the action cue of a split shot absorbs the shots
dropped before it and keeps continuity with the cue before the text cue.

**Word budget** (`editBudgets`): a placed cue may grow to ⌊room × 2.2 words/s⌋, room = min(gap end, next cue of any kind − 150 ms)
− start — a lengthened clip must not run into a text pause either — never below its own length; an extended cue keeps its own
length (it pauses the film; fit's 25 is a cap, not room). fit budgets at 2.67 words/s, but Polly Joanna on r2 ran at 2.13 words/s
net of the 150 ms lead-in and the r2 cue "Bearded man holds staff." ended 100 ms short of voice's drop threshold: a cue lengthened
to fit's budget would often be shortened or dropped by 06-voice, which is worse than leaving it alone.

**Guards** (`applyEdits`, deterministic, each rejection logged and the original kept), in this order so that a budget rejection —
the only one worth a shortening call — comes last:
1. the index names a cue in this window, once; one non-empty line; not an on-screen text cue;
2. the on-screen text clauses of the original (label and text as `../textClause` reads them: "Words appear:", "Text erscheint:",
   quotes, "Dr. Who") are in the edit verbatim and in order, and the edit adds none;
3. **faithful**: every content word is in the descriptions of the shots between the previous action cue and this cue's shot, or in
   this or that previous cue's text. Not later shots (never before the action), not earlier ones (a dropped fact goes into the *next*
   cue only — Nova folded shot 11's "veiled face", the description Gate C flagged, into the cue of shot 14; round 7). Content words
   are everything but articles, linking conjunctions, case prepositions, auxiliaries and demonstratives: negations (not, nicht,
   kein), quantifiers (all, both, another, one), again / same / still, gendered pronouns (he, she, her, er, sie, ihr) and spatial
   words (over, behind, into, über) must trace. Inflections match through one Porter stem per word (`stemmer`, MIT, no
   dependencies; a hand-rolled candidate-set stemmer matched stars ~ stares and car ~ caring): walks ~ walking ~ walk, fired ~ fire,
   but fir ≠ fired, scar ≠ scared;
4. **keeps facts**: no content word of the original is lost unless the previous action cue already said it (that is the repetition
   the pass removes) or it is a size/age/texture adjective or manner adverb (what fit's shortener drops first). Nova dropped
   "Logo fades." as if it were repetition in 2 of 3 replies (round 4);
5. not over the cue's budget.

An edit over budget gets one shortening call (`shortenEditWithNovaLite`: "at most N words, must still state «original cue»") and
the result passes the same guards; the model appends dropped descriptions whole rather than compressing them (17 words into an
11-word room, round 5; four descriptions into one cue on the merged fit's cues, round 10), and fit's generic shortener kept the
wrong half (dropped "pours broth", round 6).
A forced-tool call that fails (Nova Lite: `ModelErrorException: Model produced invalid sequence as part of ToolUse`, 3 times on
the flat-timeline input) is asked once more for plain JSON text (the first `{…}` of the reply is read, fence or prose around it
ignored); a second failure or an unreadable reply keeps the window's original cues. An abort (job time up) is rethrown. Timing,
count, order, `extended`, `shotIndex` and `limitMs` never change.

## Model choice (probes on r2, text-only, 45 Converse calls, ≈ $0.013)

| | Nova Lite v1 (`amazon.nova-lite-v1:0`) | Qwen3-VL 235B (`qwen.qwen3-vl-235b-a22b`, text only) |
|---|---|---|
| Forced tool over `bedrock-runtime` Converse | yes (documented) | works too (stop reason `tool_use`) although the model card lists tool calling under `bedrock-mantle` only |
| Per window of 9–10 cues | ≈ 1,700–2,000 in / 100–160 out tokens, ≈ $0.00015, 1.3–1.5 s | ≈ 1,600 / 100, ≈ $0.001, 2.5–8 s |
| Counts words | no (every round) | no (14–16 words into 11, every round) |
| Fold in the right direction | yes once nested (`missedJustBefore`) | folded the shot *after* the cue (shot 8 into shot 7's cue) in 3 of 4 replies |
| Invented words | none in 14 replies | none in 7 replies; adds relations ("pours broth *to the red-haired girl*") |
| Failure modes | `ModelErrorException` on the forced tool, 3 of 14 calls (flat-timeline input only; none since nesting) | none |

**Decision: Nova Lite**, the model already used for text, 7× cheaper, and the only one that produced the target fold within
budget ("The man stirs a pot over the fire, then pours broth.", round 3, 11 words in an 11-word room). Neither model counts; the
budget guard and the shortening retry are what make the pass safe, not the model.
Docs: https://docs.aws.amazon.com/nova/latest/userguide/tool-use-definition.html ·
https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ToolChoice.html ·
https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-vl-235b-a22b.html

## Before / after on sintel-90-150-r2 with DESC-017's cues (final code, Nova Lite, ≈ $0.00016, one window)

Input = `test/fixtures/sintel-90-150-r2.cues.fit.json`: the merged fit (PR #25) on r2's recorded descriptions and gaps with the
deterministic shortener — 10 voiced cues, "Words appear: SINTEL." kept beside its action in cues 0 and 1 (06-voice splits it
later when the clip overruns). Dropped shots: 5 (girl watches man stir pot), 6 (woman, eyes close), 10 (woman opens eyes),
11 (hands hold bowl, veiled face), 12 (bearded man speaks).

| Cue (shot) | Room → budget | Before (fit) | After |
|---|---|---|---|
| 0 (0) | 5.45 s → 13 | Snowy mountains. A lone figure walks left, carrying a spear. Words appear: SINTEL. | unchanged |
| 1 (1) | 5.45 s → 12 | Snowy mountains. A figure walks, falls. Logo fades. Words appear: SINTEL. | unchanged — Nova proposed "Snowy mountains. A figure walks, falls." (text clause and "Logo fades." gone): **rejected**, on-screen text clause changed |
| 2 (2) | 3.9 s → 9 | Darkness. A faint fire glows in a stone pit. | unchanged |
| 3 (3) | 1.45 s → 3 | Dark room. | unchanged |
| 4 (4) | 1.7 s → 4 | Bearded man holds staff. | unchanged |
| 5 (7) | 1.65 s → 4 | Old man pours broth. | unchanged — the stir-pot fold needs ≥ 8 words; this pause holds 4 |
| 6 (8) | 1.75 s → 4 | Red-haired girl accepts bowl. | unchanged |
| 7 (9) | 1.3 s → 2 | Tent interior. | unchanged |
| 8 (13) | 1.95 s → 5 | Red-haired woman stares intently forward. | **Red-haired woman stares forward.** ("intently" is a droppable adverb) |
| 9 (14) | 3.06 s → 6 | Darkness. Faint red sparks drift downward. | unchanged |

On the 9 cues heard on the device before DESC-017 (`cues.json`, final code of round 9) the pass applied three edits: the repeated
"Snowy mountains." removed from cue 1, "A fire burns.", and dropped shot 13 folded into the last cue ("Darkness. Woman stares
intently.", 4 words in a 4-word room). The problem's own example cannot be fixed on r2 by text alone: the pause after "Old man pours
broth." is 1.65 s. With that gap widened (the "roomy" fixture used in the tests) Nova proposed the fold in rounds 3 and 5; on the
merged cues it glued four dropped descriptions into the cue instead (rejected on "her" before any shortening call). Nova Lite at
temperature 0 is not fully deterministic: identical input gave different edits on consecutive runs. The fold test fixture
(`test/edit.test.ts`) pins the intended behaviour.

## Risks for the evaluation

- **Faithfulness cannot drop below describe's**: every word of an edit is traceable to a shot description or the cue texts, and
  timing is untouched. It can *propagate* an unfaithful dropped description (shot 11's "veiled face") into the next cue — the
  guard bounds this to the next cue, it cannot judge the description. Expect raters to see dropped-shot text they did not see before.
- **Swapped attributes pass the word guard**: "bearded woman" / "red-haired man" uses only allowed words. The model never did this
  in 14 replies; raters should watch for it.
- **Lateness by design**: a folded fact is heard at the next cue, 1–5 s after its shot. The rubric's "on time" was written for
  fit's placement; a late fact is better than none for the viewer, but a rater may mark it.
- **voice judges `introducesNew` on the edited text**: an edit that adds "a man" or "a room" makes an overrunning cue extended
  (a pause) where fit's text would have been dropped. The budget margin (2.2 words/s) makes an overrun unlikely; watch `voice:` logs.
- **Small effect on dialogue-dense scenes**: budgets of 2–5 words leave room only for articles, an adverb and repetition removal
  (merged r2: 1 of 10 cues changed). sintel-90-210's larger gaps should show more folds.
- **Voice may still shorten a lengthened cue**: the 2.2 words/s budget is from one voice (Joanna) on one minute; German (Vicki)
  and multi-sentence lines are slower. A dropped lengthened cue would lose the original too — watch `voice:` drop logs in the rerun.
- **German**: the Porter stem is English, so a German inflection matches only when written the same (stricter: more rejections,
  never looser); the stop-word list is short, so German function words such as "ohne", "noch" must trace. Untested on a German title.
- **Nova non-determinism**: the same input gave different edits on consecutive runs; an eval comparing runs sees noise of ± 1 edit.
- Cost: ≈ $0.00016 per 30 cues; a 90-minute title (≈ 1,000 cues) ≈ $0.005 plus ≈ $0.00005 per shortening call.
