# 0003 — Gate C: description prompt, timing bound, evaluation

Status: closed 2026-10-02 — Gate C passes with Qwen3-VL 235B (72.4 %, both raters)
Ticket: DESC-001 part 2 · Gate definition: hackathon runbook §6 (Gate C: < 70 % usable in a 20-shot sample → swap model)

## Evidence (Sintel 1:30–2:30, first paid run)

3 of 7 cues usable. Causes: cues placed 8–13 s after their shot (`05-fit.ts` skipped the open gap and had no lateness bound);
`SAME. Woman holds bowl.` voiced (only a bare `SAME` was recognised); two invented `Words appear:` lines on frames with no
text — reproducible, caused by the unconditional text rule in the prompt; scene detection at 0.3 found 3 of 11 cuts.
Planner diagnosis and prompt probes (≈ $0.04, 17 Nova Pro calls): `gate-c-plan` in the session scratchpad.

## Decisions

1. **Description prompt** — on-screen text only when clearly legible ("Never invent text"), an explicit darkness rule,
   one line ≤ budget, temperature 0, media before the instruction (video for Nova Pro; key frames since the switch to Qwen3-VL). The previous description leaves the model input; the
   "nothing new" short-circuit moves into the pipeline (`parseDescription`: leading `SAME` or a near-verbatim repeat of the
   previous description). This replaces the "SAME short-circuit" wording in PLAN.md's prompt rules; the intent — never voice a
   redundant description — is unchanged.
2. **Lateness bound** — a description starts no later than 1 s after its shot ends (`LATE_MS = 1000`); otherwise it is
   dropped, or becomes an extended cue when it carries new information.
3. **Evaluation** — rerun on Sintel 1:30–3:30 (`sintel-90-210`, 29 shots, ≈ $0.15). Two raters judge each shot against a
   frame contact sheet: faithful, on time, style, clean, fits. Score = usable / (shots − same-as-previous). < 70 % → Claude on
   Bedrock for descriptions; key frames were probed and gave no advantage.
   *Superseded by the bake-off below:* Claude on Bedrock was not tested (Anthropic use-case form not submitted); the
   replacement chosen is Qwen3-VL 235B from key frames.

Docs: https://docs.aws.amazon.com/nova/latest/userguide/modalities-video.html ·
https://docs.aws.amazon.com/nova/latest/userguide/prompting-structured-output.html

## Result (2026-10-01, `sintel-90-210`, commit 25973b0)

29 shots, 0 same-as-previous, 23 voiced (3 extended), 6 unplaced. Two independent Fable raters against frame contact sheets;
a shot counts as usable only when both rated it usable.

| | Rater 1 | Rater 2 | Both |
|---|---|---|---|
| Usable | 14 | 14 | **12** (2, 4, 8, 9, 11, 12, 15, 16, 17, 18, 24, 26) |
| Strict score | 48.3 % | 48.3 % | **41.4 %** |
| Lenient reading | 58.6–65.5 % | 58.6 % | — |

**Gate C is triggered under every reading (< 70 %).** Timing, overlap, word budget and leakage had zero failures — the
pipeline fixes hold. Every failure is faithfulness: invented people, objects and events (6 "another woman approaches",
13 "hit by a fireball", 14 "person runs through city", 20 "paints a dragon model", 28 "red dress … repairing armor"), wrong
colours (22, 27 dragons; hair), weak verbs ("stands" for walking/crouching), plus emotion words in unplaced text.
Two pipeline amplifiers: the `isNew` heuristic turned 2 of the worst inventions into extended (pause) cues; shot cuts
land ~2 frames late, so clips end on the next shot's frames and Nova sometimes describes those.
Cost: ≈ $0.15 (Nova Pro 74,253 input tokens).

## Replacement bake-off (2026-10-01)

Same 29 shots, the approved prompt verbatim, temperature 0, `parseDescription` on every reply. Raw descriptions rated
blind (models shuffled to letters, seed 20261001) by two independent raters on faithful / style / clean (timing excluded —
the pipeline owns it; length excluded — fit() shortens). Raters were Opus, not Fable: the account hit its Fable limit and the
human chose Opus for the whole bake-off. Usable = both raters agree. Inter-rater agreement 27–28 of 29 per model.

| Model (Bedrock id) | Input | Rater 1 | Rater 2 | Both | Cost / 29 shots | Notes |
|---|---|---|---|---|---|---|
| **Qwen3-VL 235B** (`qwen.qwen3-vl-235b-a22b`) | 3–6 key frames | 23 | 23 | **22 (75.9 %)** | $0.034 | literal, house style, no invented scenes; misses are wrong details (direction, "gargoyle", "doll") and thin coverage |
| TwelveLabs Pegasus 1.2 (`us.twelvelabs.pegasus-1-2-v1:0`) | video (clips < 4 s padded) | 13 | 15 | 13 (44.8 %) | $0.078 | adds "Night. A rooftop." to 7 daylight shots; invented objects |
| Nova Pro v1 (baseline) | video | 6 | 5 | 5 (17.2 %) | $0.061 | invented events, wrong colours (raw text, before shortening) |
| Nova 2 Lite (`us.amazon.nova-2-lite-v1:0`) | video | 1 | 2 | 1 (3.4 %) | $0.028 | ignores one-line rule; camera language; 10 replies cut off |
| Claude Haiku 4.5 | key frames | — | — | — | — | not tested: Anthropic use-case form not submitted for the account |

