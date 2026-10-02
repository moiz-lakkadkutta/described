# 0004 — Vega build deferred; DESC-002 and DESC-004 re-scoped onto vega-media-kit

Status: accepted 2026-10-01
Tickets: DESC-002, DESC-004, DESC-010 · Follows: 0001 (Gate B: Fire OS primary, Vega experimental)

## Context

DESC-002 asked for `pnpm vega` to build the Vega app. Two facts make that unreachable before the Oct 15 freeze:

- No Vega SDK is installed (≈ 20 GB plus an unknown day of setup); the Vega Virtual Device has never run.
- `@moizp/vega-media-kit`, which every screen plays through, labels its Vega adapter experimental and "does not work as
  written": the rewrite onto `VideoPlayer` / `KeplerVideoSurfaceView` (KIT-010) and the Vega platform bindings (KIT-007)
  are deferred — kit decision 0001, https://github.com/moiz-lakkadkutta/vega-media-kit/blob/main/docs/decisions/0001-week0-gates.md

The kit already supplies the cross-platform pieces DESC-002 meant to take from the multi-TV sample (player, cue overlay,
platform bindings, focus helpers), and its `core` subpath runs in Node.

## Decision

1. **Vega build deferred.** `apps/vega` stays a template (`App.template.tsx` + README). It is built only if the Vega SDK is
   installed and KIT-010 lands. DESC-002 no longer requires `pnpm vega`; DESC-010 no longer requires a VVD build.
   The hackathon accepts "Fire OS *or* Vega OS", so eligibility is unaffected.
2. **DESC-002 is Fire OS only**, on vega-media-kit (consumed through the `link:../vega-media-kit` override until 0.1.0 is
   on npm). `packages/shared-ui` keeps the Vega-supported import rule so the Vega path stays open.
3. **DESC-004 validates manifests with the kit's parsers, not Shaka's.** `parseHlsMaster`, `audioTracksFromHls`,
   `textTracksFromHls` and `parseVtt` from `@moizp/vega-media-kit/core` run in Node and in CI without a browser; Shaka's
   manifest parser would need one. Pass: two audio renditions (Original; Audio description with
   `CHARACTERISTICS="public.accessibility.describes-video"`), the expected text tracks, every VTT parses.

## Consequences

- The plan's "App runs on the Fire OS stick and in the Vega Virtual Device" (PLAN §2) reads as Fire OS only for this entry.
- README and the submission describe Vega as experimental, matching the kit.
- Reopen when: the Vega SDK is installed and KIT-010 is merged.
