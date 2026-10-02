# Tickets (build order) — see docs/PLAN.md §10

Platform: Fire OS only; Vega deferred (decision 0004). Freeze Oct 15, submit Oct 22.

**Next (most impact): DESC-005** — the Described app has never run on the stick (Gate A ran through the kit's harness).
It is the demo, it unblocks DESC-006–009, and it needs no pipeline work: Sintel is already published.

- [x] DESC-001 · week 0 · Three narrated shots end to end (Sintel 0:00–1:00; run on 1:30–2:30 and 1:30–3:30, see 0003) → decides Gate A
  - part 2: deployed, paid run published, Gate A passed on Fire OS (Vega deferred), Gate C passed with Qwen3-VL 235B (72.4 %, decision 0003)
- [ ] DESC-002 · week 1 · Monorepo + CDK + API skeleton on Fire OS, using vega-media-kit (decision 0004)
  - [x] Prisma migrate wired (`20260915092437_init`); dev stacks deployed (DESC-001)
  - [ ] `pnpm dev` runs API + Expo (`apps/expo` has no `dev` script yet)
  - unused `described-nova-<stage>` stack and Nova IAM: removal is DESC-015
  - Vega: `apps/vega` stays a template; built only if the Vega SDK is installed and kit KIT-010 lands
- [ ] DESC-003 · week 1 · Pipeline steps 1–5 as pg-boss jobs (probe, shots, speech map, describe, fit) + fit fixtures
  - one job per step (`worker.ts` runs the whole pipeline as one `describe` job today); cost recorded per job
  - describe calls Qwen3-VL on Bedrock directly, no Strands agent (decision 0005); no paid runs without the human
  - land DESC-016's per-shot describe cache with the describe job, so a retry does not re-buy finished shots (decision 0005)
  - Nova Lite shortener must not change facts ("wing" → "wings")
  - follow-ups from review: known names for German transcripts (every noun is capitalised; needs another signal); names that only ever open a sentence ("Sintel, wait.") are missed; capExtended cuts an over-long extended cue at 25 words mid-clause when shortening fails
- [ ] DESC-004 · week 1 · Pipeline steps 6–10 (Polly, mix, SDH, package, publish); manifest validated with the kit's HLS and VTT parsers (decision 0004)
  - buildPackagerArgs(language, hasCaptions, hasSdh, hasDescriptions) — hasSdh/hasDescriptions added in DESC-001 (omit a text track that is degraded or empty)
- [ ] DESC-005 · week 1 · Home + Title screens with tokens, Atkinson Hyperlegible via expo-font, skeletons, focus memory — running on the stick
  - font files are not in the repo yet; load them in `apps/expo` (platform wiring stays out of shared-ui)
  - focus on the kit's `focus` module (`useFocusMemory`, `useDpad`, `FocusRow`) over react-tv-space-navigation — `Focusable` still uses `Pressable` (friction 2026-09-26 D-pad latency)
  - `apps/expo/metro.config.js` with the custom resolver (friction 2026-09-26 Metro exports condition order)
  - done when: on the stick, Home → Title → Play reaches the published Sintel with AD selected, D-pad only
- [ ] DESC-006 · week 2 · Player + track sheet: chrome auto-hide, status line, seek, crossfade, Back saves progress
- [ ] DESC-007 · week 2 · Extended mode: per-cue Polly audio, prefetch 10 s, pause–speak–resume, ochre bar, setting
- [ ] DESC-008 · week 2 · Platform bindings: Content Launcher catalog + intents, Personalization, Media Controls, Alexa pause
- [ ] DESC-009 · week 2 · First run + Settings + full VoiceView pass
  - decide where `prefs.adDefault` applies (since DESC-005 the play action picks AD; nothing reads the setting)
- [ ] DESC-010 · week 3 · Five titles processed; physical 4K Select; TTFF < 2 s (Vega build deferred, decision 0004)
  - `build:tv` (EAS) cannot work while the kit comes from the `link:../vega-media-kit` override: EAS uploads only this repo; publish the kit (0.1.0) or vendor it first. Build locally with `expo run:android --variant release` until then
  - re-check hardware decode on the stick with the 1920×818 L4.0 rendition
- [ ] DESC-011 · week 4 · Polish, docs/screens, README, docs/aws.md, feedback, feature requests, ≥ 8 friction logs · freeze Oct 15
  - rail: Described (described titles grid) and My list screens + a My list API; both rail items open Home today (DESC-005)
- [ ] DESC-012 · week 5 · Video + submission (Oct 22)
- [ ] DESC-013 · follow-up · Narration end measured from Polly MP3 duration (cue overrun into dialogue)
- [ ] DESC-014 · follow-up · SDH for full-length titles: additions-only reply or chunked Nova Lite calls (4000-token limit)
- [ ] DESC-015 · follow-up · Shortener may not change facts (wing→wings); remove dead Nova video path, nova-ingest stack, unused IAM (nova GetObject, InvokeModelWithResponseStream, Nova Pro)
- [ ] DESC-016 · follow-up · Publish hygiene: clear stale hls/ and cue_*.mp3 on --from reruns; mutable VTT/cue cache-control; per-shot describe cache
