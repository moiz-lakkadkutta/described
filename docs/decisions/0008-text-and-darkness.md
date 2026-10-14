# 0008 — On-screen text without the label, trailing modifiers, and "Darkness."

Status: accepted 2026-10-14 — pipeline change plus a describe prompt change; **Gate C must be re-checked** with the new prompt
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
  so it is voiced in the text pause with the text and never alone. The text itself (what "already said" compares) is unchanged.
- On-screen text without the label is recognised: a text carrier (headline, caption, title card, sign, banner, poster, screen, note,
  newspaper …; German Schlagzeile, Schild, Aufschrift …) followed by `:`, by `reads` / `says` (bare or quoted), by `shows` /
  `displays` and a quote, or directly by a quote; and anything that `reads "…"`. That clause is the whole sentence it is in, so the
  noun before the cue word is never left as a fragment. "Man reads newspaper" and "A man holds a sign" are not on-screen text: no
  text follows. The 8-word limit on on-screen text (invented text) applies to these clauses too.
- `stripDarkness`: a leading "Darkness." (German "Dunkelheit.") in front of anything else is removed; a bare "Darkness." is kept;
  "… Darkness." after the action (a fade to black) is kept. Applied in parseDescription and again in fit, so a re-run from fit cleans
  an existing described.json.

Describe prompt (`packages/pipeline/src/prompts.ts`, `describeSystemPrompt`):

- On-screen text: "(titles, captions, signs, headlines, screens) … quote them verbatim after "Words appear:" — always this label,
  never "headline:" or "a sign reads"." The rule that text is mentioned only when clearly legible and never invented is unchanged.
- Darkness: `Write only "Darkness." when the frames are black and nothing can be made out. If anything is visible, even dimly,
  describe it and do not write "Darkness.".` (was: `say only what can be made out, e.g. "Darkness." or "Darkness. A faint red glow."`).

## Consequences

- Gate C (0003) was approved on the previous prompt; the darkness example it showed the model is gone. Re-check Gate C (the
  sintel-90-210 rating set) before the next full-length title is described with this prompt.
- Titles already processed keep their described.json; the pipeline fixes reach them on a re-run from fit (no new Bedrock describe
  call). The prompt change reaches them only on a re-run from describe.
- sintel-90-150-r2 and sintel-90-210 lose their "Darkness." prefixes on a re-run from fit ("A faint fire glows in a stone pit.").
