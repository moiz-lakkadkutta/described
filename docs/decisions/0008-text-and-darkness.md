# 0008 — On-screen text without the label, trailing modifiers, and "Darkness."

Status: accepted 2026-10-14; on-screen text rule amended by 0013 (2026-10-15: quote only when every word is legible) — pipeline change plus a describe prompt change; **Gate C must be re-checked** with the new prompt
Ticket: DESC-010 follow-ups (docs/titles.md, "Follow-ups from this batch") · Follows: 0003 (Gate C), DESC-017 (text pauses)

## Problem

The five-title batch (2026-10-14) showed three faults, all on tears-of-steel-40-100:

1. d8 voiced `Darkness. in metallic silver, centered.`: the description was `Darkness. Words appear: "TEARS OF STEEL" in metallic
   silver, centered.`; the text clause ended at the closing quote, so when it was split into its own text pause the modifier after
   it stayed behind and was voiced alone, starting with a lowercase word.
2. `Hand holds crumpled newspaper headline: ROBOTICIST CREATES KILLER ROBOTS` was dropped by 06-voice (741 ms over its slot): the
   text was not labelled `Words appear:`, so it was not read as on-screen text and was neither split into a text pause nor kept as
   an extended cue.
3. `Darkness. A mechanical airship … hovers` (d10, d12): a "Darkness." prefix in front of a scene that is visible.

## Decision

Pipeline (`packages/pipeline/src/textClause.ts`, read by 04-describe, 05-fit, 05b-edit, 06-voice and plotEvent):

- A trailing modifier after the on-screen text (the next word lowercase, or `,` `;` `:`) belongs to the clause up to its sentence end,
  so it is voiced in the text pause with the text and never alone; it stops before `and` / `while` / `as` / `then` followed by a
  lowercase word (`Words appear: "NORTH" and a man runs in.` → the rest is `A man runs in.`). The text itself (what "already said"
  compares) is unchanged.
- On-screen text without the label is recognised: a text carrier (headline, caption, title card, sign, banner, poster, screen, note,
  newspaper …; German Schlagzeile, Schild, Aufschrift …) followed by `:`, by `reads` / `says` (bare or quoted), by `shows` /
  `displays` and a quote, or directly by a quote; and anything that `reads "…"`. The clause starts at the latest of the sentence
  start (`. ! ? ; :`), a `, ` or a joining word (as, while, where, and, then, with, that), so the action before it stays on the plain
  AD track as a whole sentence (`A soldier grabs the rifle as a sign reads "EXIT".` → `A soldier grabs the rifle.` and the pause
  `A sign reads "EXIT".`); with nothing between them (`Hand holds crumpled newspaper headline: …`) the whole sentence is the clause.
  A clause that would open with the bare verb (`… the poster that reads "WANTED".`) is said as `Words appear: "WANTED".` (German
  `Text erscheint:`). Bare text ends before `, and …` (`A sign reads OPEN, and a man enters.` keeps `A man enters.`); the modifier
  rule also stops before German und / während / dann / als.
- Not on-screen text (left as plain description):
  - a bare (unquoted) body that does not open with an all-caps word or a digit: `The sign says nothing.`, `He reads the note: his
    hands tremble.`, `Monitors: green waveforms pulse.`, `Monitors: Thom types quickly.`, `Ein Schild: rot und rostig.`;
  - a carrier word after a pronoun subject (he, she, they, it, who; er, sie, es), or "signs", which is a verb: `He signs: thank
    you.`, `The woman signs: I LOVE YOU.`;
  - a cue word with no text after it: `Man reads newspaper`, `A man holds a sign`;
  - an unlabelled body of more than 8 words: `The card says Happy Birthday in gold letters, and a woman smiles at the boy.` stays as
    written. Only a labelled clause (`Words appear:`) that long is dropped as invented text, as before.
- `stripDarkness`: a leading "Darkness." / "Darkness..." / "Darkness," (German "Dunkelheit.") in front of anything else is removed
  and what follows capitalised; a bare "Darkness." is kept; "… Darkness." after the action (a fade to black) is kept. Applied in
  parseDescription, in fit, and to the shot descriptions the edit step reads (so "Darkness." cannot come back through an edit); a
  re-run from fit cleans an existing described.json.

Describe prompt (`packages/pipeline/src/prompts.ts`, `describeSystemPrompt`):

- On-screen text: "(titles, captions, signs, headlines, screens) … quote them verbatim after "Words appear:" — always this label,
  never "headline:" or "a sign reads"." The rule that text is mentioned only when clearly legible and never invented is unchanged.
- Darkness: `Write only "Darkness." when the frames are black and nothing can be made out. If anything is visible, even dimly,
  describe it and do not write "Darkness."; if the scene is visible but dim, say dim (e.g. "A dim room. A fire glows.").` (was:
  `say only what can be made out, e.g. "Darkness." or "Darkness. A faint red glow."`).

## Consequences

- Gate C (0003) was approved on the previous prompt; the darkness example it showed the model is gone. Re-check Gate C (the
  sintel-90-210 rating set) before the next full-length title is described with this prompt (TASKS.md DESC-024).
- Titles already processed keep their described.json; the pipeline fixes reach them on a re-run from fit (no new Bedrock describe
  call). The prompt change reaches them only on a re-run from describe.
- Re-run from fit: tears-of-steel-40-100 (all three faults) and sintel-90-150-r2 ("Darkness. A faint fire glows in a stone pit.").
  Not re-run: sintel-90-210 — a test segment, not in the published catalogue; its "Darkness. A fire pit glows…" prefix is cleaned
  whenever it is next run (its golden fit test already expects the stripped text). The other three published titles only if their
  described.json has a "Darkness. X" prefix (`grep -l '"Darkness\. [A-Z]' work/*/described.json`).
