# 0007 — Dropped plot events become extended cues

Status: accepted 2026-10-10 (human) — on by default, capped; re-check on the DESC-010 titles
Ticket: DESC-020 · Follows: 0003 (Gate C; DESC-017 result), 0006 (edit pass), DESC-007 (Extended mode on the device)

## Problem

On `sintel-90-210` run A2 (0003, DESC-017 result) both raters called two shots usable *and lost*: 8 "Red-haired girl accepts bowl."
and 24 "Red-haired woman kneels beside bleeding creature on cobblestones." — the bowl handed over and the woman going to the dragon,
the two plot beats of the segment, neither heard. Fit had placed both (`cues.fit.json`: 37.24 s in a 1.75 s pause, 103.67 s in a
3.3 s one); 06-voice measured the Polly clips, found them past their slots, could not shorten a single-clause line, and dropped them
because the text "introduces nothing new" (`introducesNew`: a new person, place or on-screen text). Fit drops shots the same way when no
gap in the window has room. A setting shot can go; an event cannot.

## Decision (human, 2026-10-10)

A shot that cannot be placed — fit finds no room, or voice would drop its clip — becomes an **extended cue** (pause-and-describe,
Extended mode only; 07-mix leaves extended cues out of the AD rendition, so the plain AD track is unchanged) when its description
carries a **new plot event**: a new action by a person or creature, an object handed over, someone arriving, falling, kneeling. Not a
setting, the light, or an expression. **Cap: at most one such added cue per 30 s of title time.** The text is the shot's own
description, shortened only by the existing safe shortener rules; nothing is invented.

### The plot-event test (`packages/pipeline/src/plotEvent.ts`, deterministic)

House style gives a present-tense line with the subject first ("Red-haired girl accepts bowl."), so a sentence carries a new plot
event when it has a **finite action verb**: a word ending in -s whose Porter stem (0006's `stem`) is in `ACTION_VERBS`, with at least
one content word (its subject) before it, and
- the previous voiced cue did not say that verb (by stem): "climbs brick rooftop" right after "climbs stone steps" is not a new event;
- the sentence has no expression or reflection word (eyes, mouth, brow, expression, smile, tear, head, face, reflection …): "opens
  eyes" is a look, "a veiled face emerges from the milk" a reflection, not an act (cost: "a man with a scarred face draws a sword" too);
- no word before the verb is a setting or light noun (dawn, snow, fire, logo, title …): "Dawn breaks over city" is the light changing;
- it is not an on-screen text clause (that has its own rule, `introducesNew`).
Only -s forms count: in "Red-haired girl watches man stir pot over fire" the bare "stir" is what she watches, and watching is not a
plot event. In each clause (cut at , ; and "then") the verb is the *first* -s word after the subject, never a later one (a plural
object: drinks, cuts), never a -ss / -us / -ous / -is word (dress, plus, nervous, his) or an -s function word (across, towards); a clause
after the first carries its sentence's subject over ("A figure walks, falls."). "hands" is a verb only before her / him / them / his /
a / the / it / me / us / you / over / back. A flying verb over scenery (sky, clouds, water, lake, hills, forest …) is the setting: "A bird
flies over the lake." is not an event, "A dragon flies over the city." is — the scenery nouns are open land, water and sky, not places
people are in, so a creature arriving over a town still counts. The verb list (170 bases, `ACTION_BASE_COUNT`) leaves out states and postures (holds, stands, sits, leans), looks and expressions (stares,
watches, blinks, smiles, nods), sounds the film carries (speaks, roars), light and camera verbs (glows, fades), and verbs whose plural
noun is common in descriptions (hands, steps, waves, blocks — "Two hands hold a bowl" is not an event).

Justification on the A2 evidence (`test/sintel-210.test.ts`, `test/events.test.ts`), the nine shots the run did not voice:

| shot | description | event? | why |
|---|---|---|---|
| 5 | Red-haired girl watches man stir pot over fire. | no | "watches" is a look; "stir" is not the finite verb |
| 6 | The woman … blinks slowly, her expression unreadable … | no | expression word; "blinks" not an action |
| **8** | Red-haired girl accepts bowl. | **yes** | "accepts" (object handed over), not in "Old man pours broth." |
| 10 | Red-haired woman opens eyes. | no | "eyes" — a look (and the raters: not shown) |
| 11 | Two hands hold a reddish-brown bowl; a pale, veiled face slowly rises … | no | "hold" a state, "rises" not listed; the Gate C invention stays unvoiced |
| 23 | Red-haired woman in gray tank top stares. | no | a look |
| **24** | Red-haired woman kneels beside bleeding creature on cobblestones. | **yes** | "kneels", not in "Small dragon clutches bleeding wing on stone roof." |
| 27 | Red-haired woman smiles. Scaly beast roars. | no | expression; roaring is audible |
| 28 | Red-haired girl holds book. | no | a state (and the raters: no book) |

Placed shots that would also pass — "Old man pours broth.", "The figure falls prone", "Hand reaches toward small dragon", "She turns …
then walks away" — show the test tracks the beats a describer would keep; "Tent glows.", "Dawn breaks over city.", "Bearded man holds
staff." do not pass. The rule has no model call and no language model: a German title gets no event cues (the verb list and the -s
rule are English), which is a limitation, not a risk.

