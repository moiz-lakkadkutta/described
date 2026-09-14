# Described — plan

The full plan (users, architecture, pipeline spec and prompts, data model, design system, every screen, accessibility, tickets, tests, impact, risks)
is published here: https://claude.ai/code/artifact/e544a053-1da9-4bba-b2db-078a67a67867

Shared runbook (stack, schedule, gates): https://claude.ai/code/artifact/333837e3-60c1-41e3-b028-fccee0af96c4

## The non-negotiables
- Description **on by default**; whole app completable with D-pad, Select, Back, Menu.
- AD is an **audio rendition** (role=description) — the TV plays one stream; Fire TV's track selector is the toggle.
- Extended cues live in the descriptions text track with `{extended=1}` meta and are spoken by the app (pause–speak–resume).
- Description prompt rules: present tense, objective, no names before spoken, precise colours, ≤ gap × 2.67 words, "SAME" short-circuit.
- Mix: duck −9 dB (Netflix 6–12 dB), attack 10 ms, release 300 ms, −24 LUFS integrated, −2 dBTP.
- Type floor 28 px; body 32; captions 44; nothing pure white; focus = outline + 1.04 scale, 150 ms.
