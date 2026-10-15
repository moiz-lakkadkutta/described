# Spike: a narrative continuity pass for full-length Sintel

Status: spike, dry run only. Nothing is merged, published or written to the DB, S3 or CloudFront. Date: 2026-10-15.
Branch: `spike/narrative-pass`. Code: `packages/pipeline/spikes/narrative-pass.mts` (the pass and its guards) and
`spikes/voice-sample.mts` (Polly voices). Raw output: `packages/pipeline/spikes/out/*.json`, and `spikes/out/voice/*.mp3` to listen to.

## The problem

The user watched full-length `sintel` on Fire TV and said: *"it still does not feel consequential, like each description is
independent of each other… make it like a wildlife documentary."*

The published script shows why. Each shot is described on its own (decision 0003), checked on its own (0010), and placed on its
own (0009). The edit pass (0006) has a continuity mandate, but it is Nova Lite with a word budget and a keeps-facts guard, so in
practice it only removes repeats. Out of 127 cues the full look phrase ("a young woman with short red hair" and variants) is
said **52 times**, and "she" only **5 times**. Between 3:00 and 5:57, 20 of 32 cues open with "A young woman with short red
hair …". Nothing in the script links one moment to the next ("then", "now", "back in …"), and a person introduced 4 s earlier
is introduced again as a stranger ("a young woman"), which also suggests to the listener that this is a different woman.

A documentary narrator does three things the script does not: they **carry referents** ("she", "the dragon", once
established), they **link** ("Then…", "Now…", "Back in the mountains…"), and they keep **one voice and one rhythm**. None of
these needs a new fact. That is the space this pass works in.

## Proposal

### Where it goes

**Upgrade the 05b edit pass into the narrative pass**: after `fit`, before `voice` (`STEPS`: … fit → **edit** → voice). Do not
add a separate step.

- It must run after fit, because only fit knows each cue's room (budget) and which shots were dropped (to fold in).
- It must run before voice, because the text is what Polly speaks.
- It works on verified text: `described.json` already holds the verify-pass output (0010), so the pass's "sources" are checked
  descriptions, and its faithful guard traces every content word to them.
- 05b already has all the plumbing this needs: `cues.fit.json` → `cues.json` (idempotent, `--from edit` re-runs), windows per
  scene, glossary people and `mayName`, `unnamedIn` name windows, the grounding guard, `edit.json` audit, metering. The spike
  calls 05b's own `applyEdits` as its guard.
