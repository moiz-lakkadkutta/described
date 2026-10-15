# Gate C evaluation (`pnpm gate-c`)

The procedure is in [docs/evaluation.md](../../../../docs/evaluation.md); the rule for "fits" is decision 0009. This folder makes
it reproducible from the repo (DESC-030): before it, the driver and the rater packets lived in session scratchpads and were lost
([friction log](../../../../docs/friction/2026-10-14-gate-c-re-run-no-cli-stop-before-publish-and-previous-rater-packets-lost-with-the-scratchpad.md)).

| File | What |
|---|---|
| `gate-c.ts` | the CLI (`pnpm gate-c run · packets · score`) |
| `prepare.ts` | cut a new segment and run probe/shots/speech into a new work dir (the held-out clip) |
| `run.ts` | copy step inputs into a new slug; run describe/fit/edit/voice there under the meter with a hard cap |
| `packets.ts` | N byte-identical blind packets: contact sheets, frames, `shots.md`, `RUBRIC.md`, `scores.md` |
| `RUBRIC.template.md` | the rubric every rater gets; criterion 5 quotes decision 0009 verbatim (a test checks it) |
| `score.ts` | reads the filled `scores.md` files and computes the numbers |

## Commands

From the repo root (AWS profile and env as for `pnpm pipeline`; `prepare` and `run` call AWS unless given `--dry-run`):

```sh
# 0. Once per new clip: cut it and run probe → shots → speech (Transcribe), capped; see "Clips" below
pnpm gate-c prepare <https-url | s3://… | file> <slug> --start mm:ss --end mm:ss [--cap 0.10] --dry-run
# 1. What would be copied and run — reads the source dir, writes nothing, $0
pnpm gate-c run sintel-90-210 sintel-90-210-g10 --dry-run
# 2. The run: describe → fit → edit → voice on a copy, stopped at $0.30
pnpm gate-c run sintel-90-210 sintel-90-210-g10 --cap 0.30
# 3. Three blind packets (timecodes from film 1:30)
pnpm gate-c packets sintel-90-210-g10 ~/gate-c/g10 --raters 3 --offset 90
# 4. After the raters have filled rater1..3/scores.md
pnpm gate-c score ~/gate-c/g10
```

- `prepare <input> <slug> --start --end` cuts [start, end) with the catalogue's cut (own.ts `cutArgs`; ffmpeg seeks an https input
  without downloading the film), uploads it to `s3://$S3_BUCKET_MEDIA/work/<slug>/source.mp4` (not `sources/`: it is no catalogue
  title), and runs probe → shots → speech into `work/<slug>/`. Transcribe is billed when its job ends, so the cap is checked against
  its price before anything runs; segments over 10 min are refused. No Title row, no DB, no publish. A real run first refuses a
  slug that is a catalogue title (`apps/api/prisma/titles.json` — checked on dry runs too — or a Title row when `DATABASE_URL` is
  set) or that already has objects under S3 `work/<slug>/` (ListObjectsV2; a dry run says "S3 not checked"). `--credit` records
  the film's credit (default for the Tears of Steel download: "Tears of Steel © 2012 Blender Foundation, mango.blender.org,
  CC-BY 3.0"); `run` carries it into the eval dir and `packets` prints it at the top of `shots.md`.
  The S3 objects under `work/<slug>/` (the cut as `source.mp4`, the mezzanine 03-speech uploads, the Transcribe output) **stay**
  after the run; remove them when the clip is no longer needed:
  `aws s3 rm --recursive s3://$S3_BUCKET_MEDIA/work/<slug>/ --profile described-dev`
