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
quote none of it and say what kind of text appears instead. The example is generic ("Handwritten words appear on a sign.") — no
sentence from an evaluation clip. "Never invent text." became "Never invent or guess text.". `DESCRIBE_CACHE_VERSION` 1 → 2 (the
prompt is hashed into the key anyway; the bump makes the break explicit).

**Verify** (`src/verifyPrompt.ts`, `src/steps/04b-verify.ts`): text clauses are checked instead of skipped, with the same frames. The
prompt asks whether each quoted clause is fully legible and exactly right. Exactly two outcomes are allowed:

- keep the clause verbatim, or
- replace the whole clause (label, text and any trailing modifier, as `textSpans` reads it) with the language's fixed neutral
  sentence, `NEUTRAL_TEXT`: "Words appear." (German "Text erscheint.").

Never a corrected quote: a model's correction of a misread is itself a guess that nothing checks (the same reason 0010's guard 4
stops "bat" → "dragon").

Guard 2 (`textUnitsChecked`) reads the draft's and the reply's on-screen text as units in order — each quoted clause as written,
and each neutral sentence standing as a whole sentence (`neutralSpans`). Same count; each reply unit equals the draft's, or is the
reply language's neutral sentence where the draft had a quoted clause. A neutral sentence in the draft stays as it is (it never
becomes a quote). Anything else — a word of the quote changed, a clause dropped, added or moved, two sentences for one clause, the
other language's sentence — is "on-screen text changed" and the draft is kept. Verify's `tokens` leave neutral sentences out like
text clauses, so a clause's words never license description words in its place ("Words appear. A robot arm covers them." → new
words). Drafts are now skipped only when SAME, empty or nothing but neutral sentences. `VERIFY_PROMPT_VERSION` 3 → 4; `verify.json`
records, per applied shot, `textRemoved`: the draft clauses replaced.

**Downstream.** The neutral sentence has no ":" and no quote, so `textSpans` does not read it: fit, edit, voice, plotEvent and the
scene step treat it as a plain two-word sentence (not an extended text pause, not `introducesNew`, not "already said" text). The
edit guard rejects turning it into a quote ("on-screen text clause added"). Tests: `packages/pipeline/test/legible-text.test.ts`.

## Consequences

- A partly hidden title is now voiced as "Words appear." (or as describe's own "Handwritten words appear on a sign.") — less
  information than a quote, but never a wrong one.
- Verify now costs one call for text-only shots too (a few per title).
- Every cached describe and verify reply is re-bought on the next run from describe.
