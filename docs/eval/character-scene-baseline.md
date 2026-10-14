# Character and scene context — baseline (DESC-029)

The published description cues of the five catalogue titles, 2026-10-14, before DESC-029 (decision
[0012](../decisions/0012-characters-and-scenes.md)), measured with the evaluation script. No AWS call.

- **Cues**: `published-cues-2026-10-14.json` — the `DescriptionCue` rows of the local database, read with one SELECT
  (`slug, startMs, endMs, text, extended`, ordered by start), 55 rows.
- **Glossary**: `characters[]` and `settings[]` in `apps/api/prisma/titles.json`.
- **Dialogue**: Sintel and Tears of Steel `words.json` (Transcribe, test fixtures); Elephants Dream captions
  (`packages/pipeline/test/fixtures/sdh/elephants-dream-0-60.captions.vtt`); Big Buck Bunny and Caminandes have none.
- **Scenes**: hand-annotated from the frames in `scene-annotations.json` (start in segment seconds, glossary place).

Re-run (from `packages/pipeline`), and compare a new run's cues with `--after <file>` (a cues.json, or rows exported the same way):

```
pnpm eval-context --all --before ../../docs/eval/published-cues-2026-10-14.json --scenes ../../docs/eval/scene-annotations.json
pnpm eval-context --slug sintel-90-150-r2 --before ../../docs/eval/published-cues-2026-10-14.json --after work/sintel-90-150-r2/cues.json \
  --words test/fixtures/sintel-90-150-r2.words.json --scenes ../../docs/eval/scene-annotations.json
```

## How each metric is measured (`packages/pipeline/src/evalContext.ts`)

- **Invented names**: a capitalised word that is not the first of a sentence, not on-screen text, and backed by no glossary name or
  dialogue name. **Names before revealedAtS**: a glossary name voiced before its `revealedAtS` and before the dialogue says it.
- **Descriptors per character**: person or animal noun phrases (up to three words before the noun, and an "in …" phrase after it),
  given to the character of that kind whose look shares the most words; a name counts as one descriptor. Plural phrases ("two
  figures") are skipped. A phrase that fits no character, or two equally, is listed as **unassigned** — "figure" and "man" in a title
  with two men cannot be told apart, which is itself the inconsistency being measured. Heuristic: Tears of Steel's "woman" (the
  55.7 s rifle shot) is counted for Celia, the only woman listed, though it is probably someone else.
- **Scenes whose first cue states the place**: the first cue in the scene (on-screen text pauses left out) has a word of the
  setting's name, a where-noun (room, tent, mountains, desert, city, lab, bridge …; not objects such as pit, fence or sky), or a
  short verbless setting sentence ("Cables around glowing panels."). A scene with no cue is not counted.
- **Scene / time changes signalled**: for each scene after the first, its first cue states the place or a time word (night, later …).
  A scene with no cue counts as not signalled.
- **Setting repeated within a scene**: cues that say a place word the same scene has already said.

## Baseline (published 2026-10-14)

| Title | Invented / premature names | Distinct descriptors | First cue states the place | Changes signalled | Repeats |
|---|---|---|---|---|---|
| sintel-90-150-r2 | 0 / 0 | Sintel 3 (lone figure / figure / red-haired girl), Shaman 2 (bearded man / old man) | 1 of 2 (the tent: no) | 0 of 1 | 0 |
| big-buck-bunny-0-60 | 0 / 0 | rabbit 1 (+ "dark figure", "figure" unassigned), bird 1 | 0 of 2 (sky, then a mossy mound) | 0 of 1 | 0 |
| elephants-dream-0-60 | 0 / 0 | Proog 2 (bald man in coat / bald man), Emo 0 (+ "figure", "man" unassigned) | 1 of 1 (two scenes have no cue) | 1 of 2 | 0 |
| caminandes-35-95 | 0 / 0 | Koro 3 (tan llama / brown llama / llama) + "orange fox", "fox" (the same llama) | 1 of 2 | 1 of 1 ("Night.") | 3 |
| tears-of-steel-40-100 | 0 / 0 | Thom 0, Celia 1, man in glasses 1 (+ "man in dark jacket", "man", "figure" unassigned) | 3 of 4 (the lab: no) | 2 of 3 | 0 |
| **All five** | **0 / 0** | | **6 of 11 scenes with a cue (55 %)** | **4 of 8 (50 %)** | **3** |

