# Tickets (build order) — see docs/PLAN.md §10

- [x] DESC-001 · week 0 · Three narrated shots end to end (Sintel 0:00–1:00) (run on 1:30–2:30 / 1:30–3:30, see 0003) → decides Gate A
  - part 2: deployed, paid run published, Gate A passed on Fire OS (Vega deferred), Gate C passed with Qwen3-VL 235B (72.4 %, decision 0003)
- [ ] DESC-002 · week 1 · Monorepo + CDK + API skeleton (this scaffold; wire Prisma migrate, deploy dev stacks)
- [ ] DESC-003 · week 1 · Pipeline steps 1–5 as pg-boss jobs (probe, shots, speech map, describe, fit) + fit fixtures
- [ ] DESC-004 · week 1 · Pipeline steps 6–10 (Polly, mix, SDH, package, publish) + manifest validation
  - buildPackagerArgs(language, hasCaptions, hasSdh) — hasSdh added in DESC-001 Gate C (omit Rich captions when SDH degraded)
- [ ] DESC-005 · week 1 · Home + Title screens with tokens, Atkinson Hyperlegible via expo-font, skeletons, focus memory
- [ ] DESC-006 · week 2 · Player + track sheet: chrome auto-hide, status line, seek, crossfade, Back saves progress
- [ ] DESC-007 · week 2 · Extended mode: per-cue Polly audio, prefetch 10 s, pause–speak–resume, ochre bar, setting
- [ ] DESC-008 · week 2 · Platform bindings: Content Launcher catalog + intents, Personalization, Media Controls, Alexa pause
- [ ] DESC-009 · week 2 · First run + Settings + full VoiceView pass
- [ ] DESC-010 · week 3 · Five titles processed; Vega build in VVD; physical 4K Select; TTFF < 2 s
- [ ] DESC-011 · week 4 · Polish, docs/screens, README, docs/aws.md, feedback, feature requests, ≥ 8 friction logs · freeze Oct 15
- [ ] DESC-012 · week 5 · Video + submission (Oct 22)
- [ ] DESC-013 · follow-up · Narration end measured from Polly MP3 duration (cue overrun into dialogue)
- [ ] DESC-014 · follow-up · SDH for full-length titles: additions-only reply or chunked Nova Lite calls (4000-token limit)
- [ ] DESC-015 · follow-up · Shortener may not change facts (wing→wings); remove dead Nova video path, nova-ingest stack, unused IAM (nova GetObject, InvokeModelWithResponseStream, Nova Pro)
- [ ] DESC-016 · follow-up · Publish hygiene: clear stale hls/ and cue_*.mp3 on --from reruns; mutable VTT/cue cache-control; per-shot describe cache
