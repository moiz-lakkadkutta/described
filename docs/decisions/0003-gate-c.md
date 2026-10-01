# 0003 — Gate C: description prompt, timing bound, evaluation

Status: approved by the human 2026-10-01; score pending the rerun
Ticket: DESC-001 part 2 · Gate definition: hackathon runbook §6 (Gate C: < 70 % usable in a 20-shot sample → swap model)

## Evidence (Sintel 1:30–2:30, first paid run)

3 of 7 cues usable. Causes: cues placed 8–13 s after their shot (`05-fit.ts` skipped the open gap and had no lateness bound);
`SAME. Woman holds bowl.` voiced (only a bare `SAME` was recognised); two invented `Words appear:` lines on frames with no
text — reproducible, caused by the unconditional text rule in the prompt; scene detection at 0.3 found 3 of 11 cuts.
Planner diagnosis and prompt probes (≈ $0.04, 17 Nova Pro calls): `gate-c-plan` in the session scratchpad.

## Decisions

1. **Description prompt** — on-screen text only when clearly legible ("Never invent text"), an explicit darkness rule,
   one line ≤ budget, temperature 0, video before the instruction. The previous description leaves the model input; the
   "nothing new" short-circuit moves into the pipeline (`parseDescription`: leading `SAME` or a near-verbatim repeat of the
   previous description). This replaces the "SAME short-circuit" wording in PLAN.md's prompt rules; the intent — never voice a
   redundant description — is unchanged.
2. **Lateness bound** — a description starts no later than 1 s after its shot ends (`LATE_MS = 1000`); otherwise it is
   dropped, or becomes an extended cue when it carries new information.
3. **Evaluation** — rerun on Sintel 1:30–3:30 (`sintel-90-210`, 29 shots, ≈ $0.15). Two raters judge each shot against a
   frame contact sheet: faithful, on time, style, clean, fits. Score = usable / (shots − same-as-previous). < 70 % → Claude on
   Bedrock for descriptions; key frames were probed and gave no advantage.

Docs: https://docs.aws.amazon.com/nova/latest/userguide/modalities-video.html ·
https://docs.aws.amazon.com/nova/latest/userguide/prompting-structured-output.html

## Result

(pending)
