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
empty glossary — no names, scenes as for any title — and a loud warning; an evaluation copy named `<source>-g<n>` such as
`sintel-90-210-g10` reads its source slug's entry, a sibling title such as `tears-of-steel-40-100-de` does not).

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
  A revealed name the describer itself wrote in one of the cue's shot descriptions is bound (it saw the frames and the look-bound
  list: "The old man pulls Emo." keeps Emo); the look test applies to a name that fit or the edit pass adds. A name the dialogue has
  said by the cue's start is kept whatever the binding.
- **Voice (the human's request): `look` and `role` are written as a film director would introduce the character to the audience —
  vivid, story-aware, short** ("a bald old man with a long nose, in a long brown coat and a red tie"; "the old man leading Emo through
  the machine, insisting that everything is safe").
- **Guardrails (the orchestrator's challenge, accepted by the human): only what a sighted viewer can see, or has been told by that
  point; no inner thoughts, intentions or later plot; no name before it is revealed inside the segment; a role is never voiced.** The
  describe prompt therefore gets the look always and the name only once `revealedAtS` has passed at the shot's start — never the role.
  The edit request carries no role either, and the edit guard rejects role words.

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
  (look always; name and `namedFrom` once revealed; never the role) and per cue `mayName`. New rules: say the place once, at the scene's first action cue,
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

## Amendment 2026-10-15 — Gate C g10 failures (DESC-029 follow-up)

Evidence: the combined Gate C run `sintel-90-210-g10` (this decision's prompt with DESC-024's, the 0010 verify pass on) scored
**14 / 29 = 48.3 %** (3 blind raters, majority; bar 21 / 29). The verify pass improved faithfulness; most failures came from the scene and
setting path. The held-out `tos-390-510-g10` (no glossary) had no scene-fragment failure, but the same late-pause bug (shot 13, 1397 ms)
and a "Towering." lead. Both runs are replayed offline in `packages/pipeline/test/gate-c-g10.test.ts` (recorded scene reply, recorded
Nova Lite shortenings, recorded edits; no AWS call).

| Failure | Root cause | Rule now |
|---|---|---|
| "In the tent." voiced for shots 4, 5, 7, 8 (blade, ladle pour, bowl lost) | the shots' descriptions open "In the tent, …"; fit's clause cut (`shortenDeterministic`) kept only that phrase for 3-word slots, and `readsAsSentences` check 3 failed open on it (a word from a verbless clause) | **fit keeps the shot's action**: a shortening must keep a verb of its description (`keepsAction`, sentenceGuard); else the next-best — one of the description's own sentences with a verb, shortened under the same checks (shot 27: "A small tan dragon roars.") — else no placed cue (an event or extended cue, or none, as before). **Check 4** (English, every caller): a sentence that is only a prepositional phrase ("In the tent.", "Back in the lab.") is rejected, and so is a verbless text of only place and light / condition words ("The tent.", "Tent interior.", "Night. A rooftop.") when the source has a verb. Other verbless noun phrases stay acceptable — the tos raters passed "Man with dark hair, eyes closed, …" and 06-voice's "Dark, rope-laced industrial shaft."; the check newly rejects none of tos-390-510-g10's final cues. Later in a scene whose place was said, the description's opening place phrase is removed before fitting (`withoutPlacePhrases`). |
| "The tent." scene pause over a close-up (shot 10) | Nova Lite split the tent into two adjacent scenes (2–9, 10–13), so the second "had no cue stating its place" and got a place-only pause | **A place is never a cue on its own.** The scene's place is merged into one sentence with the action — "In the tent, a faint fire glows …", "Back in the lab, …" (`withPlace`) — or dropped when there is no room; a shot's own setting sentence is no longer kept alone. A scene pause says the place with the action of the shot under it (that shot's event has priority), and there is none when that shot is voiced or has no action. **Adjacent scenes in the same place are one scene** (unless the second opens with a time jump). Without a glossary, the place is said over a shot only when its words are in that shot's description or in two of the scene's (`placeKnown`), so tos does not get "In the tower," from shot 13's clock tower. |
| "Dim." lead (shot 2), tos "Towering." | shot 2: the describer wrote "Dim." as its own sentence (0009's "say dim"); tos: the deterministic fallback label took "towering" (Porter stem "tower", a place noun) and fit put it in front | `stripBareLead` removes a one-word light / condition sentence ("Dim.", "Dark.", "Towering.") before the rest (describe, fit, edit); "Night." and "Darkness." stay. `placeStems` ignores -ing / -ed forms. |
| "Darkness." over a sunlit walled town (shot 14) | the describer's own reply: shot 14 is the second part of a split camera shot (a fade from black); its six key frames measure YAVG 0, 0, 107, 152, 139, 126, and Qwen3-VL answered "Darkness." anyway. Nova Lite then labelled the scene "darkness", which `groundLabel` accepted because the description has the word. The 0012 prompt does not mention darkness; #47's line ("Write only "Darkness." when the frames are black and nothing can be made out") was not followed, not the cause | **A label is a place noun phrase** (`placeLabelProblem`): a place noun (or a glossary setting word), no verb, not only light / time / condition words ("darkness", "dim", "night"); otherwise the fallback label under the same rule, else none. **Describe**: a "Darkness." reply while some key frames are not dark (mean luma ≥ 40, ffmpeg `signalstats`) is asked once more with those frames only, and used when it is not "Darkness." again. This needs a describe re-run: the offline replay still has shot 14's recorded "Darkness." |
| Late extended cues (g10 shots 19, 24: 1575 / 1025 ms; tos shot 13: 1397 ms) | an extended or event pause may not start inside an earlier shot's placed cue (0009), so it started after shot 18's / 22's long estimated cue, past its own shot end + LATE_MS; nothing checked lateness. The scene-pause folding was not involved | **No pause starts more than LATE_MS after its shot ends.** fit keeps the pause at its estimate; 06-voice moves a pause that would be late to max(its shot's start, the measured ends of earlier shots' placed cues) — earlier as well as later — then an event pause still late shortens the placed cue that blocks it, and only then is dropped; a pause that is only on-screen text is never dropped (DESC-017). The check runs whether or not anything moved. Placed cues already never overlap (an extended cue pauses the film). |
| Shot 28 "inside the tent" (a stone den, in the town scene) | the describer's own draft (verify kept it): with the glossary's places in the prompt, Qwen3-VL named the listed tent for a fire-lit den. Not a carried "Back in …", not the edit pass | **A place word is grounded in its own scene**: a description's place phrase naming another scene's place (another scene's label or a glossary setting name, not this scene's) is removed before fit and the edit pass read it (`groundedDescription`, `foreignPlaceStems`), and the edit guard rejects an edit that adds one ("another scene's place: tent"). |
| Cue 2 edit rejected "drops a fact: s" | `contentWords` stripped the curly ’ as punctuation: "tent’s" became "tent" + "s" | Apostrophes and quotes are normalised (`normalizeQuotes`) before every guard tokenises: contentWords (05b-edit, glossary evidence), fit's `preservesFacts`, sentenceGuard, plotEvent, glossary mentions. |

Also: a cut that keeps "while" / "as" / "who" … but drops that clause's verb is rejected (**check 2c**, `danglingClause`: the replay's
25-word cut of shot 5 ended "… while a young woman with short red hair."). #56's `cutsNeutral` is unchanged and runs first; "Words
appear." kept whole is still accepted.

Replay (offline, recorded responses; fit → edit → 06-voice with Polly faked and the run's recorded clip lengths, 282 ms a word + 781 ms
for a text the run did not voice): g10 no longer voices "In the tent.", "The tent.", "Dim." or "A woman with red hair."; every cue starts
within LATE_MS of its shot; shots 19 and 24 are voiced on time (92174 ms, 132 ms after shot 19; 103046 ms, inside shot 24, still its
plot-event pause); shot 27 is "A small tan dragon roars."; shot 8's "A young woman … accepts a bowl from a figure." becomes its event pause. Shots 4, 5 and 7 are not voiced in the replay: their 3-word slots need a model shortening that keeps the verb ("Man grips
staff."), and the recorded Nova Lite replies were for the old text — a live run decides. Voiced shots: g10 18 of 29 (was 22), tos-390-510-g10 26 of 31 (was 26). tos keeps shot 13 (now on time, 50784 ms), loses the "Towering."
lead, and keeps its action-label pauses (shots 7 and 29).

Consequences: the Gate C re-run is from **describe** (the darkness re-ask changes shot 14; `stripBareLead` and the place grounding are
deterministic and also apply from fit), on `sintel-90-210` and the held-out `tos-390-510`, rated as before.

### Review round (2026-10-15)

- **Late pauses are moved, not dropped, in fit** (above). Tests: g10 shots 19 and 24 and tos shot 13 voiced on time with the recorded
  clips; shot 24 keeps its plot event; the not-moved path; a text cue is never dropped.
- **An action label stays a pause.** A scene label Nova Lite gave that is grounded but names no place ("Man in glasses shouts") is kept as
  the scene's `action`: when the shot under the scene's start is not voiced, the label keeps that shot's action and reads as a shortening
  of its description, it is the pause it was before (tos shot 29, passed by its raters).
- **`keepsAction`**: a plural noun after "preposition + word", in a sentence that already has a verb, is not a verb ("near organ pipes",
  "on stone steps"; "Man in glasses shouts" keeps its verb). Verbs match by stem in the shot's own description; a synonym does not count
  (a shortening only removes words).
- **Where the shot's own setting sentence alone used to be voiced**, fit voices the shortest sentence of the rest that keeps its action.
  tos shots 15, 22 and 24: fit's text is the same as the recorded run's cues.fit.json; their shorter voiced forms came from 06-voice's
  overrun shortening, which is unchanged — the offline replay's clip estimate is too short to reproduce it.
- **Packets** rate fit's grounded description for a shot that is not voiced (docs/evaluation.md); **`gate-c score`** also prints, for
  information only, voiced-usable / voiced, the shots not voiced and the plot events lost. g10 as rated: voiced-usable 10 / 22 =
  45.5 %, 7 shots not voiced, 3 plot events lost (shots 3, 11, 28).

### Review round 2 (2026-10-15)

- 06-voice: a pause moved earlier only considers EARLIER shots' clips (free time, blocker); if that point is inside a later shot's clip
  it stays where it was, and only an earlier shot's cue is shortened for an event pause — a later shot's cue never is.
- fit's fallback (`actionSentence`) takes the FIRST sentence with an action that fits, not the shortest, so a side detail ("Smoke rises.")
  never wins over the main action.
- packet.json records `voicedShots`; `score` reads "not voiced" from it, falling back to the raters' "On time: n/a" for older packets.

### Review round 3, g11 (2026-10-15)

Evidence: the re-gate from describe still failed — `sintel-90-210-g11` 19 / 29 (bar 21; 9 shots not voiced, 5 plot events lost) and the
held-out `tos-390-510-g11` 20 / 30 (6 not voiced, 2 plot events lost). Four faults traced to fit, 06-voice and the sentence guard, each
replayed offline from the g11 artefacts in `packages/pipeline/test/gate-c-g11.test.ts` (recorded scene reply, recorded Nova Lite shortenings,
recorded clip lengths; no AWS call).

| Failure | Root cause | Rule now |
|---|---|---|
| tos 29 "In the Cluttered tech lab, man with glasses shouts, … in a cluttered tech lab." | fit's **scene pause** (`scenePauses` → `placedAction` → `withPlace`): Nova Lite's label is sentence-case ("Cluttered tech lab"); `withPlace` put "the" before it without lower-casing, and never checked that the action already says the place (fit's own merge did; the scene pause did not) | **`placeLead`** (sceneSetting): the label lower-cased (unless its first word is a name or all capitals); its own article kept; "the" for a single place noun, a glossary setting or a return; none for a plural head ("In cathedral ruins"); else "a" / "an" ("In a cluttered tech lab"); "on" for a surface ("On a stone balcony"). **`withPlace` returns an action that already says the place unchanged** (statesPlace on the label's place nouns), so no caller can say it twice. tos 29's pause is now its own description |
| tos 22 "Dark, rope-laced industrial shaft." from "Dark, rope-laced industrial shaft; man in black jacket adjusts device." | **06-voice's overrun shortening** (`shortenSentences`) popped the last clause, the only one with a verb; the guard's check 3 failed open (a word from a verbless clause) | **`shortenKeepingAction`** (05-fit, used by 06-voice's overrun shortening, its text-split rest and afterClips' on-time shortening): the deterministic shortening only when it keeps a verb of the text (keepsAction); else fit's `actionSentence` — which now also takes a clause after a semicolon as a sentence ("Man in black jacket adjusts device."); else the text unchanged, so voice makes it a pause or drops it, never a setting-only cue |
| Sintel 12 "Man speaks, tent." from "Old man speaks, dim tent." | **fit's deterministic shortener** (Nova Lite's "Man speaks. Tent dims." was rightly rejected, "dims" is a new word — that is the line in the fit log): `shortenPlain` dropped both listed adjectives, leaving a bare noun after the comma; the guard accepted it (the comma was the original's). Not the edit pass, not voice, not `stripBareLead` | `shortenPlain` keeps an adjective that opens the last words of a clause ("…, dim tent."); **check 6** rejects a shortening whose sentence ends on a one-word clause after a comma that was longer in the original; and later in a scene whose place was said, fit drops a trailing verbless clause naming that place (`withoutTrailingPlace`, like `withoutPlacePhrases` for an opening phrase). Shot 12 is "Old man speaks." (the slot held 4 words) |
| Articles: "Man holds staff." (Sintel 4), "Small tan dragon bleeds on rooftop." (22), "… climbs rooftop" (19) | **Not a shortening fault**: the describer wrote them without articles (described.json, kept by verify: "Old man holds staff; young woman watches.", "Small tan dragon bleeds on rooftop."); fit only dropped "Old" from shot 4. For 19 the edit pass did propose "…, in a grey tank top and brown trousers, climbs a rooftop." and `editReadsAsSentences` rejected it as a "new list comma after trousers" | **Check 7**: a shortening (Nova Lite's or the deterministic one, fit or 06-voice) that leaves out a / an / the while keeping a later word of its phrase is rejected ("Dragon roars." from "A small tan dragon roars."; any article stands for any). The edit guard allows a comma right before the verb when an earlier comma opened the phrase it closes. A missing article in the describer's own text is the describe prompt's to fix (owned elsewhere); shortening neither invents nor drops one |
| (item E) verbless lines | the guard's check 3 fails open; check 4 only stops a place alone | **Check 5** (English): a sentence of a shortening with no verb, cut from a sentence of the original that has one, is rejected. A sentence the describer wrote without a verb ("Snowy mountains.") stays acceptable, kept whole or shortened; the describer's own verbless descriptions are not judged here |

This reverses one line of the 2026-10-15 amendment: 06-voice's "Dark, rope-laced industrial shaft." (passed on g10, failed on g11) is now
rejected by check 5. Sweep of every recorded shortened or edited final cue in the test fixtures (g10, g11, A2, r2; 61 cues): checks 5–7
flag g11 "Man speaks, tent." and "Dark, rope-laced industrial shaft." (both runs), g10 "The woman with red hair." (an edit) and tos-g10
"Man in blue and yellow gear swings near organ pipes." (drops "A"); nothing else.

Replay (fit → edit → 06-voice offline; the recorded clips, 282 ms a word + 781 ms otherwise; tos shot 22's 10-word clip, replaced in the
run, taken as 5100 ms / speech 4950 from its 4-word remnant's 2616 ms, which reproduces the run's shortening):

| Clip | Shot | Before (replay = run) | After |
|---|---|---|---|
| sintel-90-210-g11 | 12 | Man speaks, tent. | Old man speaks. |
| tos-390-510-g11 | 22 | Dark, rope-laced industrial shaft. | Man in black jacket adjusts device. |
| tos-390-510-g11 | 29 (scene pause) | In the Cluttered tech lab, man with glasses shouts, then looks up, surrounded by glowing green and purple displays in a cluttered tech lab. | Man with glasses shouts, then looks up, surrounded by glowing green and purple displays in a cluttered tech lab. |

No other voiced cue changes in either replay (19 and 24 cues). Shots 4, 19 and 22 of Sintel are unchanged: their missing articles are the
describer's. Consequence: these are deterministic fit / voice / guard changes, so a re-gate can start **from fit** on the g11 copies; the
article and capitalisation fixes at describe and the cue polish (another session) need a describe re-run.
