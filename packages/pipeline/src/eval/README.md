# Gate C evaluation (`pnpm gate-c`)

The procedure is in [docs/evaluation.md](../../../../docs/evaluation.md); the rule for "fits" is decision 0009. This folder makes
it reproducible from the repo (DESC-030): before it, the driver and the rater packets lived in session scratchpads and were lost
([friction log](../../../../docs/friction/2026-10-14-gate-c-re-run-no-cli-stop-before-publish-and-previous-rater-packets-lost-with-the-scratchpad.md)).

| File | What |
|---|---|
| `gate-c.ts` | the CLI (`pnpm gate-c run · packets · score`) |
| `run.ts` | copy step inputs into a new slug; run describe/fit/edit/voice there under the meter with a hard cap |
| `packets.ts` | N byte-identical blind packets: contact sheets, frames, `shots.md`, `RUBRIC.md`, `scores.md` |
| `RUBRIC.template.md` | the rubric every rater gets; criterion 5 quotes decision 0009 verbatim (a test checks it) |
| `score.ts` | reads the filled `scores.md` files and computes the numbers |

## Commands

From the repo root (AWS profile and env as for `pnpm pipeline`; only `run` without `--dry-run` calls AWS):

```sh
# 1. What would be copied and run — reads the source dir, writes nothing, $0
pnpm gate-c run sintel-90-210 sintel-90-210-g10 --dry-run
# 2. The run: describe → fit → edit → voice on a copy, stopped at $0.30
pnpm gate-c run sintel-90-210 sintel-90-210-g10 --cap 0.30
# 3. Three blind packets (timecodes from film 1:30)
pnpm gate-c packets sintel-90-210-g10 ~/gate-c/g10 --raters 3 --offset 90
# 4. After the raters have filled rater1..3/scores.md
pnpm gate-c score ~/gate-c/g10
```

- `run <sourceSlug> <evalSlug>` copies `probe.json shots.json gaps.json words.json transcript.json transcript.src mezz.mp4` (plus
  `described.json` / `cues.fit.json` / `cues.json` when `--steps` starts at fit, edit or voice) into `work/<evalSlug>/` — never
  `cache/`, `frames/` or any cue clip, and the source dir is only read. `--steps` takes consecutive steps from
  `describe,fit,edit,voice`; anything else (mix, package, publish …) is refused, and nothing writes the DB. The cap is checked on
  every charge to the meter: the charge that crosses it aborts the step (no new Bedrock or Polly call starts) and the command exits 2.
  Calls already in flight are still billed. `work/<evalSlug>/gate-c.json` records the source, steps, cost per step, commit and
  `DESCRIBE_MODEL_ID` / `DESCRIBE_VERIFY`. The eval slug must be new. `--work <dir>` points at another work root (the default is
  `packages/pipeline/work`; a sibling worktree has none, so pass the main checkout's).
- `packets <evalSlug> <outDir> --raters N` (N odd, default 3) refuses a non-empty out dir, so a filled sheet is never overwritten.
  Frames are sampled as in every earlier packet (5 per shot at 8/30/50/70/92 % of the shot, stopping 120 ms before the next cut).
  Speech ends are measured with 06-voice's own silencedetect (−45 dB, d = 0.05). `--title` names the clip in `shots.md`; keep model
  and run names out of it. Hand each rater **only** their `rater<k>/` folder; `packet.json` (outside them) records the source.
- `score <outDir>` prints each rater's usable count, the majority-usable count against the 70 % gate, the all-raters-usable count,
  how many shots all raters agree on, and every disagreement with the raters' notes. Unrated rows count as not usable and make the
  command exit 1.

## Held-out clip

Gate C has been tuned on `sintel-90-210` (Sintel 1:30–3:30, 29 shots) since decision 0003, so its score is no longer independent.
Every evaluation also rates a **held-out clip** and reports it separately:

**`tears-of-steel-40-100`** — Tears of Steel 0:40–1:40, **16 shots**, 3 dialogue-free gaps (4.5 s, 6.7 s, 37.4 s) around 21
dialogue words, live action mixed with CG and on-screen interface text (a different film, look and kind of shot from Sintel).
`--offset 40` for the packets. It has been through the pipeline as a DESC-010 title but has never been rated or tuned on in Gate C.
At 16 shots the 70 % bar is 12 majority-usable shots.

```sh
pnpm gate-c run tears-of-steel-40-100 tears-of-steel-40-100-g10 --cap 0.30
pnpm gate-c packets tears-of-steel-40-100-g10 ~/gate-c/g10-heldout --raters 3 --offset 40
```

`sintel-90-150*` is not held out: it is the first minute of the Gate C clip.
