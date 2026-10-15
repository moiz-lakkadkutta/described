# 0017 — The narrative pass: one connected narration, guarded

Status: accepted 2026-10-15 (human approval of the spike, PR #78; this re-opens quality work after 0016 "Quality work stops", by
the user's decision on 2026-10-15) · Upgrades: 0006 (scene edit pass) · Keeps: 0009, 0010, 0011, 0012, 0015, 0016 ·
Spike: [docs/spikes/narrative-pass-sintel.md](../spikes/narrative-pass-sintel.md)

## Context

On full-length `sintel` the user said the description "does not feel consequential, like each description is independent of each
other… make it like a wildlife documentary." Every shot is described (0003), verified (0010) and placed (0009) on its own, so the
script is a list of observations: the full look "a young woman with short red hair" 52 times in 127 cues, "she" 5 times. The 05b
edit pass (0006) had a continuity mandate but, on Nova Lite with a forced tool, only removed repeats. The spike found DeepSeek v3.2,
with the 05b guards plus three new ones, keeps about half of the cues it rewrites and cuts the look phrase from 52 to 18.

## Decision

1. **05b becomes the narrative pass** (same step, same files: `cues.fit.json` → `cues.json`, `edit.json`). One Converse call per
   scene window (≤ 30 cues). Per cue the model sees its text, `sources` (the verified descriptions of the shots it covers, dropped
   ones included), `mustStillSay` (05b `factWords` minus the carried look, below), `maxWords` (fit's room at the voice's rate),
   `mayName` (glossary reveal times and `unnamedIn` windows, and the dialogue) and `newScene` (its place, `returning`); per window
   the glossary looks and short forms (never roles) and the last 6 cues as heard. **No synopsis and no dialogue**: "story so far"
   is only what the viewer heard, so nothing leaks what happens next or what anyone wants.
2. **Model:** `deepseek.v3.2` on Bedrock us-east-1 (on-demand; no inference profile — `aws bedrock list-foundation-models`,
   2026-10-15). **Fallback:** `amazon.nova-pro-v1:0`, asked once when the DeepSeek call fails or its reply is unreadable.
   `EDIT_MODEL_ID` and `EDIT_FALLBACK_MODEL_ID` override (an empty fallback turns it off). The over-budget shortening call stays on
   Nova Lite (`EDIT_SHORTEN_MODEL_ID`). **Plain JSON reply** (`{"cues":[{"cue":n,"text":"…"}]}`), not a forced tool; a reply cut
   off at `maxTokens` keeps each whole `{"cue":n,"text":"…"}` it holds (lenient parse).
3. **Narrative licence** — the only new freedom, each with a deterministic check (`src/narrative.ts`):
   - **Pronoun licence.** A new she / he (one the cue's old text did not have) needs its referent — a noun of that gender or a
     glossary name — in one of the last **2** action cues as heard, starting **≤ 20 s** before, in the **same scene**, or earlier in
     the same cue; one candidate only (a plural or two glossary characters of that gender nearby reject it); and the cue's own shots
     must show someone of that kind. A new "it" must stand for a non-person word the rewrite dropped that those 2 cues said
     ("The dragon flies…" → "It flies…" after "The dragon soars…").
   - **Carried look.** A glossary character's look words (minus generic words and **minus place words**) count as already said once
     an earlier cue of the same scene, as heard, said one of them with a reference to the character (kind noun, pronoun, name), and
     only while the rewrite still refers to that character. A glossary name the scene has said carries the same way ("She
   stands…" after "Sintel turns…"), and "red-haired" counts as "red hair". Never at the scene's first mention. `mustStillSay` leaves the same words
     out, so the request and the guard ask for the same thing.
   - **"now", "here"** are free. **"still", "again", "meanwhile", "later", "night" ("night falls")** are facts: they trace to the
     cue's own shot descriptions or its old text, never to the previous cue, the glossary or the scene label.
4. **Guard order** (`applyEdits`, per cue, in cue order; the first failure keeps the old text): known index, one window, once → one
   line → not an on-screen text cue → text clauses verbatim → names (revealed, bound, not withheld, not invented) → **pronoun
   licence** → **source-only words** → faithful (every content word in the cue's shots, its own and the previous cue's text; free
   words and licensed she/he left out) → another scene's place → the scene's place said again → keeps facts (minus the previous
   cue's words **as heard** and the **carried look**) → `editReadsAsSentences` (no new list comma — the comma closing a sentence-opening place phrase, "Back in the
   town,", is not one —, not only a subject, not only a
   place) → budget. An over-budget rewrite gets one Nova Lite shortening, then the same guards. After every window:
   `dropRepeatedLeads`, then the **name grounding pass on every final cue** (premature and unbound names → look, `unnamedIn` →
   neutral reference) and the per-cue evidence (0012) — so a free rewrite can never voice "Scales" in 315–331, 483.7–684.4 or
   724–745 s, or "Sintel" before 457.8 s. Later steps are unchanged: 06-voice `polishCue` (0015) and `shortenKeepingAction`
   (0011's sentence rules on any shortening) run on the rewritten text, and on-screen text cues are never dropped (#59).
5. **Deletion-only checks do not judge the rewrite.** verify's no-new-word check (04b `checkVerified`) and fit's shortener sentence
   check (0011 `readsAsSentences`: content words in the original's order) are deletion-only by design: every pronoun, connective
   or reorder fails them. They run before this step (describe → verify, fit) on the sources the pass is held to, and **are not
   run on text the pass produced**. Only those two are skipped, and only for that text. `editReadsAsSentences`, `polishCue` and
   06-voice's sentence-keeping shortener still run on it.
6. **Place false alarm fixed.** The spike rejected four cave cues (77, 84, 95, 99) as "says the scene's place again" on article-only
   changes: the baby dragon's look ("curled up asleep in the dark cave") made "cave" a carried look word, so the old text lost its
   place. Place words never carry; a regression test replays the four cues from the published cave scene.
7. **Gate C packets** show the cue heard just before each voiced cue ("context only"), and RUBRIC.md tells raters to use it to see
   who "she" is while judging the cue against its own shot.
8. **Cost.** DeepSeek v3.2 $0.62 / $1.85 per 1M tokens, Nova Pro $0.80 / $3.20 (AWS Price List API, 2026-10-15). `estimateUsd` now
   includes the narrative pass (≈ $0.0013 per minute, the spike's full-length Sintel) and verify (≈ $0.020 per minute, 0010).

## Voice (same PR, user decision 2026-10-15)

Descriptions are voiced by **Polly Ruth, generative engine**: `--voice Ruth --engine generative` (`resolveEngine`: `--engine`,
else `POLLY_ENGINE`, else generative for Ruth, else neural; the worker derives it from the title's stored voice). Ruth generative
measured 2.79 file words/s against Joanna neural's 3.05, so fit's `WPS` and 05b's `EDIT_WPS` are scaled by 0.915 for it (2.44 and
2.01 words/s; `src/voiceProfile.ts`). A generative clip's SSML has no `<prosody>` (supported there only around full sentences;
rate 100 % changed nothing) and keeps the 150 ms `<break>`; the sidecar records the engine, so a changed engine re-voices.
Polly generative is $30 per 1M characters (neural $16). Region unchanged (eu-central-1 has Ruth generative).
Docs: https://docs.aws.amazon.com/polly/latest/dg/generative-voices.html ·
https://docs.aws.amazon.com/polly/latest/dg/supportedtags.html · https://docs.aws.amazon.com/polly/latest/dg/prosody-tag.html ·
https://docs.aws.amazon.com/polly/latest/dg/API_SynthesizeSpeech.html · https://aws.amazon.com/polly/pricing/

## Consequences

- The pass can only improve a cue or leave it alone: a cue that fails any guard keeps fit's text; timing never moves.
- Gate C must be re-checked before the five catalogue titles ship with it (the spike's plan: `sintel-90-210` and `tos-390-510`,
  edit → voice on copies). The held-out clip has several men; the pronoun licence's one-candidate rule is where it can mislead.
- Raters may see thinner lines where the carried look dropped a fact the scene already said ("ruined", "farther").
- Docs: https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html ·
  https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html · https://aws.amazon.com/bedrock/pricing/
