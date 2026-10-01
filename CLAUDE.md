# Described — notes for coding agents

Audio description and rich captions for video that has none — Nova describes, Polly speaks, Fire TV's own audio-track selector delivers.

- pnpm + Turborepo monorepo. `apps/api` (Express 4 + Zod + Prisma + pg-boss + Socket.IO), `apps/expo` (Fire OS),
  `apps/vega` (Vega OS, created with the Vega CLI), `packages/shared-ui` (screens; **no native imports outside the Vega-supported list**),
  `packages/contracts` (Zod schemas shared by api/ui/phone), `packages/pipeline` (media + AI jobs), `infra` (CDK).
- Design tokens live in `packages/shared-ui/src/theme/tokens.ts`. Sizes are px at 1920×1080 × `scale` (Fire OS 0.5, Vega 1). Never hard-code a colour outside tokens.
- Focus is a physical change (outline + 1.04 scale, 150 ms), never colour alone. Every focusable has `aria-label` stating purpose.
- Read the plan first: docs/PLAN.md. Tickets in TASKS.md. Friction → `pnpm friction "<title>"`.
- Research before writing: cite the doc URL in the PR for any Amazon/AWS API you touch.
- Wording rules: docs/decisions/0002-wording.md (enforced by `pnpm lint:words`).

## Development style

Orchestrator + sub-agents. The main session only facilitates; planning, implementation and review are done by sub-agents (fable for judgement, opus for well-bounded implementation). Protocol: docs/ORCHESTRATOR.md. Kickoff prompt: docs/KICKOFF.md.
