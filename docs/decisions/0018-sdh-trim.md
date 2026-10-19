# 0018 — Rich captions: trim a grounded sound, don't reject it; "nothing qualified" is not "degraded"

Status: accepted 2026-10-19 · Keeps: the evidence rules of PR #39 (DESC-010 follow-ups: a sound needs a description naming its
source or action, ± 2 s, over audible audio; a speaker tag needs a name spoken by another voice) · Code: `mergeSdh` / `soundSlot`
(`packages/pipeline/src/prompts.ts`), `sdh` (`steps/08-text.ts`), `richCaptions` (`steps/09-package.ts`)

## Context

Every title with speech had `sdh.json` = `{"degraded":true}` and no Rich-captions track. No window had failed: 08-text set
`degraded` whenever the merge added nothing. The merge added nothing because Nova Lite gives a sound cue the **whole description's
start–end** (full Sintel, reply `06e0a0df`: 51 of 53 cues), and `mergeSdh` rejected any cue longer than 2 s or overlapping a
caption. That threw away the only grounded, audible sounds any cached reply held: `[creature roars]` 203.125–209.725 (6.6 s, over
c18) and `[woman gasps]` 333.745–339.889 (6.1 s, over c24) on Sintel. On sintel-90-150-r2 the Oct 15 reply lost `[broth pours]`
(0.33 s over c3) and `[fire crackling]` (3.24 s).

## Decision

1. **Timing is trimmed, not judged.** A sound cue that passes the unchanged checks (bracketed, ≤ 3 words, a SOUND_WORDS sound,
   grounded by a description within ± 2 s) is placed in the first slot inside its span ∩ that description's span ± 2 s that is
   0.5–2 s long (or the cue's own length, if the model gave less), clear of every caption, and audible. A zero-length cue is read as
   1 s. No slot → dropped, as before. A slot overlapping an earlier-accepted sound is dropped (first wins, as before).
2. **The prompt and request are unchanged**, so every cache key is the same: `--from text` replays existing replies at $0.
3. **`sdh.json` is `{ degraded, added }`.** `degraded` means a window's reply was unreadable or failed twice; `added` counts the
   sound cues and speaker tags kept. 09-package advertises Rich captions only when `!degraded && added > 0`, and logs
   "no Rich-captions track: nothing qualified" when `added` is 0. An older file without `added` reads as before
   (`degraded: false` there meant something was added); a missing file is degraded.

## Consequences

- From cached replies (cache-only replay, 2026-10-19): full Sintel gets 2 sound cues, `[creature roars]` 3:23.125–3:25.125 and
  `[woman gasps]` 5:33.745–5:35.745, and ships Rich captions. Tears of Steel still gets none: `[console beeps]` beside "Lab man in
  glasses gestures at glowing console." is not grounded. sintel-90-150-r2's request no longer matches a cached reply (one paid call
  to re-run); its Oct 15 reply would give `[fire crackling]` 11.208–13.208 and `[broth pours]` 30.37–31.329.
- A sound's time is as approximate as before: it sits where fit placed the description, not on the action.
- Monitoring can tell "the model failed" (`degraded`) from "there was nothing to say" (`added: 0`).
