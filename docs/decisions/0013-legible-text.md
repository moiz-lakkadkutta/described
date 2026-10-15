# 0013 — On-screen text is quoted only when fully legible

Status: accepted 2026-10-15 (the human approved this targeted fix) — describe prompt change and a verify change; **Gate C must be
re-checked** (DESC-024 / DESC-030 runs)
Ticket: DESC-031 · Amends: 0008 (on-screen text rules), 0010 (verify pass)

## Problem

Held-out Gate C, Tears of Steel 6:30–8:30 (run g10), shot 4: describe wrote a "Words appear:" quote of handwritten text whose
second line is partly hidden by an object in front of it. The quote misread one word and left out the hidden part, and so presented
partly hidden text as legible. All three raters failed it, for both faults. Verify (0010) never saw it: it skipped drafts that are
only on-screen text.

## Decision

**Describe prompt** (`packages/pipeline/src/prompts.ts`, `ON_SCREEN_TEXT_RULE`): quote on-screen text only when every word is clearly
legible in the frames, then verbatim after "Words appear:" (0008's label rule unchanged). If any part is hidden, cut off or blurred,
quote none of it and say in your own words only what kind of text it is and what it is on (for example handwriting, print, a sign,
a screen, a newspaper). No example sentence (PR #56 review M1): a sentence in the prompt is one the model copies, and the first
draft's example matched the held-out failure; the rule's only quoted strings are the label and the two forms it replaces (tested).
"Never invent text." became "Never invent or guess text.". `DESCRIBE_CACHE_VERSION` 1 → 2 (the prompt is hashed into the key anyway;
the bump makes the break explicit).

**Verify** (`src/verifyPrompt.ts`, `src/steps/04b-verify.ts`): text clauses are checked instead of skipped, with the same frames. The
prompt asks whether each quoted clause is fully legible and exactly right. Exactly two outcomes are allowed:

- keep the clause verbatim, or
- replace the whole clause (label, text and any trailing modifier, as `textSpans` reads it) with the language's fixed neutral
  sentence, `NEUTRAL_TEXT`: "Words appear." (German "Text erscheint.").

Never a corrected quote: a model's correction of a misread is itself a guess that nothing checks (the same reason 0010's guard 4
stops "bat" → "dragon").

Guard 2 (`textUnitsChecked`) reads the draft's and the reply's on-screen text as units in order — each quoted clause as written,
and each neutral sentence standing as a whole sentence (`neutralSpans`). Each reply unit equals the draft's, or is the reply
language's neutral sentence where the draft had a quoted clause. A neutral sentence in the draft stays as it is (it never becomes a
quote). Adjacent replaced clauses with nothing between them may become one neutral sentence: repeats are collapsed
(`collapseNeutral`, in parseDescription and on verify's result; review L2). Each unit keeps its place among the description's words:
every matched non-linking word before it in the reply came from before it in the draft (review L1). Anything else — a word of the
quote changed, a clause dropped, added or moved, the other language's sentence — is "on-screen text changed" and the draft is kept.

Verify's `tokens` leave neutral sentences out like text clauses, so a clause's words never license description words in its place
("Words appear. A robot arm covers them." → new words). One exception (review M2): an unlabelled clause's **carrier** — its words
before the text, `A man reads a note` of `A man reads a note: "MEET ME".` — may stay, in order, before the neutral sentence
(`A man reads a note. Words appear. He leaves.`); dropping it is a deletion and also fine. The word guards compare the reply against
the draft with each replaced clause written as carrier + neutral sentence (`wordsDraft`); words after the text (a trailing modifier,
"in metallic silver") are not a carrier. Negations and protected words are still counted on the draft without its clauses.

Drafts are now skipped only when SAME, empty or nothing but neutral sentences. `VERIFY_PROMPT_VERSION` 3 → 4; `verify.json` records,
per applied shot, `textRemoved`: the draft clauses replaced.

**Downstream.** The neutral sentence has no ":" and no quote, so `textSpans` does not read it: fit, edit, voice, plotEvent and the
scene step treat it as a plain two-word sentence (not an extended text pause, not `introducesNew`, not "already said" text). The
edit guard rejects turning it into a quote ("on-screen text clause added"). Shortening may drop it whole but never cut it:
`sentenceGuard.readsAsSentences` rejects "Text erscheint." → "Text." (`cutsNeutral`, every language; review L3 — German has no verb
check that would catch it). Tests: `packages/pipeline/test/legible-text.test.ts`.

## Intended, not fixed (review L4)

- A neutral sentence is plain description: it is not de-duplicated across cues (two shots in a row may each say "Words appear."),
  and fit's shortener or the edit pass may drop it whole when room is short. Both are deletions; neither states wrong text.
- A kept carrier can read flat ("A sign reads. Words appear.") — it is still only the draft's own words.

## Consequences

- A partly hidden title is now voiced as "Words appear." or as describe's own words for the kind of text — less information than a
  quote, but never a wrong one.
- Verify now costs one call for text-only shots too (a few per title).
- Every cached describe and verify reply is re-bought on the next run from describe.