- `run <sourceSlug> <evalSlug>` copies `probe.json shots.json gaps.json gaps.vad.json words.json transcript.json transcript.src mezz.mp4` (plus
  `described.json` / `cues.fit.json` when `--steps` starts at scenes, fit or edit, and `scenes.json` when present for fit or edit)
  into `work/<evalSlug>/` — never `cache/`, `frames/` or any cue clip, and the source dir is only read. The steps run with the
  SOURCE slug's glossary (titles.json, else `docs/eval/gate-c-glossary.json`; DESC-029). Before the first step the copy's `gaps.json` /
  `gaps.vad.json` are rebuilt from `words.json` with the voice-activity split (`regap`, decision 0014; no Transcribe); `--keep-gaps`
  keeps the copied ones, and `gate-c.json` records `gapsSource`. `--steps` takes consecutive steps from
  `describe,scenes,fit,edit,voice`, never starting
  at voice (06-voice rewrites `cues.json`, so it runs only after edit); anything else (mix, package, publish …) is refused, and
  nothing writes the DB. Every Bedrock model the steps will call (describe, verify, the Nova Lite shortener, edit — from
  `DESCRIBE_MODEL_ID`, `VERIFY_MODEL_ID`, `NOVA_LITE_MODEL_ID`, `EDIT_MODEL_ID`, `DESCRIBE_VERIFY`, `DESCRIBE_EDIT`) must have a price
  in `src/cost.ts`, or the run is refused: an unpriced model is metered as $0 and the cap could not stop it. The cap is checked on
  every charge to the meter: the charge that crosses it aborts the step (no new Bedrock or Polly call starts) and the command exits
  2. Calls already in flight are still billed. Every run (and `--dry-run`) prints the models, whether verify is on, the glossary
  status (found for the source slug, and in which file, or none) and the language and voice. `--lang` / `--voice` resolve as in `pnpm pipeline describe`. A copy that fails
  part-way removes the eval dir. `work/<evalSlug>/gate-c.json` records the source, steps, cost per step, commit and whether the tree
  had uncommitted changes to tracked files (`dirty`; untracked files do not count), language and voice, the models, the env switches above plus `DESCRIBE_CONCURRENCY`, and `VERIFY_PROMPT_VERSION` /
  describe cache versions. The eval slug must be new. `--work <dir>` points at another work root (the default is
  `packages/pipeline/work`; a sibling worktree has none, so pass the main checkout's).
- `packets <evalSlug> <outDir> --raters N` (N odd, default 3) refuses a non-empty out dir, so a filled sheet is never overwritten.
  Frames are sampled as in every earlier packet (5 per shot at 8/30/50/70/92 % of the shot, stopping 120 ms before the next cut).
  Speech ends are measured with 06-voice's own silencedetect (−45 dB, d = 0.05). `--title` names the clip in `shots.md`; keep model
  and run names out of it. Hand each rater **only** their `rater<k>/` folder; `packet.json` (outside them) records the source,
  the shot list and `skipShots`: the same-as-previous shots (describe marked them same-as-previous, and nothing is voiced or
  placed by fit). An empty description not marked same-as-previous is rated, labelled "Not voiced: empty description". `shots.md` labels them "Same as previous shot — not rated" and `scores.md` pre-fills
  their row with "skip"; they leave the denominator (decision 0003: usable / (shots − same-as-previous)).
- `score <outDir>` prints each rater's usable count, the majority-usable count against the 70 % gate, the all-raters-usable count,
  how many shots all raters agree on, and every disagreement with the raters' notes. It checks every sheet against `packet.json`'s
  shots and names missing or unknown rows. A row marked usable with a failed criterion is inconsistent: it counts as unrated and is
  warned about. Unrated rows count as not usable and make the command exit 1. Usable "skip" or "skip (empty)" (exactly, in the
  Usable column) on a `skipShots` shot leaves it out of the denominator; on any other shot it counts as not usable, is warned
  about and makes the command exit 1. A `skipShots` shot that most raters rated anyway is counted as rated, with a warning.
  `--skip 16` adds same-as-previous shots for a `packet.json` written before `skipShots` existed, and is refused when it has
  them. When `<outDir>/corrections.md` exists (or `--corrections <file>`), `score` also prints the fail-only corrections and the
  corrected result, labelled "CORRECTED (not the blind result)" (docs/evaluation.md, "Known limits"); the exit code follows the
  as-rated result, and the raters' `scores.md` files are never written.

## Clips

At 16–30 shots one shot moves the score by 3–6 points, so each clip's score is a coarse check; read the disagreements, not only
the percentage.

**Primary — `sintel-90-210`** (Sintel 1:30–3:30, 29 shots; one shot ≈ 3.4 points). The Gate C clip since decision 0003. Every
prompt and step change since has been checked on it, so it is a **tuned** clip and is reported as such.

**Held-out — `tos-390-510`** (Tears of Steel 6:30–8:30, not yet prepared). Nothing in the repo has looked at this stretch: the
pipeline has only seen Tears of Steel 0:40–1:40 and Sintel. From the film's English subtitles
(https://download.blender.org/demo/movies/ToS/subtitles/TOS-en.srt), it has 8 short lines between 6:30 and 7:11 with gaps of 3–10 s
between them, 62 s with no subtitled dialogue (7:11–8:13, action), then 4 lines to 8:28 and silence to the end. That is placed
cues in short gaps, a long action gap and extended cues, in live action with CG. It avoids 4:52–6:00, which replays the opening dialogue the 0:40–1:40
clip contains. The shot count is known after `prepare`; at ~25 shots one shot ≈ 4 points. Cutting it from the public **720p** file
(`tears_of_steel_720p.mov`, H.264 1280 px wide, MP3 audio; the catalogue titles were cut from the 1080p release; CC-BY 3.0, © Blender Foundation) costs Transcribe for 120 s (≈ $0.048); the evaluation run on it is ≈ $0.10 (2 min at the
measured per-minute rates plus the verify pass).

```sh
pnpm gate-c prepare https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov tos-390-510 --start 6:30 --end 8:30 --cap 0.10
pnpm gate-c run tos-390-510 tos-390-510-g10 --cap 0.30
pnpm gate-c packets tos-390-510-g10 ~/gate-c/g10-heldout --raters 3 --offset 390
```

**Less tuned, not held out — `tears-of-steel-40-100`** (16 shots; one shot ≈ 6 points). It shaped decision 0008, appears in 0006
and 0011, is pinned in `test/text-fixes.test.ts` and `test/cues.test.ts`, and is a DESC-010 title (all five are in DESC-029's
fixtures). Use it only as an extra data point, labelled "less tuned". `sintel-90-150*` is the first minute of the primary clip.
