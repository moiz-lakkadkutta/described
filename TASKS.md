# Tickets (build order) — see docs/PLAN.md §10

Platform: Fire OS only; Vega deferred (decision 0004). Freeze Oct 15, submit Oct 22.
- Vega note: `apps/vega/App.template.tsx` never calls `configureRemote`, so no D-pad, Settings ◄► or Player keys reach shared-ui there; wire a TVEventHandler key source when the Vega build resumes.

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
  - kit: KitPlayerRef.setVolume landed (kit PR #1); the audio switch is a 300 ms crossfade (selectAudio at the midpoint, a newer switch takes over mid-fade). Device check: docs/device-checks/DESC-006.md §4
  - kit: TextTrack.characteristics (HLS CHARACTERISTICS), so the Player's extra master-playlist fetch for Rich vs plain captions can go
  - kit: the Fire OS adapter's seek should set position.current (and honour startAt), so getPosition is right before the next onProgress; the Player works around it with a pending-seek position and a resume seek
- [ ] DESC-007 · week 2 · Extended mode: per-cue Polly audio, prefetch 10 s, pause–speak–resume, ochre bar, setting
- [ ] DESC-008 · week 2 · Platform bindings: Content Launcher catalog + intents, Personalization, Media Controls, Alexa pause
  - research + decisions: docs/platform/fire-os-bindings.md; device check: docs/device-checks/DESC-008.md (not run yet)
  - [x] deep links `described://title/{slug}`, `described://play/{slug}?t=…` (scheme intent filter, Root routing)
  - [x] Alexa transport via a local MediaSession module (`apps/expo/modules/described-media-session`) — Kotlin not compiled yet; exclude it from autolinking if the release build fails
  - [x] draft catalog feed `GET /catalog/fire-tv.xml` (CDF shape, unverified against the XSD)
  - submission time, human + Amazon developer account: ask for catalog integration (select partners only; new partners use EMBER, not CDF); if accepted, upload the feed and do Fire TV launcher integration (`com.amazon.device.CAPABILITIES` broadcast)
  - not before freeze: Content Personalization (Fire TV Integration SDK jar + data integration service; needs catalog integration) — reporter stays a no-op
  - merged with DESC-006: bindings consume Player's `onNowPlaying` in Root; one handler per media key (session: 126/127/86, Player keys: 85/89/90)
  - Vega Content Launcher / journalctl transcript (KICKOFF) deferred with Vega (decision 0004)
  - exactly one path owns the media keys (Play/Pause, FF/RW): the Player's subscribeKeys today; Media Controls / MediaSession must not handle the same key again (two toggles = no change) — done in DESC-008: the session owns 126/127/86 only while native reports it active, the key hub skips them; Player's subscribeKeys owns 85/89/90
- [ ] DESC-009 · week 2 · First run + Settings + full VoiceView pass
  - decide where `prefs.adDefault` applies (since DESC-005 the play action picks AD; nothing reads the setting)
    → decided: it picks the primary play action (▶ style + initial focus) on the Home hero and on Title — on: Play with
      description, off: Play / Play without description. Order and labels unchanged; Player still follows the action pressed.
  - prompt clips for the app voice (first-run panels, Settings "Hear it") are not generated yet: the app requests
    `/prompts/<voice>/<key>.mp3` (API → CloudFront `prompts/`); text in `promptText` (packages/contracts). TODO(DESC-010): pipeline step.
  - kit follow-up: CueTheme has no text shadow, so Caption style "Shadow" is a lighter box for now (`cueShadowBox` token, Player `cueTheme`); add `textShadow` to the kit's CueOverlay, then switch Shadow to it
  - human VoiceView run-through: `docs/a11y/voiceview-checklist.md` → commit as `docs/a11y/voiceview-2026-10-xx.md`
- [ ] DESC-010 · week 3 · Five titles processed; physical 4K Select; TTFF < 2 s (Vega build deferred, decision 0004)
  - `build:tv` (EAS) cannot work while the kit comes from the `link:../vega-media-kit` override: EAS uploads only this repo; publish the kit (0.1.0) or vendor it first. Build locally with `expo run:android --variant release` until then
  - re-check hardware decode on the stick with the 1920×818 L4.0 rendition
  - generate the app-voice prompt clips with Polly in each voice's language: per voice × PromptKey, `LanguageCode = voiceLanguage[voice]`,
    `Text = promptTextFor(voice, key)` (packages/contracts; de-DE for Vicki and Daniel), neural mp3, upload to `prompts/<voice>/<key>.mp3`
  - the Settings Voice changes only the app's own prompts (first run, Hear it); description tracks keep the title's voice (`Title.voice`, chosen per title in the pipeline)
- [ ] DESC-011 · week 4 · Polish, docs/screens, README, docs/aws.md, feedback, feature requests, ≥ 8 friction logs · freeze Oct 15
  - rail: Described (described titles grid) and My list screens + a My list API; both rail items open Home today (DESC-005)
- [ ] DESC-012 · week 5 · Video + submission (Oct 22)
- [ ] DESC-013 · follow-up · Narration end measured from Polly MP3 duration (cue overrun into dialogue)
- [ ] DESC-014 · follow-up · SDH for full-length titles: additions-only reply or chunked Nova Lite calls (4000-token limit)
- [ ] DESC-015 · follow-up · Shortener may not change facts (wing→wings); remove dead Nova video path, nova-ingest stack, unused IAM (nova GetObject, InvokeModelWithResponseStream, Nova Pro)
- [ ] DESC-016 · follow-up · Publish hygiene: clear stale hls/ and cue_*.mp3 on --from reruns; mutable VTT/cue cache-control; per-shot describe cache