**Golden list for `sintel-90-210` (run A2): shots 8 and 24 become extended event cues; no other change** — 20 cues as the run
voiced them (shot 19 still the one `introducesNew` extended cue), shot 27 still dropped. Fit adds none: of the six shots fit could not
place (5, 6, 10, 11, 23, 28) none is an event; both event cues are voice's (the clip overran its slot). `test/sintel-210.test.ts`
replays fit and voice from the run's recorded descriptions, gaps, shots, Nova Lite shortenings and measured clips, no AWS call.

### Where it runs, and the cap

- **05-fit**: a shot with no room and `introducesNew` false is a candidate when `plotEvents(description, previous voiced cue)` is not
  empty; its cue is `{ extended: true, event: true }` at the shot start, text = `capExtended(description)` (the safe shortener, 25 words).
  After the pass over all shots, `capEvents` keeps candidates in order of most new action verbs, then most new content words
  (`newWords`), then earliest, each at least `EVENT_SPACING_MS` = 30 000 ms from every chosen one: where two events compete for a window
  the richer one is heard.
- **06-voice**: an overrunning clip that cannot be shortened into its slot, is not `introducesNew`, and whose cue text carries a new
  plot event after the previous *placed* cue becomes an event cue when no event cue — fit's (`event: true` in cues.json) or one added
  earlier in this pass — starts within 30 s of it (first come; voice decides cue by cue). The pause voices the **full cue text** (fit's
  text for the slot; the rest, when on-screen text was split off into its own pause — said once), not the slot shortening: a pause has
  no slot. It starts where the action would have (after the text cue's lead). The original clip is set aside before the slot shortening
  overwrites it, so voicing it again in the pause is a rename, not a third Polly call. "Previous" is the previous placed cue in both
  steps: what the AD track said, whatever the mode.
- **Counted against the cap**: only `event: true` cues, from either step. On-screen text cues and `introducesNew` cues are the existing
  behaviour and stay uncounted.
- **05b-edit** treats an event cue as any extended cue: budget = its own length (no lengthening), its shot counts as voiced (not listed
  under `missedJustBefore` for the next cue), the guards apply, timing never changes.
- **Player** (shared-ui `extended.ts`, unchanged): the cue carries `{extended=1}` in descriptions.vtt; Extended mode pauses on it,
  plays its clip, resumes. DESC-007's device check needs a title with extended cues; `sintel-90-210` now has three.

## Follow-ups in the same change (06-voice, 05b-edit)

- **(a)** No extended cue starts while a placed clip still speaks: fit put a text cue `TEXT_LEAD_MS` before its action and an event
  cue at the shot start from *estimated* ends; after the clips are measured, every extended cue (text, event, introducesNew) moves to at
  least the measured end of every placed cue before it (`afterClips`, re-slotting the clips; an event cue moved to within 30 s of an
  earlier event cue is dropped, so the cap holds), and a text cue split in voice is placed after the measured end of *every* kept clip,
  not only those ending before the cue's start (one may run past it, within the 200 ms tolerance).
- **(b)** `cleanShortening`'s word-count annotation needs whole words: "9 wordsmiths gather" and "raises a sword 2" are text.
- **(c)** Wrapping quotes come off only as a matching pair around the whole reply, or when no on-screen text clause runs to the end of
  the line: the closing quote of `Words appear: “The End.”` is the clause's, and stripping it made the guard reject the edit.
- **(d)** Voice does not say on-screen text twice: a text clause the previous voiced cue said (its action cue and the text cue split
  from it; case, spacing and the closing period aside) is cut from the next cue, the rest voiced; a cue that was only that clause is not
  voiced. On `sintel-90-150-r2` shot 1 now keeps "Logo fades." (the clause's room goes back to the action). The room fit's shortening
  gives a clause voice then removes stays fit's — it cannot know yet which cue is voiced before (follow-up: fit could skip a clause the
  previous *placed* cue has, when nothing between them is dropped).

## Risks

- **Action-verb hallucination.** The test judges the description, not the frames: an action the model invented becomes a pause, as
  the `isNew` heuristic turned 2 of Nova's worst inventions into extended cues in the first Gate C run (0003). On A2 the two
  unvoiced inventions (10 "opens eyes", 11 "face rises") do not pass — as looks/reflections, not because the test knows they are false.
  Faithfulness of descriptions is Gate C's; the cap bounds the damage to one pause per 30 s, never a plain-track change.
- A plural noun that stems to a listed verb: only the first -s word after the subject in a clause is the verb (review M2), so a later
  noun (drinks, cuts, lights) never counts, but a plural subject whose noun stems to a verb ("The lifts open") can; the list drops the
  common ones (steps, waves, blocks), "hands" counts only before her / him / a / the …
- The pause lands at the cue's start: for a voice drop that is fit's placement, up to 1 s after the shot (LATE_MS), as for every cue.
- Voice's cap is first-come, fit's is best-first; a title where voice drops two events within 30 s keeps the earlier one.
- Cost: none in fit; in voice at most one extra Polly clip per event cue.