Spend ≈ $0.15. Docs: https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-pegasus.html ·
https://docs.aws.amazon.com/nova/latest/nova2-userguide/using-converse-api.html

**Decision (human, 2026-10-01): describe shots with Qwen3-VL 235B from 3–6 key frames** (commits 126d1e9, ee9495d).

## Confirmation run (2026-10-02, `sintel-90-210`, full pipeline from `describe`)

29 shots, 22 voiced, 0 extended, 7 unplaced; ≈ $0.03 for descriptions (61,495 input tokens). Two independent Opus raters,
full five-criterion rubric including timing; unusable if either rater says so.

| | Rater 1 | Rater 2 | Both |
|---|---|---|---|
| Usable | 22 (75.9 %) | 24 (82.8 %) | **21 (72.4 %)** |

**Gate C passes.** Timing, overlap, budget, style and clean had zero failures. All 8 misses are faithfulness details:
direction (0 "walks left"), eyes (10), an invented "veiled face" (11), shot 14 voiced as darkness while the city fades in,
"grabs a sleeve" for lifting a cloth (16), "stands"/"pink-haired" (21), "reads book" for tending the dragon (28), and
26 "bloodied wings" — Qwen wrote "wing"; the Nova Lite shortening step introduced the plural.
The margin is thin (2.4 points): follow-ups are a shortener that may not change facts, and per-title spot checks.

## Split camera shots and on-screen text (DESC-017, approved 2026-10-10)

Found on the Fire TV Stick in `sintel-90-150-r2`: shots 0 and 1, the two halves of one 11.2 s camera shot (`shotsFromCuts` splits
> 8 s), were described from scratch and both voiced; and 06-voice's overrun shortening cut "Words appear: SINTEL." from both cues.
1. Split parts carry `part: { of, i }`. Each camera shot is described as one sequential chain. A later part's request — and only
   that request — appends what the first and the previous part said and one instruction: say only what is new, or reply exactly
   SAME (the system prompt is unchanged). In `dedupe`, a later part keeps only its sentences with a content word not already said;
   with none left it is not voiced (r2 shot 1 → "A figure walks, falls. Logo fades."). A share-of-words rule was rejected in review:
   the stable descriptor the prompt requires made "The woman in the red coat draws a gun." look like a repeat. SAME is recognised in
   any case, as are "Nothing new." / "No new information." / "Nichts Neues." / "Gleich.".
2. Shortening (deterministic, model, `capExtended`) never shortens or removes on-screen text ("Words appear:", or German
   "Text erscheint:" / "Wörter erscheinen:" / "Schrift erscheint:"); the model shortener never sees it. A clause after other text is
   put back at the end when the text is shortened.
3. **Decision (human, 2026-10-10): split.** When the on-screen text does not fit the gap budget together with the action, the action
   is placed as a normal cue (shortened, text removed) and the text clause becomes its own extended cue. Neither is dropped.
   Review round 2: the text stays beside the action only when that keeps at least half of the action's words (r2 shot 0 had kept
   "Snowy mountains." and lost "A lone figure walks left"); 05-fit first looks for any gap in the shot window that fits the whole
   text, and splits only when none does. Cues stay sorted by start, an on-screen text cue first on a shared start; extended cues
   never count toward overlap.
   **Where the text cue starts.** The player checks position 4 times a second, so a pause on the action's own ms cut its first
   syllable: the text cue starts `TEXT_LEAD_MS` = 400 ms before the action (`leadText`), never before the shot start or the end of
   the previous placed cue; with no room for that, the action moves 400 ms after the text cue when it still fits, else both start
   together. In 05-fit the action start is its gap slot, and "fits" means the action's words still fit the rest of the gap. In
   06-voice (an overrunning clip split after Polly) the action start is the cue's fit start, the shot start comes from
   shots.json (the cue's own start when missing), and "fits" means the measured clip still ends within its limit.

## DESC-017 result (2026-10-10, `sintel-90-210` run A2, from `shots`)

The DESC-017 pipeline (split camera shots described once, on-screen text never shortened away, PR #25) on the same 29 shots:
**22 / 29 = 75.9 % usable, both raters** (Opus, independent, 5 frames per shot plus crops), up from 72.4 %. Both marked the same 7
misses — shots 0, 6, 10, 11, 16, 21, 28 — every one a model faithfulness detail (0 "walks left", 6 "expression unreadable", 10 "opens
eyes", 11 "veiled face rises", 16 "grabs a dark sleeve", 21 "pink-haired … stands", 28 "holds book"); timing, dialogue overlap, style
and clean had zero failures. The rubric now rates a sameAsPrev or stripped continuation against the frames, like any other shot, and a
shot the pipeline did not voice by the text it would have voiced (rater 1's own total, 58.6 %, had counted every unplaced shot as
unusable; read against the frames both raters agree on the 7). 20 voiced (1 extended), 9 unplaced (5, 6, 8, 10, 11, 23, 24, 27, 28);
the raters flagged two of those as plot events lost — 8 "accepts bowl", 24 "kneels beside the dragon" — which is DESC-020
(docs/decisions/0007-dropped-events.md).
Reports: the session scratchpad `eval-1010b/rater1.md`, `rater2.md`.
