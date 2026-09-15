# Orchestrator protocol

This repository is developed in **orchestrator + sub-agent** style. The orchestrator (the main Claude Code session) never
writes code, plans, or docs itself. It reads state, decides what happens next, dispatches sub-agents with precise briefs,
verifies their output through *other* sub-agents, and records outcomes. All thinking-heavy work and all implementation work
is done by sub-agents.

## 1. Roles

| Role | Does | Never does |
|---|---|---|
| **Orchestrator** (this session) | Reads `TASKS.md`, `docs/PLAN.md`, `docs/decisions/`, CI status; picks the next ticket; writes sub-agent briefs; runs the loop below; updates `TASKS.md` and `docs/decisions/`; commits and pushes | Edit source files, write plans, make architecture calls, "quickly fix" anything |
| **Planner** sub-agent | Turns a ticket into an implementation plan: files to touch, interfaces, acceptance tests, risks, open questions; reads Amazon/AWS docs and cites URLs | Write code |
| **Implementer** sub-agent | Implements exactly the plan; writes tests first where the plan defines behaviour; runs `pnpm typecheck && pnpm test` (and `pnpm lint:words` in apps) before returning; reports what changed and what it could not do | Expand scope, change interfaces without a plan revision, skip tests |
| **Reviewer** sub-agent | Reads the diff cold against the plan and `docs/PLAN.md`; runs the checks; returns findings ranked by severity with file:line | Fix things (findings go back to an implementer) |
| **Spike** sub-agent | Answers one empirical question on a device/SDK (e.g. "does Shaka emit cue events on the VVD?"); returns evidence and a friction log | Build features |
| **Scribe** sub-agent | Friction logs (`pnpm friction`), `docs/aws.md`, feedback drafts, README updates | Touch code |

## 2. Model routing

Pick the model per sub-agent from the nature of the task, not from its size.

- **Fable** — when the task requires judgement: planning a ticket, any architecture or interface decision, resolving a `TODO(spike)`,
  designing a prompt for Nova, debugging something that fails for a non-obvious reason, code review, anything touching
  accessibility semantics, MDR wording, or the description/learning rules. Also every spike.
- **Opus** — when the boundaries are fully defined and the result can be verified mechanically: implementing a plan that names
  the files, functions, and tests; writing tests for a stated contract; wiring a route to an existing schema; ffmpeg/packager
  command builders with fixture tests; docs generated from existing code; CDK resources named in the plan.
- **Rule of thumb:** if the brief can end with "done when `pnpm test` passes and these N acceptance checks hold", use Opus.
  If the brief contains the word "decide", "figure out", "why", or "design", use Fable.
- A ticket typically runs **Fable (plan) → Opus (implement) → Fable (review)**. A pure-scaffolding or docs ticket can run Opus → Opus.

## 3. The loop (per ticket)

1. **Select.** Read `TASKS.md`; take the first unchecked ticket whose gate is open (see `docs/decisions/0001-week0-gates.md`).
   Read `docs/PLAN.md` for that ticket's section. Do not start a ticket that a gate has closed.
2. **Plan** (Fable). Brief: ticket text + plan section + relevant files + the definition of done. Output must include: files,
   interfaces (typed), acceptance tests (as `it(...)` names or manual device steps), risks, open questions. If open questions
   block implementation, the orchestrator answers them from `docs/PLAN.md`; if the plan doesn't answer, the orchestrator asks
   the human once and records the answer in `docs/decisions/`.
3. **Implement** (Opus unless the plan flags judgement). Brief: the plan verbatim + "run `pnpm typecheck && pnpm test` (+ `pnpm lint:words`);
   return a summary of changes, test results, and anything you could not do". Parallelise independent files across implementers
   when the plan marks them independent.
4. **Review** (Fable). Brief: the plan + `git diff` + "findings ranked by severity, file:line, one line each; confirm the acceptance
   tests exist and pass". Findings of severity high/medium go back to an implementer (Opus) with the finding text as the brief.
   Loop at most twice; then escalate to the human.
5. **Record.** Orchestrator ticks the ticket in `TASKS.md`, adds a `docs/decisions/NNNN-*.md` if anything non-obvious was decided,
   asks a Scribe (Opus) to write friction logs for any platform pain the implementer reported, commits with a conventional
   message and the attribution trailer, pushes, and checks CI.
6. **Report.** One paragraph to the human: what shipped, what was decided, what's next, anything blocked.

## 4. Invariants the orchestrator enforces in every brief

- Sizes in `shared-ui` are px at 1920×1080 × `scale`; colours only from `theme/tokens.ts`; focus is outline + scale, never colour alone;
  every focusable has an `aria-label` stating purpose. `shared-ui` imports nothing outside Vega's supported library list.
- Cite the doc URL for any Amazon or AWS API touched (in the PR/commit body).
- Tests before behaviour; fixtures for anything with numbers (cue timing, angles, SM-2, ducking).
- Wording rules in `docs/decisions/0002-wording.md`; `pnpm lint:words` must pass.
- Every platform rough edge becomes a friction log the same day (`pnpm friction "<title>"`). These are scored.
- Commits end with the attribution trailer already used in this repo's history. Never force-push `main`.

## 5. Sub-agent brief template

```
ROLE: <Planner|Implementer|Reviewer|Spike|Scribe>   MODEL: <fable|opus>   TICKET: <ID> — <title>
CONTEXT (read first): docs/PLAN.md §<n>; TASKS.md; <files>; docs/decisions/<relevant>
GOAL: <one sentence>
CONSTRAINTS: <invariants from §4 that apply; interfaces that must not change>
DELIVERABLE: <exact artefact — plan sections | code + tests + check output | findings list | evidence + friction log>
DONE WHEN: <mechanical checks; acceptance tests by name>
DO NOT: <scope you are excluding>
```

## 6. Escalate to the human when

a gate decision is needed (Sept 17), a plan needs an interface change that affects another repo (kit ↔ apps), the review loop
fails twice, hardware or credentials are needed, or anything would cost more than ~$10 of AWS in one run.
