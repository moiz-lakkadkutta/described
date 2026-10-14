# Tickets (build order) — see docs/PLAN.md §10

Platform: Fire OS only; Vega deferred (decision 0004). Freeze Oct 15, submit Oct 22.
- Vega: `apps/vega/App.template.tsx` wires Vega's `TVEventHandler` through `configureRemote` (#10); still a template, not built.

**Status 2026-10-14 (main 788e973).** Merged: #1–#31. Device run 2026-10-10 on the stick (release build, `docs/device-checks/RUN-2026-10.md`):
checks 1–13 passed; check 14 (Alexa) failed for fast forward / rewind and was fixed in #31; check 14 (re-run), 15 offline,
16 stalls, 17 VoiceView and the re-checks of #30 are still to run on 788e973. The results table in RUN-2026-10.md is not filled in yet.
**Next:** DESC-010 (five titles, branch `claude/desc-010`), then the remaining device checks, then DESC-011 screenshots.

- [x] DESC-001 · week 0 · Three narrated shots end to end (Sintel 0:00–1:00; run on 1:30–2:30 and 1:30–3:30, see 0003) → decides Gate A
  - part 2: deployed, paid run published, Gate A passed on Fire OS (Vega deferred), Gate C passed with Qwen3-VL 235B (72.4 %, decision 0003)
