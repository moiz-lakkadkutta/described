# Gate C re-run: no CLI stop-before-publish, and the previous rater packets were lost with the scratchpad

Task attempted: DESC-024 — re-describe `sintel-90-210` (29 shots) with the decision-0008 prompt and build two blind rater packets
in the same format as the earlier Gate C runs (0003), without publishing over the catalogue.
Steps:
  1. Looked for the earlier packets (`gate-c-eval*`, `eval-1010b/`) under `/private/tmp/claude-502/…/scratchpad`.
  2. Looked for a `--to <step>` / no-publish option on `pnpm cli describe`.
Expected: the previous packets (contact sheets, rater instructions, score sheets) to reuse verbatim; a CLI flag that stops after
`voice` so a quality re-check does not mix, package, upload or publish.
Actual: none of the earlier eval folders exist any more — session scratchpads are temporary, so the rubric wording, the contact-sheet
layout and the score template survive only as the summary in docs/decisions/0003-gate-c.md. `describe` has `--from` but no `--to`;
it always runs through `publish` and then `persistForCli` (DB write).
Severity: Low — about 20 minutes to rebuild the packet format from 0003 and write a small driver; the rubric text may differ in
wording from the one the earlier raters saw, which weakens the run-to-run comparison slightly.
Workaround: copied the inputs (probe, shots, gaps, words, transcript, mezz) of `work/sintel-90-210` into a new slug
`work/sintel-90-210-g8` (no describe cache) and ran `describe → fit → edit → voice` in-process through `runStep` + `metered`
(a 15-line driver kept in the gitignored work dir). Rebuilt the rater packet from 0003's description.
Suggestion: (1) add `--to <step>` to `describe` (and skip `persistForCli` when it stops before `publish`); (2) keep the Gate C rubric
and the packet builder in the repo (e.g. `docs/eval/gate-c-rubric.md`, `packages/pipeline/scripts/gate-c-packet.py`) so every
re-check uses the same words and layout.
Environment: macOS 25.2, Node via pnpm 9.15.9, commit f7189b1 (origin/main), AWS profile described-dev.
Links: docs/decisions/0003-gate-c.md · docs/decisions/0008-text-and-darkness.md · TASKS.md DESC-024