- Context-carrying in **describe** (the previous shot's verified text passed to Qwen3-VL) would also help, since the describer
  could choose "she" and continuity verbs at the source. But it means re-running describe and verify (≈ $1.10 for full Sintel,
  plus a full Gate C re-rate), and it puts continuity into the per-shot verify guard, which by design allows no new word
  (`checkVerified`: "new words: she, then"). Phase 2 at most.

### What the pass may do (the "narrative licence")

Only these changes, each with a deterministic check:

| Device | Example (this run) | Guard that permits it |
|---|---|---|
| Carry a referent: pronoun | "A young woman with short red hair climbs a rooftop." → "Then she climbs a rooftop." | **New: pronoun licence.** A gendered pronoun is allowed when its referent (a woman/girl/name for "she", a man/boy for "he") is in one of the last **two** action cues, within **20 s**, and in the **same scene**, or earlier in the same cue. It is then checked as that noun ("she" → "woman") by the existing faithful guard. "it/its/they" are already free (STOP list). |
| Carry a referent: drop the look | "A small tan dragon with a bleeding wing lies on a stone roof." → "The small tan dragon lies on a stone roof." | **New: carried look.** A glossary character's look words (`look`, minus generic and held-object words like staff) count as already said when an earlier cue **of the same scene, as heard,** said them and the new cue still refers to that character (pronoun, kind noun or name). They are never dropped in the scene's first mention. This extends 05b `droppedFacts`, which today only accepts words the **immediately previous** cue said. |
| Definite article | "a young woman" → "the young woman" | Already free. |
| Plain connectives | "Then she runs across a stone fortress at sunset…", "Now she stands on a rocky ledge." | "then, as, while, and" are already STOP words; **new: "now", "here"** are free. "still", "again", "meanwhile", "later", "night falls" are **not** free: each is a fact (continuation, repetition, simultaneity, a time skip) and must trace to a source. The spike rejected "still bleeding" and "lies" this way. |
| Scene opening | "Back in the snowy mountains, the dragon lies still as Sintel walks into the hazy distance." | Existing scene rules (0012): place said once per scene, "back in" only on a returning scene. |
| Reorder within a cue, join with "as" | "…smiles slightly. A tan-brown creature roars…" → "…smiles slightly as a tan-brown creature roars…" | Existing `editReadsAsSentences` and faithful guards. |
| Fold a dropped shot | (0006, unchanged) | Existing. |

Every other 05b guard still applies, unchanged: no content word outside this cue's shot descriptions, glossary look or the previous
cue; no fact lost; on-screen text clauses verbatim and on-screen text cues frozen; names only from `mayName`, with `unnamedIn`
withheld; another scene's place not carried; complete sentences (0011/0015); the cue's word budget at 2.2 words/s. Then
`polishCue` (0015). A cue that fails any guard keeps its old text: the pass can only improve a cue or leave it alone.

What the pass must **not** do (and the guards stopped in this run): interpretation ("swift and focused", "moving with purpose",
"frozen", "her coat still wrapped tight": Qwen3-VL, all rejected as "not in any shot description"), a name before it is revealed
("Sintel walks uphill…" at 7:03, before 7:37.8: Nova Pro, rejected by the name guard), a pronoun with no referent nearby ("She
walks across the snowy mountains…" after "A person walks uphill…": rejected by the pronoun licence).

### Prompt shape

One Converse call per window of about 22 cues (the spike uses fixed windows; production keeps 05b's per-scene windows), plain JSON
reply (not a forced tool: Nova Lite's `ModelErrorException` on forced tool use, 0006 and the Rich captions failures, is avoided
completely; a lenient per-object parse salvages a truncated reply). System prompt (in full in the spike):

1. Role: the narrator of an audio description track; turn separate observations into **one connected narration, the way a
   nature-documentary narrator carries the listener from moment to moment, while staying a strict audio description**.
2. Input per cue: `text`, `sources` (the verified descriptions of the shots this cue covers), `mustStillSay` (05b `factWords`
   **minus the carried look words**, so the prompt and the guard ask for the same thing; otherwise the model obeys
   `mustStillSay` and repeats "red hair"), `maxWords` (05b budget), `mayName`, `newScene`; plus `people` (glossary looks, short
   form, name once revealed, never the role) and `heardJustBefore` (the last 6 cues already rewritten).
3. Continuity instructions: carry referents (pronoun only if the referent is in one of the last two cues); "the" for anything
   already introduced; plain connectives; "still" or "again" only when the sources show it; open a new scene with its place,
   once; vary the openings; warmth from the verbs and nouns already in the sources and from rhythm, **never from adjectives of
   feeling or judgement**.
4. The audio description rules, restated as hard rules: no new fact; nothing about thoughts, feelings or intent; no metaphor; no
   foreshadowing; keep `mustStillSay`; at most `maxWords`; present tense, complete sentences; names only from `mayName`;
   "Words appear:" clauses verbatim; no merge, split or reorder.

**No synopsis is given to the model.** A synopsis is the easiest way to leak what happens next or what someone wants (the
glossary's `role` is never voiced, 0012, for the same reason). "Story so far" here means the cues as heard, nothing else.

### Model

Bedrock `us-east-1`, same prompt, same guards, the whole film (127 cues, 6 calls each):

- **DeepSeek v3.2: the best result.** The most natural prose (it varies openings and joins clauses with "as"), the most cues
  kept (63), interpretation rejected only 5 times, $0.019 per full film.
- **Amazon Nova Pro: the Amazon-first fallback.** 53 cues kept and the fewest guard failures, but it rewrites the look as "the
  red-haired young woman" in every cue, so it repeats less than today without really narrating.
- **Qwen3-VL 235B (text only):** adds interpretation ("swift and focused", "frozen"). 21 rejections for unsourced words.
- **Mistral Large 3:** 89 of 116 proposals rejected (this was an earlier guard build, so the numbers are not comparable, but it
  over-rewrote).
- **Nova Lite:** too weak for this. On window 1 it only swapped "a" for "the".
- **Claude Sonnet 4.5:** listed in the account, but every call failed with "Model use case details have not been submitted
  for this account". Submitting the Anthropic use-case form (console, once) would let it be tried. It is the model most likely
  to write documentary prose within the rules. At ≈ $3 / $15 per M tokens a full Sintel pass would be ≈ $0.11.

**Recommendation: DeepSeek v3.2 as `EDIT_MODEL_ID` for the narrative prompt, with Nova Pro as the fallback when DeepSeek is
unavailable. Run Claude Sonnet as a bake-off once the use-case form is in.** The guards, not the model, make it safe, as 0006
already found for the edit pass.

### Voice: does Polly add the documentary feel?

Partly. Text continuity is the larger effect; voice is the smaller one, and it costs fit room. The same 6 rewritten cues (4:49–5:29)
were voiced as 06-voice does it (150 ms lead break, `<prosody rate>`) and measured with decision 0009's silencedetect. Listen:
`spikes/out/voice/*.mp3`.

| Variant | Engine | Speech words/s | File words/s | Price per 1M chars |
|---|---|---|---|---|
| Joanna (ships today) | neural | 3.40 | 3.05 | $16 |
| Joanna, rate 90 % | neural | 3.06 | 2.77 | $16 |
| Ruth | generative | 2.98 | 2.79 | $30 |
| Danielle | generative | 2.93 | **2.52** | $30 |
| Matthew | generative | 3.35 | 3.11 | $30 |
| Gregory | long-form | 2.99 | **2.57** | $100 |

- en-US generative voices in us-east-1: Danielle, Joanna, Ruth, Salli, Matthew, Stephen, Tiffany. The same set is in
  eu-central-1, the region 06-voice uses today. Long-form voices (Danielle, Gregory, Patrick, Ruth) are in **us-east-1 only**,
  not eu-central-1 (`aws polly describe-voices`, 2026-10-15).
- SSML: `<break>`, `<p>`, `<s>` are fully supported on neural, long-form and generative. `<prosody>` supports **rate and volume,
  not pitch**, on all three, and **on generative voices only around full sentences** (our cues are full sentences since 0015).
  `<emphasis>`, `<amazon:auto-breaths>` and `phonation="soft"` are not available on any of the three. The newscaster style is
  neural only, and it is the wrong register for this anyway.
- **Fit impact:** fit budgets at 2.67 words/s plus 450 ms of overhead (0009), and 05b at 2.2. Danielle generative and Gregory
  long-form run at 2.52–2.57 words/s by file length, **below fit's 2.67**, so some placed clips would overrun and 06-voice would
  shorten or drop them. A voice change needs a per-voice `WPS` constant (measure, then set fit's `WPS` and 05b's `EDIT_WPS` per
  voice) and its own Gate C "fits" check.
- **Recommendation:** keep the text pass separate from the voice change. If the user wants the warmer timbre, try **Ruth
  generative** (≈ Joanna's room with a rate of 90 %, warmer, $30 per 1M chars: ≈ $0.27 to voice full Sintel's 8.9 k characters,
  against $0.14 on neural), and use the **Joanna 90 % vs Ruth** files for an A/B on the stick. Long-form at $100 per 1M is
  3× generative for a similar result here.

Docs: https://docs.aws.amazon.com/polly/latest/dg/generative-voices.html ·
https://docs.aws.amazon.com/polly/latest/dg/long-form-voices.html ·
https://docs.aws.amazon.com/polly/latest/dg/supportedtags.html · https://docs.aws.amazon.com/polly/latest/dg/prosody-tag.html ·
https://aws.amazon.com/polly/pricing/ (standard $4, neural $16, long-form $100, generative $30 per 1M chars) ·
https://aws.amazon.com/bedrock/pricing/ (DeepSeek v3.2 $0.62 / $1.85, Mistral Large 3 $0.50 / $1.50 per 1M tokens; Nova Pro
$0.80 / $3.20, Nova Lite $0.06 / $0.24 from `src/cost.ts`, TODO(price): verify) ·
https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html

### Guard interaction (the counts below)

- **Edit guards (05b `applyEdits`) + pronoun licence + fit:** these decide. A cue keeps its new text only if all of them pass.
- **fit:** each new text is checked with `estimateClipMs` against the cue's limit (min of `limitMs` and the next cue − 150 ms); an
  extended cue must stay ≤ 25 words. "fit (new only)" counts a new text that fails where the old text passed. In practice the
  05b budget (2.2 words/s) is stricter, so every cue that failed fit had already failed "over budget".
- **verify\* (04b `checkVerified`), informational:** it is a same-shot **deletion** guard (only the draft's own words plus
  linking words). Every pronoun or connective fails it ("new words: then, she"), and so does every dropped name ("name
  dropped: Sintel"), by design. It must **not** run after the narrative pass. It already ran on the sources the pass is held to.
- **shortener-sentence\* (0011 `readsAsSentences`), informational:** it requires the content words in the original's order (a
  shortening), so any reorder or pronoun fails it. The narrative pass uses `editReadsAsSentences` (inside `applyEdits`), the
  same as 05b today.
- One guard false positive to check before building: "says the scene's place again" rejected edits that only changed an article
  or dropped a look word while keeping the place the original already said (cues 77, 84, 95, 99 in the cave).

### Cost to apply to all six titles (re-run from `edit`)

| | Sintel (full) | Five 60 s titles | Total |
|---|---|---|---|
| Cues / characters | 127 / 8,867 | 53 / 2,700 | 180 / 11.6 k |
| Narrative pass, DeepSeek v3.2 (measured: ≈ 150 input and 30 output tokens per cue) | $0.019 | ≈ $0.008 | **≈ $0.03** |
| Same with Nova Pro | $0.024 | ≈ $0.010 | ≈ $0.035 |
| Re-voice the changed cues, Joanna neural (≤ all characters) | ≤ $0.14 | ≤ $0.04 | **≤ $0.19** |
| Re-voice with Ruth generative instead | ≤ $0.27 | ≤ $0.08 | ≤ $0.35 |
| mix / text / package / publish (local ffmpeg, S3 PUT, one invalidation) | ≈ $0 | ≈ $0 | ≈ $0 |
| **`--from edit` for all six** | | | **≈ $0.25 (neural) · ≈ $0.40 (generative)** |

For comparison, the last full Sintel `--from edit` re-run was $0.0984 (only the changed clips are voiced again; the clip cache
keys on the SSML). A Gate C re-check of the pass (edit → voice on the copies of `sintel-90-210` and `tos-390-510`, 3 raters each)
adds ≈ $0.02 of model and Polly calls, plus the rating work.

### Risk to Gate C

Gate C raters judge each shot against its own frames (faithful, on time, style, clean, fits). This pass changes text only, never
timing, so "on time" cannot move.

- **Faithful.** No new content word passes the guard. The new risk is **reference**: "she" or "the dragon" is faithful only if
  the referent really is the same one. Where it can go wrong is a cut to a second figure of the same kind: the horned dragon and
  Scales (5:15–5:31, the `unnamedIn` window; cue 50 became "It flies toward a reaching hand."), the grey dragon in the cave, the
  shaman versus the bald man. Also, a rater who reads one shot alone sees "She kneels beside the bleeding dragon." without the
  cue before it. The packets must show the previous cue (they show dialogue ±2 s today) or "she" will look ungrounded.
- **Facts dropped by carry.** The carried-look rule and 05b's existing "the previous cue said it" rule let a cue drop words the
  scene already said: "ruined" (4:55), "away" and "farther" (12:04, 12:18). These are true but no longer in this shot's line. A
  rater judging coverage may mark the shot thinner.
- **Style** should improve (fewer stacked look phrases, fewer stranger re-introductions), and 0015's complete sentences are kept.
- **Tuned clip effect.** Gate C's primary clip (1:30–3:30) has 2 people and 1 dragon and benefits most. The held-out Tears of
  Steel clip has several people of the same kind (soldiers, scientists), the case where pronoun licensing is most likely to
  mislead. Expect the held-out score to show the risk first.
- **Net:** it should be neutral to slightly positive on Sintel g12 (21/29) and could cost 1–2 shots on ToS. Re-gate both clips
  before shipping. The user ruled that quality work stopped after decision 0016, so this re-opens it and needs their go-ahead.

### Plan (if approved)

1. **DESC-0xx narrative pass** (one PR): 05b prompt v2 (this spike's system prompt, per-scene windows, `mustStillSay` minus
   carried look); `droppedFacts(original, edited, heardInScene, glossary)` with the carried-look rule; pronoun licence in
   `unfaithfulWords` (last two action cues, 20 s, same scene, one candidate of that gender, otherwise rejected); "now", "here"
   free; plain-JSON mode first with a lenient parse; `EDIT_MODEL_ID=deepseek.v3.2` plus a price in `cost.ts`; fix the
   place-again false positive; tests from this spike's accepted and rejected pairs.
2. Gate C packets show the previous voiced cue for every shot.
3. Re-gate `sintel-90-210` and `tos-390-510` (edit → voice on copies, ≈ $0.02). Ship only if neither drops.
4. Re-run all six titles `--from edit` (≈ $0.25), then check on the stick.
5. Separately, if wanted: the voice A/B (Joanna 90 % vs Ruth generative), then per-voice `WPS`.
6. Later, phase 2: continuity context in describe (the previous verified shot passed to Qwen3-VL), when a full re-describe is
   being paid for anyway.

## Dry run

Inputs: `packages/pipeline/work/sintel` from the main checkout, read-only (`cues.json` as published: 127 cues, 17 extended;
`described.json`; `words.json`; `scenes.json`), glossary `sintel` from `apps/api/prisma/glossaries.json`. Each cue keeps its
start, end, `extended` and `shotIndex`. Its maximum length is 05b's budget (and fit's estimate is checked too).

**Bedrock spend for the whole spike: $0.19** (11 full-film or 1-window runs across 5 models, plus 7 one-token access probes;
Claude Sonnet: 0 tokens, refused). **Polly: ≈ $0.065** (6 variants × 6 cues, 292 characters each). Cap was $1.

### Read as heard, 4:49–5:44 (cues 44–53)

**Published:** A young woman with short red hair looks down at a ruined town. A young woman with short red hair runs across a ruined stone fortress at sunset as red-winged creatures fly overhead. A woman stands on a rocky ledge. A young woman with short red hair smiles. A young woman with short red hair looks up as dragons fly past at sunset. The dragon soars through pink clouds toward a ruined town where a young woman stands. The dragon flies toward a reaching hand. A young woman with red hair lies prone as a huge dragon looms overhead, then leaps away over broken stone under a dusky sky. A young woman with short red hair stands amid ruins, eyes wide, mouth open. A young woman with short red hair stares forward, her expression shifting from surprise to a fierce, narrowed gaze.

**After the pass (DeepSeek v3.2, after the guards):** She looks down at a ruined town. Then she runs across a stone fortress at sunset as red-winged creatures fly overhead. Now she stands on a rocky ledge. The young woman smiles. She looks up as dragons fly past at sunset. The dragon soars through pink clouds toward the ruined town where she stands. It flies toward a reaching hand. The woman with red hair lies prone as a huge dragon looms overhead, then leaps away over broken stone under a dusky sky. She stands amid ruins, eyes wide, mouth open. Then she stares forward, her expression shifting from surprise to a fierce, narrowed gaze.


### 3:00–5:57 (cues 24–55)

| # | Time | Old (published) | Proposed (DeepSeek v3.2) | Final after guards | Guards |
|---|---|---|---|---|---|
| 24 | 3:00 ext | A young woman with short red hair climbs a rooftop. | Then she climbs a rooftop. | Then she climbs a rooftop. | **kept new** · verify*: new words: then, she; shortener-sentence*: out of order |
| 25 | 3:02 ext | A small tan dragon with a bleeding wing sits on a tiled rooftop, mouth open, as blood pools beside it. | A small tan dragon with a bleeding wing sits on a tiled rooftop, its mouth open as blood pools beside it. | (old) | **kept old** · edit: over budget (21 > 20 words); verify*: new words: its |
| 26 | 3:04 | A young woman with red hair stands. | The woman stands. | The woman stands. | **kept new** · all pass |
| 27 | 3:09 | A small tan dragon with a bleeding wing lies on a stone roof. | The small tan dragon lies on a stone roof. | The small tan dragon lies on a stone roof. | **kept new** · all pass |
| 28 | 3:14 ext | A young woman kneels beside a bleeding small tan dragon. | She kneels beside the bleeding dragon. | She kneels beside the bleeding dragon. | **kept new** · verify*: new words: she; shortener-sentence*: out of order |
| 29 | 3:16 | A young woman with short red hair reaches toward a small tan dragon with a bleeding wing on a stone rooftop. | The young woman reaches toward the small tan dragon on the stone rooftop. | The young woman reaches toward the small tan dragon on the stone rooftop. | **kept new** · all pass |
| 30 | 3:24 ext | In the hideout, a young woman with short red hair smiles slightly. A tan-brown creature roars with its mouth wide open. | In the hideout, the young woman smiles slightly as a tan-brown creature roars with its mouth wide open. | In the hideout, the young woman smiles slightly as a tan-brown creature roars with its mouth wide open. | **kept new** · verify*: new words: as; shortener-sentence*: joins two sentences: "the young woman smiles slightly as a tan-brown creature roars with its mouth wide open." |
| 31 | 3:32 | A young woman with short red hair sits cross-legged, cradling a small tan creature in her lap, gently stroking its head as it rests against her. | She sits cross-legged, cradling the small tan creature in her lap and gently stroking its head as it rests against her. | She sits cross-legged, cradling the small tan creature in her lap and gently stroking its head as it rests against her. | **kept new** · verify*: new words: she, and; shortener-sentence*: out of order |
| 32 | 3:42 | A hand dips into a stone bowl, then smooths a dark cloth. | — | (old) | unchanged |
| 33 | 3:49 | A young woman with short red hair kneels beside a glowing pink crystal in a dark, cluttered ruin. | The young woman kneels beside a glowing pink crystal in a dark, cluttered ruin. | (old) | **kept old** · edit: drops a fact: red, hair |
| 34 | 3:56 | The young woman with short red hair sleeps on a bed in the dim ruin. | She sleeps on a bed in the dim ruin. | She sleeps on a bed in the dim ruin. | **kept new** · verify*: new words: she; shortener-sentence*: out of order |
| 35 | 4:02 | The woman sleeps beside the dragon in the ruin. | — | (old) | unchanged |
| 36 | 4:11 | A chicken runs through a sunlit alley. | — | (old) | unchanged |
| 37 | 4:13 ext | A young woman leaps over crates in a dusty warehouse. | The young woman leaps over crates in a dusty warehouse. | The young woman leaps over crates in a dusty warehouse. | **kept new** · all pass |
| 38 | 4:14 | A young woman with short red hair leaps over a cart. | She leaps over a cart. | (old) | **kept old** · edit: drops a fact: red, hair; verify*: new words: she; shortener-sentence*: out of order |
| 39 | 4:19 | A young woman with short red hair runs through the market. | The woman runs through the market. | The woman runs through the market. | **kept new** · verify*: words out of order |
| 40 | 4:32 | A young woman with short red hair stands in the town, her expression shifting as a figure approaches. | She stands in the town, her expression shifting as a figure approaches. | She stands in the town, her expression shifting as a figure approaches. | **kept new** · verify*: new words: she; shortener-sentence*: out of order |
| 41 | 4:39 | A young woman with short red hair is visible. | The young woman is visible. | The young woman is visible. | **kept new** · all pass |
| 42 | 4:43 | The tan dragon, Scales, perches on a beam. | — | (old) | unchanged |
| 43 | 4:46 ext | A young woman with short red hair runs up stone steps. | The young woman runs up stone steps. | The young woman runs up stone steps. | **kept new** · all pass |
| 44 | 4:49 | A young woman with short red hair looks down at a ruined town. | She looks down at a ruined town. | She looks down at a ruined town. | **kept new** · verify*: new words: she; shortener-sentence*: out of order |
| 45 | 4:55 | A young woman with short red hair runs across a ruined stone fortress at sunset as red-winged creatures fly overhead. | Then she runs across a stone fortress at sunset as red-winged creatures fly overhead. | Then she runs across a stone fortress at sunset as red-winged creatures fly overhead. | **kept new** · verify*: new words: then, she; shortener-sentence*: out of order |
| 46 | 5:03 | A woman stands on a rocky ledge. | Now she stands on a rocky ledge. | Now she stands on a rocky ledge. | **kept new** · verify*: new words: now, she; shortener-sentence*: out of order |
| 47 | 5:09 | A young woman with short red hair smiles. | The young woman smiles. | The young woman smiles. | **kept new** · all pass |
| 48 | 5:16 | A young woman with short red hair looks up as dragons fly past at sunset. | She looks up as dragons fly past at sunset. | She looks up as dragons fly past at sunset. | **kept new** · verify*: new words: she; shortener-sentence*: out of order |
| 49 | 5:22 | The dragon soars through pink clouds toward a ruined town where a young woman stands. | The dragon soars through pink clouds toward the ruined town where she stands. | The dragon soars through pink clouds toward the ruined town where she stands. | **kept new** · verify*: new words: she; shortener-sentence*: out of order |
| 50 | 5:29 | The dragon flies toward a reaching hand. | It flies toward a reaching hand. | It flies toward a reaching hand. | **kept new** · verify*: new words: it |
| 51 | 5:33 ext | A young woman with red hair lies prone as a huge dragon looms overhead, then leaps away over broken stone under a dusky sky. | The woman with red hair lies prone as a huge dragon looms overhead, then leaps away over broken stone under a dusky sky. | The woman with red hair lies prone as a huge dragon looms overhead, then leaps away over broken stone under a dusky sky. | **kept new** · all pass |
| 52 | 5:38 | A young woman with short red hair stands amid ruins, eyes wide, mouth open. | She stands amid ruins, eyes wide, mouth open. | She stands amid ruins, eyes wide, mouth open. | **kept new** · verify*: new words: she; shortener-sentence*: out of order |
| 53 | 5:44 | A young woman with short red hair stares forward, her expression shifting from surprise to a fierce, narrowed gaze. | Then she stares forward, her expression shifting from surprise to a fierce, narrowed gaze. | Then she stares forward, her expression shifting from surprise to a fierce, narrowed gaze. | **kept new** · verify*: new words: then, she; shortener-sentence*: out of order |
| 54 | 5:52 | In the desert, a young woman with short red hair clenches her fists. | In the desert, the young woman clenches her fists. | In the desert, the young woman clenches her fists. | **kept new** · all pass |
| 55 | 5:57 | Dusk. The plain of stumps. A young woman with short red hair watches a distant figure on a hill. | Dusk. On the plain of stumps, she watches a distant figure on a hill. | (old) | **kept old** · edit: not a sentence: new list comma after "stumps"; verify*: new words: she; shortener-sentence*: out of order |

### Ending 11:13–12:18 (cues 104–116)

| # | Time | Old (published) | Proposed (DeepSeek v3.2) | Final after guards | Guards |
|---|---|---|---|---|---|
| 104 | 11:13 ext | The red-haired young woman, Sintel, runs through a dark cave as rocks fall around her. | The red-haired woman runs through a dark cave as rocks fall around her. | The red-haired woman runs through a dark cave as rocks fall around her. | **kept new** · verify*: name dropped: Sintel |
| 105 | 11:17 | Darkness. | — | (old) | unchanged |
| 106 | 11:20 | Dim rocky cave on the ledge, gnarled tree roots on the right. | Now in a dim rocky cave on the ledge, with gnarled tree roots on the right. | (old) | **kept old** · edit: over budget (15 > 12 words); fit: estimate 6450 ms > room 5325 ms; verify*: new words: now, in; shortener-sentence*: out of order |
| 107 | 11:25 | A lone figure sits atop a rocky slope beneath a giant tree. | — | (old) | unchanged |
| 108 | 11:30 | The red-haired young woman, Sintel, sits on a cliff edge, head bowed, as small dark shapes fly past distant peaks. | The red-haired Sintel sits on a cliff edge, head bowed, as small dark shapes fly past distant peaks. | (old) | **kept old** · edit: drops a fact: woman |
| 109 | 11:38 | Sintel lifts her head slightly, still seated on the cliff edge. | She lifts her head slightly, still seated on the cliff edge. | She lifts her head slightly, still seated on the cliff edge. | **kept new** · verify*: name dropped: Sintel; shortener-sentence*: out of order |
| 110 | 11:43 | The red-haired young woman, Sintel, winces in pain. | Sintel winces in pain. | Sintel winces in pain. | **kept new** · all pass |
| 111 | 11:47 | Sintel's eyes widen in shock as she stares forward. | Then her eyes widen in shock as she stares forward. | (old) | **kept old** · edit: over budget (10 > 9 words); fit: estimate 4200 ms > room 3825 ms; verify*: name dropped: Sintel; shortener-sentence*: out of order |
| 112 | 11:51 | The red-haired young woman, Sintel, stands on a rocky slope, gazing under a hazy sky. | The red-haired young woman stands on a rocky slope, gazing under a hazy sky. | The red-haired young woman stands on a rocky slope, gazing under a hazy sky. | **kept new** · verify*: name dropped: Sintel |
| 113 | 11:57 | Sintel walks away from the camera toward the misty mountains, white flowers nearby. | She walks away toward the misty mountains, past white flowers. | (old) | **kept old** · edit: not in any shot description: past; verify*: name dropped: Sintel; shortener-sentence*: out of order |
| 114 | 12:04 | Sintel continues walking away, her figure shrinking against the vast, hazy mountains. | Her figure shrinks against the vast, hazy mountains as she continues walking. | Her figure shrinks against the vast, hazy mountains as she continues walking. | **kept new** · verify*: name dropped: Sintel; shortener-sentence*: out of order |
| 115 | 12:10 | The dragon lies on the rocky ground, its wing bleeding, as Sintel walks farther away. | — | (old) | unchanged |
| 116 | 12:18 | Back in the snowy mountains, the dragon lies still on the rocky ground as Sintel walks farther away into the hazy distance. | Back in the snowy mountains, the dragon lies still as Sintel walks into the hazy distance. | Back in the snowy mountains, the dragon lies still as Sintel walks into the hazy distance. | **kept new** · all pass |

### Whole-film counts (127 cues, 6 on-screen text cues frozen; `*` = informational guard, see below)

| Model | Calls | In / out tokens | Spend | Cues changed by model | Kept new | Fail edit guards | Fail pronoun licence | Fail fit (new only) | Fail verify* | Fail shortener-sentence* |
|---|---|---|---|---|---|---|---|---|---|---|
| DeepSeek v3.2 | 6 | 19,196 / 3,706 | $0.0188 | 93 | 63 | 30 | 1 | 13 | 65 | 54 |
| Amazon Nova Pro | 6 | 18,672 / 2,920 | $0.0243 | 71 | 53 | 18 | 2 | 6 | 49 | 48 |
| Qwen3-VL 235B (text only) | 6 | 18,714 / 3,786 | $0.0200 | 84 | 48 | 36 | 9 | 5 | 55 | 55 |
| Mistral Large 3 (earlier guard build, not comparable) | 6 | 20,083 / 3,796 | $0.0157 | 116 | 27 | 89 | 12 | 10 | 106 | 102 |
| Nova Lite (window 1 only, first guard build) | 1 | 3,016 / 730 | $0.0004 | 16 | 11 | 5 | 0 | 2 | 5 | 3 |

DeepSeek v3.2 edit-guard rejections by reason: over budget 11, not in any shot description 5, not a sentence 5, drops a fact 5, says the scene's place again 4

Nova Pro edit-guard rejections by reason: over budget 10, not in any shot description 2, drops a fact 2, says the scene's place again 2, not a sentence 1, name not revealed, not shown in its shots, withheld here, or in no glossary or dialogue 1

published: full look phrase ('young woman with short red hair' and variants) 52×, 'she' 5×
DeepSeek final: full look phrase ('young woman with short red hair' and variants) 18×, 'she' 35×
Nova Pro final: full look phrase ('young woman with short red hair' and variants) 18×, 'she' 21×

`*` informational, not a gate for this pass; see "Guard interaction". "Kept new" = 05b edit guards + pronoun licence + fit all
pass; the cue's start, end and `extended` are unchanged in every row.

## Reproduce

```sh
cd packages/pipeline
set -a; source ../../.env; set +a; export AWS_PROFILE=described-dev
npx tsx spikes/narrative-pass.mts deepseek.v3.2 /path/to/work/sintel 0.45   # third arg: spend cap in USD
npx tsx spikes/voice-sample.mts                                             # Polly A/B files (us-east-1)
```
