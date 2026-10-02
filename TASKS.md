# Tickets (build order) — see docs/PLAN.md §10

Platform: Fire OS only; Vega deferred (decision 0004). Freeze Oct 15, submit Oct 22.

**Next (most impact): DESC-005** — the Described app has never run on the stick (Gate A ran through the kit's harness).
It is the demo, it unblocks DESC-006–009, and it needs no pipeline work: Sintel is already published.

- [x] DESC-001 · week 0 · Three narrated shots end to end (Sintel 0:00–1:00) → decides Gate A
  - part 2: deployed, paid run published, Gate A passed on Fire OS (Vega deferred), Gate C passed with Qwen3-VL 235B (72.4 %, decision 0003)
- [ ] DESC-002 · week 1 · Monorepo + CDK + API skeleton on Fire OS, using vega-media-kit (decision 0004)
  - [x] Prisma migrate wired (`20260915092437_init`); dev stacks deployed (DESC-001)
  - [ ] `pnpm dev` runs API + Expo (`apps/expo` has no `dev` script yet)
  - [ ] remove the unused `described-nova-<stage>` stack and `S3_BUCKET_NOVA_INGEST` (describe reads key frames since Gate C)
  - Vega: `apps/vega` stays a template; built only if the Vega SDK is installed and kit KIT-010 lands
- [ ] DESC-003 · week 1 · Pipeline steps 1–5 as pg-boss jobs (probe, shots, speech map, describe, fit) + fit fixtures
  - one job per step (`worker.ts` runs the whole pipeline as one `describe` job today); cost recorded per job
  - describe calls Qwen3-VL on Bedrock directly, no Strands agent (decision 0005); no paid runs without the human
  - per-shot describe cache; Nova Lite shortener must not change facts ("wing" → "wings")
- [ ] DESC-004 · week 1 · Pipeline steps 6–10 (Polly, mix, SDH, package, publish); manifest validated with the kit's HLS and VTT parsers (decision 0004)
  - buildPackagerArgs(language, hasCaptions, hasSdh) — hasSdh added in DESC-001 Gate C (omit Rich captions when SDH degraded)
- [ ] DESC-005 · week 1 · Home + Title screens with tokens, Atkinson Hyperlegible via expo-font, skeletons, focus memory — running on the stick
  - font files are not in the repo yet; load them in `apps/expo` (platform wiring stays out of shared-ui)
  - focus on the kit's `focus` module (`useFocusMemory`, `useDpad`, `FocusRow`) over react-tv-space-navigation — `Focusable` still uses `Pressable` (friction 2026-09-26 D-pad latency)
  - `apps/expo/metro.config.js` with the custom resolver (friction 2026-09-26 Metro exports condition order)
  - done when: on the stick, Home → Title → Play reaches the published Sintel with AD selected, D-pad only
- [ ] DESC-006 · week 2 · Player + track sheet: chrome auto-hide, status line, seek, crossfade, Back saves progress
  - kit: pass volume through KitPlayerRef (setVolume) so the 300 ms crossfade works on Fire OS; until then the switch is a hard cut
  - kit: TextTrack.characteristics (HLS CHARACTERISTICS), so the Player's extra master-playlist fetch for Rich vs plain captions can go
  - kit: the Fire OS adapter's seek should set position.current (and honour startAt), so getPosition is right before the next onProgress; the Player works around it with a pending-seek position and a resume seek
- [ ] DESC-007 · week 2 · Extended mode: per-cue Polly audio, prefetch 10 s, pause–speak–resume, ochre bar, setting
- [ ] DESC-008 · week 2 · Platform bindings: Content Launcher catalog + intents, Personalization, Media Controls, Alexa pause
  - exactly one path owns the media keys (Play/Pause, FF/RW): the Player's subscribeKeys today; Media Controls / MediaSession must not handle the same key again (two toggles = no change)
- [ ] DESC-009 · week 2 · First run + Settings + full VoiceView pass
  - decide where `prefs.adDefault` applies (since DESC-005 the play action picks AD; nothing reads the setting)
- [ ] DESC-010 · week 3 · Five titles processed; physical 4K Select; TTFF < 2 s (Vega build deferred, decision 0004)
  - `build:tv` (EAS) cannot work while the kit comes from the `link:../vega-media-kit` override: EAS uploads only this repo; publish the kit (0.1.0) or vendor it first. Build locally with `expo run:android --variant release` until then
  - re-check hardware decode on the stick with the 1920×818 L4.0 rendition
- [ ] DESC-011 · week 4 · Polish, docs/screens, README, docs/aws.md, feedback, feature requests, ≥ 8 friction logs · freeze Oct 15
  - rail: Described (described titles grid) and My list screens + a My list API; both rail items open Home today (DESC-005)
- [ ] DESC-012 · week 5 · Video + submission (Oct 22)
