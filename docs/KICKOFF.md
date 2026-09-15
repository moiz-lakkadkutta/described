# Kickoff prompt for the orchestrator

Paste this into a fresh Claude Code session at the repo root. Protocol: docs/ORCHESTRATOR.md.

```
You are the ORCHESTRATOR for ~/hackathon/described. Read docs/ORCHESTRATOR.md first and follow it exactly: you facilitate; sub-agents plan, implement and review. Model routing: fable for judgement (planning, prompts, review, debugging, accessibility), opus for well-bounded implementation with mechanical acceptance.

Load before anything else: README.md, docs/PLAN.md (and the full plan it links), TASKS.md, CLAUDE.md, docs/decisions/*, apps/api/prisma/schema.prisma, packages/contracts/src/index.ts, packages/pipeline/src/**, packages/shared-ui/src/{theme,strings.ts,screens,index.tsx}, infra/lib/*. The kit is consumed via `link:../vega-media-kit`; read ../vega-media-kit/README.md and src/player/types.ts so briefs use the real KitPlayer API. Baseline: `pnpm i && pnpm db:up && pnpm db:migrate && pnpm typecheck && pnpm test && pnpm lint:words` — report it.

Non-negotiables to put in every brief: description ON by default; AD is an audio rendition (role=description) — the TV plays one stream; extended cues live in the descriptions text track with {extended=1} meta and are spoken by the app (pause–speak–resume); description prompt rules and the 160 wpm budget in packages/pipeline/src/prompts.ts are product decisions (change only via docs/decisions); mix = −9 dB sidechain duck, −24 LUFS, −2 dBTP; type floor 28 px, body 32, captions 44, no pure white, focus = outline + 1.04 scale; Atkinson Hyperlegible; copy says "described" and "on/off", never the blocklisted words; every focusable has an aria-label of purpose; CC-BY content only.

Run the ticket loop from TASKS.md in order:
- DESC-001 (Spike fable, then Implementer opus): three narrated shots of Sintel 0:00–1:00 end to end through the real pipeline (probe → shots → speech map → describe with Nova Pro via S3 URI in us-east-1 → fit → Polly → mix → package → publish to the dev CloudFront). Needs AWS creds and `cdk deploy -c stage=dev` first (Implementer opus, plan by fable). Deliverable: a playable master.m3u8 URL with an AD rendition and docs/decisions/0001-week0-gates.md Gate A/C evidence. Record Nova token counts and cost in docs/aws.md.
- DESC-003 then DESC-004 (Planner fable → Implementer opus): pipeline steps as pg-boss jobs with the worker writing Title/Shot/Gap/DescriptionCue/Rendition/TextTrack rows and Job cost; fixture tests for fit extended; the describe step must fill `known_names` from Transcribe speaker turns.
- DESC-005/006/007 (Planner fable → Implementer opus → Reviewer fable): Home + Title, then Player + TrackSheet (chrome auto-hide 4 s, status line, seek, 300 ms crossfade on audio switch, Back saves progress), then Extended mode with per-cue Polly audio prefetched 10 s ahead. Remote wiring through the kit's useRemote in Root.
- DESC-008 (Spike fable for the Vega binding names, Implementer opus): Content Launcher catalog + intents, Personalization, Media Controls, Alexa pause/resume; journalctl transcript committed.
- DESC-009 (Implementer opus, Reviewer fable with an accessibility focus): First run + Settings + full VoiceView pass; the reviewer must simulate a screen-reader-only walk of every screen from the strings and aria-labels.

After every ticket: Scribe (opus) writes friction logs for any platform pain reported; you tick TASKS.md, commit with the attribution trailer, push, check CI. Weekly demo Friday: ask a Reviewer (fable) to assess the app against docs/PLAN.md §1 reward map and list the three highest-value gaps. Escalate to me for: gate decisions, kit interface changes, anything over ~$10 AWS in one run, or two failed review loops. Begin with the baseline report and the DESC-001 spike brief.
```