No names are voiced at all (0 grounded names: Emo after 25.1 s and Thom / Celia were all knowable). Targets (decision 0012): 0 / 0
names (hard gate), Emo, Thom and Celia voiced; one descriptor (+ name) per character; ≥ 90 % of scenes stating their place in the
first cue; every change of place or time signalled; 0 repeats.

## Script output

### sintel-90-150-r2

| Metric | Value |
|---|---|
| Cues | 11 |
| Invented names | 0 |
| Names before revealedAtS | 0 |
| Names voiced (evidence) | 0 |
| Descriptors: Sintel | 3: lone figure / figure / red-haired girl |
| Descriptors: Shaman | 2: bearded man / old man |
| Unassigned person phrases | — |
| Scenes whose first cue states the place | 1 of 2 |
| Scene / time changes signalled | 0 of 1 |
| Setting repeated within a scene | 0 |

Scenes (annotated): 0 s the snowy mountains — 2 cue(s), first states place: true, repeats: 0; 11.2 s the tent — 8 cue(s), first states place: false, change signalled: false, repeats: 0

### big-buck-bunny-0-60

| Metric | Value |
|---|---|
| Cues | 9 |
| Invented names | 0 |
| Names before revealedAtS | 0 |
| Names voiced (evidence) | 0 |
| Descriptors: Big Buck Bunny | 1: large gray rabbit |
| Descriptors: the bird | 1: grey bird |
| Unassigned person phrases | dark figure / figure |
| Scenes whose first cue states the place | 0 of 2 |
| Scene / time changes signalled | 0 of 1 |
| Setting repeated within a scene | 0 |

Scenes (annotated): 0 s the meadow — 5 cue(s), first states place: false, repeats: 0; 25 s the burrow — 4 cue(s), first states place: false, change signalled: false, repeats: 0

### elephants-dream-0-60

| Metric | Value |
|---|---|
| Cues | 7 |
| Invented names | 0 |
| Names before revealedAtS | 0 |
| Names voiced (evidence) | 0 |
| Descriptors: Proog | 2: bald man in coat / bald man |
| Descriptors: Emo | 0 |
| Unassigned person phrases | figure / man |
| Scenes whose first cue states the place | 1 of 1 |
| Scene / time changes signalled | 1 of 2 |
| Setting repeated within a scene | 0 |

Scenes (annotated): 0 s the tiled wall — 0 cue(s), first states place: no cue, repeats: 0; 11 s the dark tunnels — 0 cue(s), first states place: no cue, change signalled: false, repeats: 0; 32.9 s the white chamber — 5 cue(s), first states place: true, change signalled: true, repeats: 0

### caminandes-35-95

| Metric | Value |
|---|---|
| Cues | 13 |
| Invented names | 0 |
| Names before revealedAtS | 0 |
| Names voiced (evidence) | 0 |
| Descriptors: Koro | 3: tan llama / brown llama / llama |
| Unassigned person phrases | orange fox / fox |
| Scenes whose first cue states the place | 1 of 2 |
| Scene / time changes signalled | 1 of 1 |
| Setting repeated within a scene | 3 |

Scenes (annotated): 0 s the high plain — 12 cue(s), first states place: true, repeats: 3; 58 s the high plain — 1 cue(s), first states place: false, change signalled: true, repeats: 0

### tears-of-steel-40-100

| Metric | Value |
|---|---|
| Cues | 15 |
| Invented names | 0 |
| Names before revealedAtS | 0 |
| Names voiced (evidence) | 0 |
| Descriptors: Thom | 0 |
| Descriptors: Celia | 1: woman |
| Descriptors: the man in glasses | 1: man in glasses |
| Descriptors: the sniper | 0 |
| Unassigned person phrases | man in dark jacket / man / figure |
| Scenes whose first cue states the place | 3 of 4 |
| Scene / time changes signalled | 2 of 3 |
| Setting repeated within a scene | 0 |

Scenes (annotated): 0 s the canal bridge — 1 cue(s), first states place: true, repeats: 0; 2.1 s the lab — 3 cue(s), first states place: false, change signalled: false, repeats: 0; 29.9 s the smoking city — 1 cue(s), first states place: true, change signalled: true, repeats: 0; 34.1 s the hideout — 5 cue(s), first states place: true, change signalled: true, repeats: 0

