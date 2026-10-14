# 0011 — fit's shortener keeps sentences

Status: proposed 2026-10-14 (PR review) — Ticket: DESC-028 · Follows: 0003 (Gate C; the safe shortener), 0009 (Gate C round 2)

## Problem

On `sintel-90-210-g9` both Gate C raters failed shot 14 "City, central pyramid." and shot 26 "Scaled creature, horns, bloodied
wing, stares." as broken grammar. Shot 14 is Nova Lite's shortening in 05-fit of "Dense city under hazy sky, central pyramid
structure."; `preservesFacts` accepted it (only words of the original, in order). Shot 26 is not fit's: fit placed "A scaled creature
with horns and bloodied wing stares." and the edit pass (05b, 0006) reworded it into the list. `preservesFacts` already rejected role
swaps (its words must appear in the original's order); it did not stop a sentence becoming a list of nouns, or losing every verb.

## Decision

`safeShorten` accepts a shortening — Nova Lite's, then `shortenDeterministic`'s — only when `readsAsSentences`
(`packages/pipeline/src/sentenceGuard.ts`) passes, besides fitting and `preservesFacts`:

1. **in order** — the content words (by stem) are a subsequence of the original's;
2. **no new list comma** — a comma or semicolon follows a word that had one in the original ("City," fails);
3. **not only a subject** (English only) — a sentence of the shortening with no verb of its own is rejected when every content word
   in it comes from the subject of a clause of the original that has a verb, i.e. the words before that clause's first verb
   ("A scaled creature with horns." from "A scaled creature with horns and bloodied wing stares as …" fails). It **fails open**: a
   word from a clause where no verb was found, or from after a verb, makes the sentence acceptable ("Snowy mountains.", "Two hands
   hold a red bowl."). Check 2 is what catches both rater fragments; check 3 only stops a bare subject.

German: checks 1 and 2 only (fit, edit pass and 06-voice get the title's language) — the verb heuristic is English, and German -s
words (links, rechts, etwas, alles) are not verbs.

When Nova Lite's reply fails, the deterministic shortening is tried under the same checks; when that fails too, the text comes back
unshortened, and fit does what it does with any text that does not fit: the next gap in the window, an extended cue
(`introducesNew`, a plot event) or a drop. No new behaviour, no model call. The Nova Lite prompt now asks for "one or more complete
present-tense sentences, each with its verb; never a list of nouns".

Verbs are found by a deterministic English heuristic: is / are / has / have; an -s word that does not open its sentence and does not
follow an article, number, possessive, preposition or adjective-like word ("with horns", "two hands", "snowy mountains"; an -ly adverb
is skipped and the word before it judged: "Sintel slowly lifts", but "a butterfly lands"); and a base form right after a plural subject
or "X and Y" at a clause start ("Two hands hold", "Dragons attack", "Celia and Thom argue"). It still misses other base forms and past
tense; a missed verb only makes check 3 more lenient.

**Extended cues.** `capExtended` (fit and 06-voice) uses a shortening or its cut to 25 words only when it passes the same checks; when
neither does, there is no extended cue (dropped). A text within 25 words is unchanged.

**Mid-phrase cuts** (round-2 review). `shortenDeterministic` cut clauses at every comma, including the one between stacked
adjectives, so a cut could end "…bowl; a pale.", "…revealing a faint.", "…toward a wounded.", "…in sunlit.". Now a clause piece that
ends on article/possessive/preposition + one word + comma, where that word is a listed adjective or -ed word or the next word is
another modifier (hyphenated or adjective-like), is joined to the next piece (`midPhrase`, shared). In English, `readsAsSentences`
also rejects a sentence that ends on an article, possessive or preposition, or mid-phrase in the same sense. "Snow falls on the
hills." (before ", drifting") and "…walks left across snow." (before ", mountains loom") are not mid-phrase. When the shortener drops
a word between "a"/"an" and the next word, the article follows the new word ("An old bearded man" → "A bearded man").

**Sweep** (every recorded description's deterministic shortenings, 96 descriptions). The first version of check 3 rejected 22 of 123;
the fail-open version 6. After the mid-phrase change the shortener no longer produces the 8 mid-phrase cuts (114 shortenings), and 5
are rejected, each a bare subject ("The woman with red hair.", "A woman with red hair.", "A scaled creature with horns.").

Known gap: "Tent glows." (Nova Lite, from "Tent interior. Fire glows.") passes, though it gives the tent the fire's verb; a follow-up.

## Replay (recorded fit inputs, no AWS call)

Recorded shortenings were recovered from each run's `cues.fit.json` and fed back as the model's replies; fit before and after:
`sintel-90-150-r2` and `tears-of-steel-40-100` — no cue changes. `sintel-90-210` (A2) — shot 26 "A scaled creature with horns." (only a
subject) is no longer placed; shot 27 "Red-haired woman smiles. Scaly beast roars." takes the slot. `sintel-90-210-g9` — shot 14 "City,
central pyramid." is rejected and placed whole in the next gap ("Dense city under hazy sky, central pyramid structure.", 4.3 s
later); later cues move with it (shot 17 "She turns." becomes the whole description, shot 21 drops out and 22 comes in).

## The edit pass and 06-voice (same PR, second commit)

- **Edit pass (05b, 0006).** `applyEdits` rejects an edit that fails `editReadsAsSentences(cue text, edit, allowed)` with the
  reason `not a sentence: …`; the cue keeps its fit text. Edits may add words from the allowed descriptions and reorder them, so
  there is no in-order check, and verbs are found in the edit's own text. A comma the sources did not have is allowed only before a
  joining word (then, and, while, as, who, which …) or an -ing word ("…over the fire, then pours broth."). The deterministic repeat
  guard (`dropRepeatedLeads`, #44) is unchanged. Replay of g9's recorded edits: cue 20 "Scaled creature, horns, bloodied wing,
  stares." is rejected and stays "A scaled creature with horns and bloodied wing stares."; the other two edits still apply.
- **06-voice.** The overrun shortening (and the shortening of the action beside split-off on-screen text) uses `shortenSentences`:
  `shortenDeterministic` under `readsAsSentences`, or the text unshortened. The cue then follows voice's existing path: extended
  when it introduces something new, an event pause, or dropped. The recorded voice shortenings of
  sintel-90-150-r2, tears-of-steel-40-100, sintel-90-210 and g9 all still pass the check.
