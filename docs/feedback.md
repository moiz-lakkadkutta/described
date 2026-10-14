# Product feedback — Described

Every number links to where it was measured; each item in §3 links its friction log ([docs/friction/](friction/), 18 logs).
Device throughout: Fire TV Stick `AFTSS`, Fire OS 7.7.1.6 (Android 9, API 28), over adb.

## 1. Tools, APIs and SDKs used, and why

**Fire TV / Fire OS**

| Tool | Why | How we use it |
|---|---|---|
| React Native 0.81 + Expo SDK 54 | One TV codebase, Vega-ready screens | `apps/expo`, local release builds; old architecture because of the key source |
| react-native-video 6.19.2 → ExoPlayer (media3 1.8.0), via our `@moizp/vega-media-kit` | HLS alternate audio, WebVTT | Player screen (`KitPlayer`, `CueOverlay`) |
| AmazonAppDev/react-native-multi-tv-app-sample @ 92c6f7c | Fastest path to the stick | Week-0 spike harness; its keyevent plugin pattern is in `apps/expo/plugins/withKeyEvent.js` |
| react-tv-space-navigation 6.0.0-beta1 + react-native-keyevent 0.3.2 | D-pad focus proven on Fire OS | All focusable screens |
| Android `MediaSession` ([Amazon guide](https://developer.amazon.com/docs/fire-tv/mediasession-api-integration.html)) + deep links | Alexa transport; launch into a title | ~220-line Kotlin Expo module `described-media-session` ([bindings §4](platform/fire-os-bindings.md#4-media-controls-and-alexa-transport)); `described://title/{slug}`, `described://play/{slug}?t=…` ([§2](platform/fire-os-bindings.md#2-launch-and-deep-link-intents)) |
| VoiceView | Screen reader for blind viewers | Every control labelled; [checklist](a11y/voiceview-checklist.md), [RUN-2026-10](device-checks/RUN-2026-10.md) checks 11 and 17 |
| Fire TV catalog integration (CDF / EMBER) + Integration SDK | Search, voice, Continue watching | **Researched; partner-only. Draft feed ready** (`GET /catalog/fire-tv.xml`); personalization reporter is a no-op ([bindings §1, §3](platform/fire-os-bindings.md)) |

Also: expo-audio (per-cue clips in Extended mode, spoken prompts).

**Vega OS / Vega CLI — not used (deferred, [decision 0004](decisions/0004-vega-deferred.md)).** The SDK was never
installed (a multi-gigabyte SDK plus a day of setup) and the media kit's Vega
adapter was not finished. `apps/vega` is a template; `packages/shared-ui` keeps the Vega-supported import rule.

**AWS** (all through @aws-sdk v3 — client-bedrock-runtime, client-polly, client-transcribe, client-s3, lib-storage,
client-cloudfront — plus AWS CLI 2)

| Service | Why | How we use it |
|---|---|---|
| Bedrock — **Qwen3-VL 235B** (Converse) | Won the Gate C bake-off | Per shot, 3–6 key frames ([0003](decisions/0003-gate-c.md)). Not shipped: Nova Pro, Nova 2 Lite, Pegasus 1.2 (InvokeModel) |
| Bedrock — **Nova Lite** (Converse) | Cheap text model, forced tools | Shortening, rich captions, edit pass ([0006](decisions/0006-scene-edit-pass.md)) |
| Amazon Polly (neural) | The narration voice | One clip per cue |
| Amazon Transcribe | Word timings, speaker labels | Dialogue gaps; captions |
| Amazon S3 + CloudFront | HLS delivery to the stick | Serves only `/published/*` |
| AWS CDK (TypeScript) | Infra as code | `infra/`, two regions |

**Media and backend:** Shaka Packager v3.9.3 (HLS master, two audio renditions, up to three text tracks), ffmpeg 8.0
(scenes, key frames, ducking, loudness), Express 4 + Zod + Prisma 6 + pg-boss 10 on PostgreSQL, Socket.IO (pipeline
progress to the admin page).

**Dev tooling:** Claude Code (commit trailers throughout `git log`).

## 2. What worked well

- **A standard HLS description rendition plays as-is.** Shaka Packager marks it `describes-video`
  ([0001 dry run](decisions/0001-week0-gates.md#1-packager-dry-run--pass-with-one-finding)); on Fire OS it plays as a normal
  alternate audio track, selected from our own track sheet: Original → AD in 0.5–0.6 s with no rewind, two text tracks at
  once, rate 0.8 measured at 0.802, first frame 2.9–3.9 s ([0001 Gate A](decisions/0001-week0-gates.md)). At 1920×818:
  hardware `OMX.MTK.VIDEO.DECODER.AVC`, no software fallback, first frame 1.8–2.1 s ([TASKS.md](../TASKS.md) DESC-010, device run check 4).
- **Bedrock made the model a parameter.** Nova Pro scored 41.4 % usable in the full pipeline (Gate C bar: 70 %). We ran
  the same 29 shots and prompt through four models in one evening for ≈ $0.15; on raw descriptions Qwen3-VL scored
  75.9 %, Nova Pro 17.2 % ([0003](decisions/0003-gate-c.md)). Converse made the swap two small commits (126d1e9,
  ee9495d). Full pipeline with Qwen3-VL: 72.4 %, then 75.9 % after DESC-017.
- **Forced tool use fixes the shape.** Nova Lite returned schema-shaped cues with no echoed input
  ([log update](friction/2026-10-01-nova-lite-json-echoes-input.md#update-2026-10-01)); Qwen3-VL honoured a forced tool over
  `bedrock-runtime` too, though its model card lists tools under `bedrock-mantle` only ([0006](decisions/0006-scene-edit-pass.md#model-choice-probes-on-r2-text-only-45-converse-calls--0013)).
- **Costs are small and predictable.** Five 60 s titles went live for $0.293 in one batch, prompt clips included
  ([titles.md](titles.md)); $0.051–0.059 per title, Transcribe's $0.024/min the floor ([aws.md](aws.md); CLI meter, list prices). ffmpeg ducked 9.03 dB against a 9.0 target
  ([0001](decisions/0001-week0-gates.md#local-dry-runs-desc-001-part-1)).
- **MediaSession works for voice.** "Alexa, pause / play" reached the Player on the stick (device run 2026-10-10,
  788e973). The guide's voice-command → callback table and Fire TV's `whad-MediaSessionClient` log lines pinned down the
  fast-forward bug (PR #31).

## 3. What needs improvement

Most actionable first within each group.

### Fire TV / Fire OS

1. **Catalog integration is partner-only** — [log](friction/2026-10-01-fire-tv-catalog-integration-is-partner-only.md).
   Impact: no Fire TV search, voice or Continue watching for a new app; no in-app workaround. *Ask:* a capped self-serve catalog tier, or Vega's
   Content Launcher on Fire OS; publish the EMBER XSD without a partner login.
2. **H.264 hardware decode caps at 1920×1088, and the fallback is silent** — [log](friction/2026-10-01-fire-tv-stick-caps-h-264-decode-at-1920-wide-and-falls-back-to-software-silently.md).
   Impact: our 2534×1080 rendition fell to software decode, dropped 390 frames in ~70 s, 3 s seeks, with no error.
   *Ask:* state the maximum frame size on the device-specs page; expose decoder fallback to apps.
3. **Alexa transport needs native code in a React Native app** — [log](friction/2026-10-01-alexa-transport-needs-a-native-media-session.md).
   Impact: ~half a day and a Kotlin module. On device, fast forward / rewind then did nothing: the Alexa UI pauses the
   activity, our session went inactive, and Fire TV unpublishes inactive sessions (fixed in 788e973; the voice re-check of
   fast forward / rewind is still pending). *Ask:* an Amazon RN package or sample for MediaSession that reports to JS;
   document that the session must stay active while the activity is paused for voice.
4. **Fire OS user builds drop `Log.d`** — [log](friction/2026-10-10-fire-os-drops-log-d.md). Impact: an evening lost
   diagnosing the session bug above. *Ask:* one line in the logcat / ADB docs, "user builds show I and above only", or
   document a `setprop log.tag.<TAG> DEBUG` path if Fire OS has one.
5. **The React Native TV stack needed five fixes before real content played:**
   - the sample ships HLS off; the fix costs a native rebuild (first Gradle build 10 min 58 s) — [log](friction/2026-09-26-sample-hls-disabled.md);
   - its keyevent plugin consumes keys, so `Pressable` focus never moves; ~1.3 s per press on a debug build — [log](friction/2026-09-26-dpad-pressable-focus-and-latency.md);
   - that plugin pins the old architecture, so RN 0.81 / Expo 54 is our ceiling — [log](friction/2026-10-01-react-native-keyevent-needs-the-old-architecture.md);
   - one RN library shared across Fire OS and Vega needed hand-written Metro resolution — [log](friction/2026-09-26-metro-exports-condition-order.md);
   - react-tv-space-navigation 5.2.0 embeds React 18's JSX runtime, so our release build died at startup under React 19;
     the sample pins 6.0.0-beta1, we did not (fixed in f7bc42a, PR #23) — [log](friction/2026-10-06-react-tv-space-navigation-5-crashes-release-builds-on-react-19.md).

   *Ask:* HLS on by default; a new-architecture key source (`TVEventHandler` or a Turbo Module); a documented
   "one codebase" Metro setup; a README note that space-navigation 6.x is required on React 19.
6. **Device tooling messages point the wrong way.** adb says `No route to host` when macOS Local Network privacy blocks it
   (20–30 min) — [log](friction/2026-09-26-adb-macos-local-network.md); a sleeping stick makes the player fail with
   `Current Activity is null!` (~5 min) — [log](friction/2026-10-01-fire-tv-asleep-react-native-video-says-current-activity-is-null.md);
   `adb screencap` is all black — [log](friction/2026-09-26-adb-screencap-black.md); Expo silently serves another
   project's bundle when port 8081 is taken — [log](friction/2026-09-26-expo-port-8081-wrong-bundle.md).
   *Ask:* these notes in the ADB docs and sample README; a supported screenshot path for dev builds.

### Vega OS

No hands-on friction: we never installed the SDK ([0004](decisions/0004-vega-deferred.md)). The cost of entry (a
multi-gigabyte SDK plus a day of setup) decided us for Fire OS. *Ask:* a smaller first install or a hosted Virtual Device, to try Vega for an hour first.

### AWS

1. **Nova Pro invented on-screen text** — [log](friction/2026-10-01-nova-pro-hallucinated-on-screen-text.md). Impact: two
   invented "Words appear:" lines, unverifiable for blind viewers. *Ask:* document it on the Nova video page with the
   "only if clearly legible" pattern; return a "no text visible" signal.
2. **"JSON only" prompts are not constrained** — [log](friction/2026-10-01-nova-lite-json-echoes-input.md). Impact: Nova
   Lite echoed the request, crashing the SDH step. *Ask:* point to the forced-tool pattern on the Nova prompting pages; list
   Nova v1 support for `outputConfig.textFormat`.
3. **Free plan error does not name the plan** — [log](friction/2026-10-01-transcribe-free-plan-subscription-required.md).
   Impact: `SubscriptionRequiredException` read as an IAM problem; ~30 min, pipeline blocked. *Ask:* name the Free plan
   and link the upgrade.
4. **Verification after the plan upgrade is invisible** — [log](friction/2026-10-01-bedrock-account-verification-after-upgrade.md).
   Impact: Bedrock 403 while Transcribe worked; ~10 min. *Ask:* show verification state in `get-account-plan-state` and
   the upgrade response.
5. **`cdk diff` does not say a region is not bootstrapped** — [log](friction/2026-10-01-cdk-second-region-bootstrap.md).
   Impact: a few minutes; the warning names only the lookup role. *Ask:* name the missing
   bootstrap and print the command.

## 4. Onboarding quality

- **Time from zero to first app on device: about 2 hours**, on 2026-09-26 — the multi-TV sample on the stick, then
  Gate A tests 1–6 on our own HLS. Started around 16:00; first Fire OS results on the stick recorded 18:06
  ([329ad88](https://github.com/moiz-lakkadkutta/vega-media-kit/commit/329ad88)); own-HLS test 18:52
  ([06240c1](https://github.com/moiz-lakkadkutta/vega-media-kit/commit/06240c1)).
- **Our own app** ran end to end on the stick as a local release build on 2026-10-10 (PR #30); EAS cannot see a linked
  package ([RUN-2026-10 §0.8](device-checks/RUN-2026-10.md)).
- **AWS:** account to first paid pipeline run cost ~40 min of plan and verification errors (§3 AWS 3–4). Claude on
  Bedrock was not tested because the use-case form had not been submitted ([0003](decisions/0003-gate-c.md)).

## 5. Would you build with these tools again?

- **Fire OS — Yes.** Standard Android media (ExoPlayer, HLS, MediaSession, intents) did the core job on a low-cost stick;
  the costs were sample defaults, undocumented device limits and a partner-only catalog.
- **Vega OS — Not yet known** (decision 0004); we would try with a lighter install and a finished media adapter.
- **Amazon Bedrock — Yes.** Cents per title; we would keep checking newer vision models against the same 29 shots.
- **Polly, Transcribe, S3, CloudFront, CDK — Yes.** The friction was account-level error messages, not the services.
- **The multi-TV sample as a starting point — Yes, with the fixes in §3.5 applied first.**
