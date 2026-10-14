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
3. **a verb** — when the original has a verb, at least one of them is kept ("Snowy mountains." from "Snowy mountains. A lone figure
   walks left, carrying a spear." fails);
4. **no verbless sentence** cut from a sentence that had a verb ("Scaled creature. Hand reaches." fails; "Snowy mountains." beside
   "A lone figure walks left." passes).

When Nova Lite's reply fails, the deterministic shortening is tried under the same checks; when that fails too, the text comes back
unshortened, and fit does what it does with any text that does not fit: the next gap in the window, an extended cue
(`introducesNew`, a plot event) or a drop. No new behaviour, no model call. The Nova Lite prompt now asks for "one or more complete
present-tense sentences, each with its verb; never a list of nouns".

Verbs are found by a deterministic English heuristic: is / are / has / have, or an -s word that does not open its sentence and does
not follow an article, number, possessive, preposition or adjective-like word ("with horns", "two hands", "snowy mountains"). It misses
verbs without -s ("Two hands hold a bowl.", German) and reads some plural nouns as verbs; both mostly let a shortening through rather
than reject a good one. Check 2 is language-independent.

## Replay (recorded fit inputs, no AWS call)

Recorded shortenings were recovered from each run's `cues.fit.json` and fed back as the model's replies; fit before and after:
`sintel-90-150-r2` and `tears-of-steel-40-100` — no cue changes. `sintel-90-210` (A2) — shot 26 "A scaled creature with horns." (no
verb) is no longer placed; shot 27 "Red-haired woman smiles. Scaly beast roars." takes the slot. `sintel-90-210-g9` — shot 14 "City,
central pyramid." is rejected and placed whole in the next gap ("Dense city under hazy sky, central pyramid structure.", 4.3 s
later); later cues move with it (shot 17 "She turns." becomes the whole description, shot 21 drops out and 22 comes in).

## Not covered

The edit pass (05b) produced g9 shot 26 and has its own guards; 06-voice's overrun shortening calls `shortenDeterministic` directly.
Neither is changed here.
