# 0010 — Visual verify pass after describe

Status: accepted 2026-10-14 (human chose this after the Gate C re-run failed) — on by default; **to be evaluated** on sintel-90-210
Ticket: DESC-027 · Follows: 0003 (Gate C), 0005 (direct Converse calls, cost rule), 0006 (edit pass guards), 0008 (on-screen text)

## Problem

The Gate C re-run on Sintel 1:30–3:30 (`sintel-90-210`, run g9, 2026-10-14) scored **14 / 29 usable** (both raters; rater 1 15,
rater 2 16), against a 70 % gate. Timing and leakage were not the cause: almost every failure is a visual detail Qwen3-VL stated
that the frames do not show, and the same kinds keep coming back across runs:

| Shot | Description | What the frames show (raters) |
|---|---|---|
| 0 | "A figure walks **left** across snow, holding a **staff**" | walks right; a sword |
| 3, 4 | "gripping a **staff**", "holds ornate **staff**" | a sword ("this blade" in the dialogue) |
| 6 | "blinks slowly … a tattoo visible on her **shoulder**" | the tattoo is on her chest; no blink |
| 9 | "Woman **offers bowl** to man." | she keeps the bowl |
| 10 | "Red-haired woman **opens eyes**." | eyes open throughout |
| 11 | "**mist swirls** inside, revealing a faint, shifting face **beneath the surface**" | a still reflection in milky liquid |
| 16 | "grabs a **dark sleeve**" | a wooden board |
| 21 | "**Pink-haired** woman … stands" | red-haired (so named elsewhere); crouched |
| 24 | "beside wounded **bat**" | the small dragon |
| 27 | "dragon roars **nearby**" | a cut to another place |
| 28 | "Red-haired girl **reads book**." | holds the small dragon |

Plus two broken fragments ("City, central pyramid.", "Scaled creature, horns, bloodied wing, stares."); both come from fit's
shortening of a full sentence, not from describe.

## Decision

One more Qwen3-VL Converse call per described shot (`packages/pipeline/src/steps/04b-verify.ts`, prompt in `src/verifyPrompt.ts`),
inside the describe step right after the shot's description, with the **same key frames** (same image blocks, same order) and the
draft text, temperature 0, ≤ 200 output tokens. The prompt names the kinds of detail raters failed — colours, where on the body,
what kind of creature or object, screen direction, eye state, who holds or does what, place across a cut, motion — as types only,
with no example pair from this film (that would teach the evaluation clip's answers). It says: delete every detail that is not
clearly visible; a wrong word for a thing that is there may become a general word (creature, animal, person, figure, object,
weapon, someone, something); prefer deleting to guessing; never add a fact; keep on-screen text clauses ("Words appear:", German
"Text erscheint:"), names and the draft's order; write sentences, not noun lists, adding only the linking words is, are, has,
have, with, there, a, an, the (and "visible"); at most N words, N = `wordCap`. Reply: JSON `{text, removed[]}`.

**Guards** (`checkVerified`, deterministic; any failure keeps the draft and the reason is recorded). Description words are the
content words (`src/contentWords.ts`: the edit pass's STOP list and Porter stem) of the text **without its on-screen text
clauses**, so "Words appear: DRAGON." never licenses "a dragon sign".
1. empty after `parseDescription`'s cleaning (quotes, a SAME reply);
2. on-screen text changed — the text clauses (`src/textClause.ts`) must equal the draft's, in order;
3. name dropped — a known name (`knownNames` for the shot) that the draft said is missing;
4. new words — every description word must be in the draft (by stem) or be a general word (plus "visible"). A name the draft did
   not have is a new word, so names follow the draft (and the draft followed `knownNames`);
5. words out of order (`inDraftOrder`) — the reply's description words must be a subsequence of the draft's, where a general word
   stands in for exactly one draft word at its position (a plural one — creatures, people, objects — only for a plural draft
   word). Without it a reply made only of draft words could swap roles or sides: "The man hands the girl a sword" → "The girl
   hands the man a sword", "from left to right" → "from right to left", "Red-haired woman holds dragon. A man watches." →
   "Woman holds dragon. A red-haired man watches." — all three rejected;
6. no more description words than the draft;
7. at most `wordCap` words: the draft's length + 3 (`MAX_ADDED_WORDS`, room for "there is" / an article to make a noun list a
   sentence), within the shot's describe word budget (`wordBudget`, passed from `describeShots`) — but never below the draft's own
   length, so a draft that already ran over its budget can still be cut down.

With guards 4–6 the pass can only **delete**, **generalise** one word in place, or **add linking words**: "walks left" can become
"walks", never "walks right" (guard 4), and no reply can reorder who does what (guard 5). Not called for SAME, empty or
on-screen-text-only drafts. The checked text replaces the reply before `dedupe`, so a later part of a split shot is told what the
checked earlier part said (`describeAndVerify`, tested).

**Cache, cost, audit.** `cache/verify/{sha256(version, model, prompt, frames, draft)}.json`, written atomically, never for a
`max_tokens` reply: a retry or `--from describe` re-run pays nothing for an unchanged shot. Every fresh call is metered. The shot's
`tokens` / `outputTokens` cover both calls. `{work}/verify.json` lists each checked shot: draft, final text, `removed`, applied,
changed, cached, and for a rejection the reason and the model's reply. `DESCRIBE_VERIFY=0` turns the pass off; `VERIFY_MODEL_ID`
overrides the model (default: the describe model).

## Cost (estimate; no paid call in this change)

Describe on sintel-90-210 (33 cached replies): ≈ 2,200 input / 13 output tokens per shot, ≈ $0.0012; ≈ $0.0173 per minute of film.
Verify sends the same frames plus a longer system prompt and the draft (≈ 2,430 input) and gets ≈ 40 output tokens back:
≈ $0.0014 per shot → **≈ +$0.020 per minute**, ≈ $0.037 per minute for describe + verify, ≈ $0.075 per minute end to end
(was $0.0546). A 90-minute feature: ≈ +$1.80. `estimateUsd` (DESC-025) is built from measured runs and does not include it yet.

## Risks

- **It may delete true details** and leave thinner descriptions ("A red-haired girl is with a creature." instead of a wrong
  "reads book"); raters should judge coverage as well as faithfulness. A bare noun phrase is not rejected by a guard.
- **Attribute swaps between two people with one shared noun** ("woman … woman") can still pass the order guard when the words stay
  in order; the subsequence rule only stops movement across the sentence.
- **It may miss**: the same model that invented a detail is asked to spot it. The bet is that checking a named claim against
  frames is easier than describing; only the evaluation says whether it holds.
- **Guard 4 stops true corrections** ("bat" → "dragon"); by design — a correction is a new claim that nothing checks.
- **Fragments from fit's shortener** ("City, central pyramid.") are not fixed here: the verify pass sees describe's full sentence.
- Doubles the Converse calls in describe (latency per shot ≈ 2×; same `DESCRIBE_CONCURRENCY`).

## Evaluation

Re-run describe (with verify) → fit → edit → voice on the g9 inputs under a new slug, no publish, and have two blind raters score
it with the 0003 rubric (0009's "fits" rule if merged). Compare with g9's 14 / 29 and read `verify.json` for what was removed.

Docs: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html ·
https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ImageBlock.html ·
https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-vl-235b-a22b.html