- [x] DESC-002 · week 1 · Monorepo + CDK + API skeleton on Fire OS, using vega-media-kit (decision 0004)
  - [x] Prisma migrate wired (`20260915092437_init`); dev stacks deployed (DESC-001)
  - [x] `pnpm dev` runs API + Expo (`apps/expo` `dev` script, #10; root `turbo run dev --parallel`)
  - [x] unused `described-nova-<stage>` stack and Nova IAM removed (DESC-015, #9)
  - Vega: `apps/vega` stays a template; built only if the Vega SDK is installed and kit KIT-010 lands
- [ ] DESC-003 · week 1 · Pipeline steps 1–5 as pg-boss jobs (probe, shots, speech map, describe, fit) + fit fixtures (needs: worker run, `docs/device-checks/DESC-003.md` §B)
  - [x] one job per step 1–5 (`pipeline-probe` … `pipeline-fit`; `pipeline-finish` runs edit … publish in one job, `packages/pipeline/src/jobs.ts`); cost recorded per job (`Job.costUsd`, #3)
  - [x] describe calls Qwen3-VL on Bedrock directly, no Strands agent (decision 0005); no paid runs without the human
  - [x] per-shot describe cache with the describe job, so a retry does not re-buy finished shots (`cachedDescribe` in `04-describe.ts`, #3)
  - [x] Nova Lite shortener must not change facts ("wing" → "wings"): `preservesFacts` in `05-fit.ts`, tests in `test/fit.test.ts`
  - [x] follow-ups from review: German known names (#15, `knownNames` in `04-describe.ts`: a name cue word or a vocative, heard twice);
    a name that only opens a sentence ("Sintel, wait.") counts once it is heard again; capExtended cuts at a clause end (`cutAt`, #15)
  - [x] first paid run, CLI path (§A): sintel-90-150-r2, 2026-10-04, $0.0499, validate clean
- [x] DESC-004 · week 1 · Pipeline steps 6–10 (Polly, mix, SDH, package, publish); manifest validated with the kit's HLS and VTT parsers (decision 0004)
  - [x] `validate` step between package and publish (kit `parseHlsMaster` / `parseVtt`); Rendition and TextTrack rows written (#16, #17)
  - [x] buildPackagerArgs(language, hasCaptions, hasSdh, hasDescriptions) omits a degraded or empty text track (`09-package.ts`)
- [ ] DESC-005 · week 1 · Home + Title screens with tokens, Atkinson Hyperlegible via expo-font, skeletons, focus memory — running on the stick (needs: device checks 15 offline and 17 VoiceView)
  - [x] fonts in `apps/expo/assets/fonts` (Atkinson Hyperlegible Regular and Bold), loaded with expo-font in `apps/expo` (#4)
  - [x] focus: `Focusable` on react-tv-space-navigation (6.0.0-beta1 since #23) with the kit's focus memory; no `Pressable` focus left
  - [x] `apps/expo/metro.config.js` with the custom resolver (friction 2026-09-26 Metro exports condition order)
  - [x] done when: on the stick, Home → Title → Play reaches the published Sintel with AD selected, D-pad only (device run 2026-10-10, checks 1–5)
- [ ] DESC-006 · week 2 · Player + track sheet: chrome auto-hide, status line, seek, crossfade, Back saves progress (needs: re-check of check 6 on 788e973; kit follow-ups)
  - [x] Player, track sheet, progress (#5); device run 2026-10-10 checks 5–8 passed
  - [x] audio switch through the kit's `KitPlayerRef.setVolume` (kit PR #1, #18): fades down over 150 ms, selects, holds silent 150 ms across
    ExoPlayer's decoder reset (#30, DESC-021), then fades up over 150 ms (≈ 450 ms; a newer switch takes over mid-fade). Device check: docs/device-checks/DESC-006.md §4
  - [ ] kit: TextTrack.characteristics (HLS CHARACTERISTICS), so the Player's extra master-playlist fetch for Rich vs plain captions can go
    (the kit's `TextTrack` still has no `characteristics`; the Player uses `characteristicsByUri`, `packages/shared-ui/src/playback.ts`)
  - [ ] kit: the Fire OS adapter's seek should set position.current (and honour startAt), so getPosition is right before the next onProgress;
    the Player works around it with a pending-seek position and a resume seek (`Player.tsx`)
- [ ] DESC-007 · week 2 · Extended mode: per-cue Polly audio, prefetch 10 s, pause–speak–resume, ochre bar, setting (needs: a DESC-010 title with extended cues, then `docs/device-checks/DESC-007.md`)
  - [x] code merged (#8); extended cues from dropped plot events (DESC-020, #29)
- [ ] DESC-008 · week 2 · Platform bindings: Content Launcher catalog + intents, Personalization, Media Controls, Alexa pause (needs: RUN-2026-10 check 14 with voice on 788e973)
  - research + decisions: docs/platform/fire-os-bindings.md; device check: docs/device-checks/DESC-008.md
  - [x] deep links `described://title/{slug}`, `described://play/{slug}?t=…` (scheme intent filter, Root routing); device run check 12 passed
  - [x] Alexa transport via a local MediaSession module (`apps/expo/modules/described-media-session`); compiles in the release build (device run 2026-10-10)
  - [x] session visibility follows activity start/stop, not onPause, so "Alexa, fast forward / rewind / restart" (sent as `onSeekTo`) reach the
    Player; native logs at `Log.i` (#31). "Alexa, go to N seconds" is absolute time, which Fire TV's mapping does not support: not a failure
  - [x] draft catalog feed `GET /catalog/fire-tv.xml` (CDF shape, unverified against the XSD)
  - submission time, human + Amazon developer account: ask for catalog integration (select partners only; new partners use EMBER, not CDF); if accepted, upload the feed and do Fire TV launcher integration (`com.amazon.device.CAPABILITIES` broadcast)
  - not before freeze: Content Personalization (Fire TV Integration SDK jar + data integration service; needs catalog integration) — reporter stays a no-op
  - merged with DESC-006: bindings consume Player's `onNowPlaying` in Root; one handler per media key (session: 126/127/86, Player keys: 85/89/90)
  - Vega Content Launcher / journalctl transcript (KICKOFF) deferred with Vega (decision 0004)
  - [x] exactly one path owns the media keys: the session owns 126/127/86 only while native reports it active, the key hub skips them;
    Player's subscribeKeys owns 85/89/90 (device run check 13 passed)
- [ ] DESC-009 · week 2 · First run + Settings + full VoiceView pass (needs: human VoiceView run)
  - [x] First run, Settings, About (#7); first run passed on the stick (device run check 1)
  - [x] `prefs.adDefault` picks the primary play action (▶ style + initial focus) on the Home hero and on Title — on: Play with
    description, off: Play / Play without description. Order and labels unchanged; Player still follows the action pressed.
  - [x] prompt clips for the app voice (first-run panels, Settings "Hear it"): the app requests `/prompts/<voice>/<key>.mp3`
    (API → CloudFront `published/prompts/`, #13); generated by `pnpm pipeline prompts --run` (DESC-010, 2026-10-14: 16 clips, $0.02)
  - [ ] kit follow-up: CueTheme has no text shadow, so Caption style "Shadow" is a lighter box for now (`cueShadowBox` token, Player `cueTheme`); add `textShadow` to the kit's CueOverlay, then switch Shadow to it
  - [ ] human VoiceView run-through: `docs/a11y/voiceview-checklist.md` → commit as `docs/a11y/voiceview-2026-10-xx.md`
- [ ] DESC-010 · week 3 · Five titles processed; physical 4K Select; TTFF < 2 s (Vega build deferred, decision 0004) (needs: a 4K Select run, TTFF)
  - [x] five titles live (2026-10-14): Sintel, Big Buck Bunny, Elephants Dream, Caminandes: Gran Dillama, Tears of Steel — 60 s segments, CC-BY,
    each described end to end by the CLI (Sintel re-run 2026-10-14 so its cue and track rows exist); sources, segments, credits, costs and the
    VTT faults found in `docs/titles.md`; rows in `apps/api/prisma/titles.json` (`pnpm titles:seed`, also the Prisma seed); the CLI writes
    durationS, voice, language, cues and tracks and marks the title published itself (`persistForCli`)
  - [ ] device (human): physical 4K Select; TTFF < 2 s on the new titles
  - `build:tv` (EAS) cannot work while the kit comes from the `link:../vega-media-kit` override: EAS uploads only this repo; publish the kit (0.1.0) or vendor it first. Build locally with `expo run:android --variant release` until then
  - [x] hardware decode on the stick with the 1920×818 L4.0 rendition: `OMX.MTK.VIDEO.DECODER.AVC`, no software fallback (device run check 4).
    First frame 1.8–2.1 s on the stick, so TTFF < 2 s is not met on every try; re-measure on the 4K Select
  - [x] poster and hero stills from probe, admin `posterKey` / `heroKey` (#13)
  - [x] generate the app-voice prompt clips with Polly in each voice's language: `pnpm pipeline prompts --run` (#13; per voice × PromptKey,
    `LanguageCode = voiceLanguage[voice]`, `Text = promptTextFor(voice, key)`, neural mp3, `published/prompts/<voice>/<key>.mp3`); 16 clips published 2026-10-14, $0.02
  - the Settings Voice changes only the app's own prompts (first run, Hear it); description tracks keep the title's voice (`Title.voice`, chosen per title in the pipeline)
  - pipeline follow-ups from the batch (docs/titles.md): a split text clause leaves its modifier behind ("Darkness. in metallic silver, centered.");
    on-screen text phrased as `headline: "…"` is not a text clause and can be dropped; "Darkness." prefixed to a visible scene; the
    `grid-test-*` filler rows are still published (device run §18 clean-up not run; a seed cannot create them)
  - [x] SDH (claude/desc-010-sdh-fixes): additions need evidence (a description naming the sound's source, audible audio, a spoken name);
    greedy decoding and a per-window reply cache make re-runs repeatable; a 424 is retried once, then the window stays plain. Re-run
    `--from text`: sintel-90-150-r2, tears-of-steel-40-100. The other titles stay without Rich captions (no audio-event data)
  - [x] #33 review follow-ups: the `sdh` badge comes from the title's Rich captions TextTrack row (`/catalog`, `/titles/:slug`); filmEnds
    and 06-voice (before any Polly call, and after pauses move) drop a cue starting at or after the title's end and ends an extended cue sharing its start 1 ms later; stale sintel-90-150-r2 sdh
    objects listed in docs/titles.md; batch cost split (first runs + prompt clips $0.293, re-runs $0.0003)
- [ ] DESC-011 · week 4 · Polish, docs/screens, README, docs/aws.md, feedback, feature requests, ≥ 8 friction logs · freeze Oct 15 (needs: screenshots)
  - [x] rail: Described (described titles grid) and My list screens + `GET/PUT/DELETE /me/list` (#12); device run checks 9–11 passed
  - [x] README, docs/aws.md, docs/feedback.md, docs/feature-requests.md, friction index (19 logs in `docs/friction/`)
  - [ ] screenshots in `docs/screens/` (list and capture recipe: `docs/screens/README.md`)
  - [x] README title list and credits: the five DESC-010 titles (#33)
- [ ] DESC-012 · week 5 · Video + submission (Oct 22)
  - [x] drafts: `docs/video-script.md`, `docs/submission.md` (#11); TODO(human) marks footage, Devpost fields and measured costs
- [x] DESC-013 · follow-up · Narration end measured from Polly MP3 duration (cue overrun into dialogue) (#15)
- [x] DESC-014 · follow-up · SDH for full-length titles: windows of ≤ 40 captions, additions-only Nova Lite replies (#14)
- [x] DESC-015 · follow-up · Shortener may not change facts (wing→wings); remove dead Nova video path, nova-ingest stack, unused IAM (#9; stack deleted 2026-10-04)
  - two stale comments still mention Nova ingest / video in `packages/pipeline/src/s3.ts` (lines 12 and 31)
- [x] DESC-016 · follow-up · Publish hygiene: clear stale hls/ and cue_*.mp3 on --from reruns; mutable VTT/cue cache-control; per-shot describe cache (#3, #8, #15, #16)
- [x] DESC-017 · follow-up · Split camera shots described once (continuations asked only for what is new); shortening never removes on-screen text (#25)
- [x] DESC-018 · follow-up · Scene-level edit pass: fold dropped facts into the next voiced cue, remove repetition, no new facts (#26, #27; decision 0006 accepted in #29, on by default)
- [ ] DESC-019 · follow-up · Focusable ✓ overlaps the label on narrow buttons ("My list") — reserve room for the check (#28; `minWidth` in #30) (needs: device re-check on 788e973)
  - LOW (#28 review): My list looks off-centre when off — the kept ✓ slot leaves 40 px (20 dp on Fire OS) after the text; trim the right padding if it looks wrong on the stick
- [x] DESC-020 · follow-up · Dropped plot events become extended cues (Extended mode only; AD track unchanged), at most one per 30 s (#29, decision 0007)
  - LOW (#29 review), all fail safe: plural subjects still count as events ("Neon lights flicker.", "Two cuts mark his arm."); some real
    events are missed (a subject ending in -s: "Thomas opens the door."; plural subjects: "Soldiers march…"; "and" does not split a clause);
    two cues moved to the same moment can play out of order (a text cue sorts first; break ties by original order); an earlier event
    sliding later can drop a chosen event (check spacing on the starts before the move, or note it in 0007)
- [ ] DESC-021 · follow-up · Audio switch holds silence 150 ms across ExoPlayer's decoder reset (`tokens.motion.audioSwitchHoldMs`) (#30) (needs: re-check of RUN-2026-10 check 6)
  - the kit has no audio-track-changed event (KIT-029), so the hold is a fixed token
- [ ] DESC-022 · follow-up · Device run 2026-10-10: removing a title from My list after a relaunch sent no `DELETE /me/list/:slug`; the human logged check 11 as passed. Not fixed
- [ ] DESC-023 · follow-up · About screen heading sits inside its scroll view (`packages/shared-ui/src/screens/About.tsx`), the clipping pattern #30 fixed for the Grid heading (Described, My list)
