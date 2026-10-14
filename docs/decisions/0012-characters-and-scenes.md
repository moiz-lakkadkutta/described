# 0012 — Characters and scenes: a title glossary, scene grouping, and a director's voice inside the guardrails

Status: proposed 2026-10-14 (human: "describe characters in context"; voice and guardrails agreed with the orchestrator) — pipeline
change plus a describe prompt change; **Gate C must be re-checked** with the new prompt (one run with DESC-024's)
Ticket: DESC-029 · Amends: 0006 (edit pass), 0007 (dropped events; settings), the PLAN naming rule · Follows: 0003 (Gate C), 0008,
0010 (verify pass), 0011 (sentence guard) · Investigation: the orchestrator's character-context report of 2026-10-14
Baseline: [docs/eval/character-scene-baseline.md](../eval/character-scene-baseline.md)

## Problem

Every shot is described on its own, so the listener cannot follow who is who or where we are:

- **The same person gets several descriptors** (published 2026-10-14): Sintel is "a lone figure", "a figure", "red-haired girl"; the
  shaman "bearded man" then "old man"; Caminandes' llama is "tan llama", "brown llama", "llama" and an invented "orange fox"; in Tears
  of Steel "man in a dark jacket" is young Thom on the bridge *and* the sniper 40 years later.
- **No name is ever voiced**, though two were said inside their segments: "Emo" at 25.1 s in Elephants Dream, but `knownNames`
  dropped it because Transcribe also wrote "emo," at 58.4 s (a lowercase transcription anywhere in the title vetoed the name); and
  "Whatever, Thom." at 2.2 s in Tears of Steel, which Transcribe missed.
- **Places are the first thing cut and the last thing said**: the Sintel hut is never established at its start (its only statement,
  "Tent interior. Fire glows.", was shortened to "Tent glows." 30 s in, which says the tent glows); the Tears of Steel lab is never
  named; 6 of 11 annotated scenes state their place in their first cue, 4 of 7 changes of place or time are signalled.

## Decision

### 0. Scope: scenes for every title, names only with a glossary

Scene build-up — the scene step (§4), fit stating a scene's place (§5) and the edit pass working one scene at a time (§6) — applies to
**every** title, with or without a glossary: it needs only the shot descriptions. Only naming, the listed looks and the glossary's
place words depend on a glossary; a title without one (`pnpm describe` on your own video) voices no name and gets no suggested look.

### 1. A per-title glossary (`characters[]`, `settings[]` in `apps/api/prisma/titles.json`)

Schema in `packages/contracts` (`Glossary`, `Character`, `Setting`), validated by `TitleSeed`. The API does not store it: no screen
or route shows it, and the pipeline needs it for a CLI run with no database, so the pipeline reads titles.json
(`packages/pipeline/src/glossary.ts`; `GLOSSARY_FILE` overrides; a video with no entry — `pnpm describe` on your own file — has an
empty glossary — no names, scenes as for any title — and a loud warning; an evaluation copy such as `sintel-90-210-g10` reads its
source slug's entry).

- Character: `name`, `look` (stable visible descriptors, every detail checked against frames), `short` (a short reference from the
  look, said in place of a name the cue may not use: "the young man in the leather jacket"), `role` (their part in the story),
  `revealedAtS` (segment seconds at which the name is first spoken or shown **inside the segment**; `null` = not revealed inside it),
  `nameEvidence` (the line, subtitle time, caption id or credit). Setting: `name`, `look`, optional `firstAtS`.
- **Names are evidence-only, and only from inside the segment** (the stricter guardrail, review of 2026-10-14). Emo 25.1 s (caption c3
  "Emo,"); Thom 2.2 s (official subtitles "Whatever, Thom. We're done." at film 0:42 = segment 2.2 s). A name said only before the
  segment starts does not count: Celia ("Look Celia…" at film 0:25) is `null`, and so are Sintel (film 7:37, after the segment; the
  "SINTEL" title card names the film, not the figure), Proog, Koro, the shaman and Big Buck Bunny (synopsis, website or credits
  only). Labels such as "the sniper" are not names and are never voiced as one.
- **A name is bound to its look.** A revealed name may be used only for a figure whose shot descriptions match that character's look
  (the same matching as the evaluation's descriptor assignment: same kind of noun, most look words shared, ties broken by the clause —
  "man in dark jacket aims rifle" is the sniper, not Thom). The describe prompt says "only if the person visible matches this look,
  call them Thom"; the edit guard and the final grounding pass reject or replace a name on a cue whose shots do not show that person.
- **Voice (the human's request): `look` and `role` are written as a film director would introduce the character to the audience —
  vivid, story-aware, short** ("a bald old man with a long nose, in a long brown coat and a red tie"; "the old man leading Emo through
  the machine, insisting that everything is safe").
- **Guardrails (the orchestrator's challenge, accepted by the human): only what a sighted viewer can see, or has been told by that
  point; no inner thoughts, intentions or later plot; no name before it is revealed inside the segment; a role is never voiced.** The
  describe prompt therefore gets the look always and the name only once `revealedAtS` has passed at the shot's start — never the role.
  The edit pass sees the role only as `background` to choose what matters, with the rule "never use its words", and its guard rejects
  role words.

### 2. Describe prompt (`prompts.ts`, `describeSystemPrompt`; the only describe change)

With a glossary, the prompt ends with "People and places in this film. Use these words when one of them is visible; never give a
listed look or name to anyone or anything else:" — each person by look ("… (not named yet: describe by this look, never by a
name)") or, once revealed, "<look>: only if the person visible matches this look, call them Emo (the first time: "the thin young man,
Emo"); never give this name to anyone else."; each place by name and look. No roles. The naming rule now reads "Name a
character only when the list below gives the name or the dialogue has said it; otherwise refer to a listed person by their look from
the list, and to anyone else by one short visible descriptor", and scene changes "use the listed places' words". `knownNames` is the
glossary's revealed names plus the dialogue's, and the verify pass (0010, guard 3) keeps them. Without a glossary the prompt is
byte-identical to main's prompt at e02cf2b (a test pins it to a stored copy). The describe cache key changes for the five titles
(expected).

### 3. `knownNames` (04-describe)

Judged on the words heard before the shot only; a lowercase transcription vetoes a name only when it was heard before the first
capitalised one, or at least as often (`lowercaseVeto`): "Emo, … Emo. … emo," keeps Emo; "Hello there Hope. I hope so." still has no
name.

### 4. Scene grouping — a new text-only step `scenes` (`steps/04c-scenes.ts`, after describe and its verify pass 04b)

One Nova Lite Converse call (forced `emit_scenes` tool, then plain JSON once; temperature 0, topK 1) over the shot descriptions and
the glossary places groups consecutive shots into scenes and names each scene's place. Guards: the scenes cover every shot once, in
order; a label may only use words of that scene's descriptions or of the glossary places (else the deterministic label, logged). A
failed call or invalid reply uses the deterministic grouping (place-word and glossary-setting overlap, time jumps — "Night.",
"… LATER"). Cached per request in `{work}/cache/scenes/`; writes `scenes.json` (shots, label, matched glossary setting, `returning`,
the label's evidence, and a hash of the described.json it grouped). In `STEPS` between describe and fit; the worker's fit job runs
it before fit, and fit itself runs it when `scenes.json` is missing or was grouped from another described.json, so a CLI
`--from fit` re-groups instead of reusing a stale file. (A first iteration without the prompt change can therefore be tried
`--from fit` on Sintel and Tears of Steel — scenes, fit, edit, voice — without a describe call or a Gate C re-check; names still need
the new describe prompt.) Per-scene establishing calls to Qwen3-VL (option B of the investigation) are deferred.

### 5. fit (amends 0007: a scene's setting is no longer always droppable)

- A scene's own opening setting statement ("Snowy mountains.", "Dark room.", "Tent interior.") is **protected**: the rest is shortened
  beside it; when only the statement fits it is kept alone unless the rest carries a plot event — **an event still outranks the
  setting**.
- A scene's first cue that does not say where we are gets the scene label in front ("The tent. A faint fire glows in a stone pit.";
  "Back in the lab." on a return) when the words fit.
- Later in the scene, a shot's own setting statement is not said again; a shot that is only that statement is not voiced (its slot goes
  to the action: "Fire glows.").
- **Extended mode only:** a scene in which no cue says where we are gets one short scene pause (`scene: true`, the scene label), at
  most one per title-minute (60 s apart), never inside an earlier shot's cue, never after the scene ended. When an event or other
  pause of the scene already starts there, the place is said first in that pause instead of a second pause; a scene pause on the same
  start as another pause sorts first. Not counted against 0007's event cap; the plain AD track is unchanged.
- The "Tent glows." fault is fixed in the sentence guard (0011): check 2a, **one source sentence per clause** (`joinsSentences`,
  every language) — a clause of a shortening takes its words from one sentence of the original, except that a sentence opening with a
  subject pronoun refers back to the one before ("Old man sits. He holds a staff." → "Old man holds a staff." passes).

### 6. Edit pass (amends 0006)

- **One window per scene** (a scene of more than 30 cues is split), not blocks of 30 cues.
- The request carries the scene (place, the place's look, whether it returns, whether its place was said as heard so far), the people
  (look always; name and `namedFrom` once revealed; the role as `background` only) and per cue `mayName`. New rules: say the place once, at the scene's first action cue,
  when the words fit ("Back in …" on a return), never twice; names only where `mayName` allows ("the bald old man, Proog" the first
  time); and **the voice: guide the listener through the story as a film's describer would — connective ("Back in the lab, the
  man…", "then"), choosing what matters to the story, in the film's tone — never what anyone thinks, wants or feels, never a hint of
  what happens later, nothing not visible.**
- **Grounding guard.** `applyEdits` rejects an edit that adds a name not revealed by the cue's start (glossary `revealedAtS` or the
  dialogue: `spokenNames`), not shown by look in the cue's shots, or in no glossary or dialogue — a capitalised word that one of the
  cue's own shot descriptions says (a dropped shot it absorbs included) is grounded there — or that says the scene's place again
  (judged on the edits accepted so far, in cue order). `unfaithfulWords` takes the glossary as evidence only where it applies: a
  character's look and short reference only when the cue's shots show that character, the name once revealed as well, the place only
  of the cue's own scene, never a role. After the edits, every final cue is checked: a glossary name used before it is revealed, or on
  a cue whose shots do not show that person, becomes the character's `short` ("Emo blinks." before 25.1 s → "The thin young man
  blinks."), never inside on-screen text.
  `edit.json` gains `evidence` per cue — its names (glossary with `revealedAtS` and `nameEvidence`, or dialogue with the time) and
  place words (a description's shot, the scene label's evidence, or the glossary), and any unbacked word — as the SDH speaker tags
  record theirs (#39, 0008). A capitalised word no glossary or dialogue backs is rejected in an edit and listed as `unbacked` in a fit
  cue (a proper noun of a thing, "the Eiffel Tower", is not rewritten).

## Guideline citations

- Netflix Audio Description Style Guide v2.5 (https://partnerhelp.netflixstudios.com/hc/en-us/articles/215510667-Audio-Description-Style-Guide-v2-5):
  §1.2 who / when / where — characters unnamed until introduced through dialogue or plot point, descriptor before a first name ("a
  bearded man, Jack"), known relationships once revealed, location and time when relevant; §1.4 consistency — word choice, character
  qualities and locations consistent for the whole content, with a glossary of common descriptors; §5.2 shot changes — indicate where
  the action is when the change matters; §5.4 passage of time — address time shifts and flashbacks by their visual cues.
- DCMP Description Key — What to Describe (https://dcmp.org/learn/618-description-key---what-to-describe) and How to Describe
  (https://dcmp.org/learn/617-description-key---how-to-describe): identify characters consistently by name once given; start
  generally, then details; convey scene changes; describe, do not interpret.
- Creative description: L. Fryer, *An Introduction to Audio Description: A Practical Guide* (Routledge, 2016), on description that
  serves the film's storytelling; A. Walczak and L. Fryer, "Creative
  description: The impact of audio description style on presence in visually impaired audiences", *British Journal of Visual
  Impairment* 35(1), 2017, pp. 6–17 — a more creative, film-aware style raised presence and was preferred by many listeners. The
  voice here takes that tone; the guardrails above keep the Netflix / DCMP objectivity rules (no interpretation, no foreshadowing).

## Consequences

- **Re-run** all five titles from describe (prompt change), and **re-check Gate C** with this prompt (one run covers DESC-024 and
  this; owned by the DESC-024 session). The Gate C segment `sintel-90-210` is not in titles.json, so its glossary is
  `docs/eval/gate-c-glossary.json` (Sintel, the shaman, Scales — named at film 3:48, after the segment — and the snowy mountains, the
  tent and the town, checked against the run's frames). `pnpm gate-c run` (DESC-030) includes `scenes` in its steps and passes the
  SOURCE slug's glossary (titles.json, else that file) to every step, so no `GLOSSARY_FILE` is needed.
- Metrics and baseline: docs/eval/character-scene-baseline.md (`pnpm eval-context`). Hard gates: 0 invented and 0 premature names;
  no misbound name (checked against the frames by the raters). Targets: Emo and Thom voiced (on shots that show them); one descriptor (+ name) per
  character; ≥ 90 % of scenes state their place in their first cue; every change of place or time signalled; 0 repeats; Extended
  mode at most one scene pause per title-minute.
- Risks: a listed look applied to an unlisted extra (the prompt says "when one of them is visible"; raters watch for it); a wrong
  scene grouping spreads a wrong label across a scene (the label must be grounded; the fallback is deterministic); a short look in
  place of a premature name can lengthen a cue past its slot (06-voice shortens or drops it as for any overrun); the director's voice
  may drift toward interpretation (the guard rejects new words, and raters judge the tone); Polly pronunciation of Proog / Celia
  (ACB guidance; a lexicon is a follow-up).
