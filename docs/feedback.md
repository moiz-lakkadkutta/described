# Product feedback — Described

Every number links to where it was measured; each item in §3 links its friction log ([docs/friction/](friction/), 29 logs).
The five required answers are §1 (which tools, and how the AWS services are used), §2 (what worked well), §3 (what needs
improvement), §4 (onboarding) and §5 (would we build with them again). Refreshed 2026-10-23 (main `9d7d7ac`).
Device throughout: Fire TV Stick `AFTSS`, Fire OS 7.7.1.6 (Android 9, API 28), over adb.

## 1. Tools, APIs and SDKs used, and why

**Fire TV / Fire OS**

| Tool | Why | How we use it |
|---|---|---|
| React Native 0.81 + Expo SDK 54 | One TV codebase, Vega-ready screens | `apps/expo`, local release builds; old architecture because of the key source |
| react-native-video 6.19.2 → ExoPlayer (media3 1.8.0), via our `@moiz0309/vega-media-kit` | HLS alternate audio, WebVTT | Player screen (`KitPlayer`, `CueOverlay`) |
| AmazonAppDev/react-native-multi-tv-app-sample @ 92c6f7c | Fastest path to the stick | Week-0 spike harness; its keyevent plugin pattern is in `apps/expo/plugins/withKeyEvent.js` |
| react-tv-space-navigation 6.0.0-beta1 + react-native-keyevent 0.3.2 | D-pad focus proven on Fire OS | All focusable screens |
| Android `MediaSession` ([Amazon guide](https://developer.amazon.com/docs/fire-tv/mediasession-api-integration.html)) + deep links | Alexa transport; launch into a title | ~220-line Kotlin Expo module `described-media-session` ([bindings §4](platform/fire-os-bindings.md#4-media-controls-and-alexa-transport)); `described://title/{slug}`, `described://play/{slug}?t=…` ([§2](platform/fire-os-bindings.md#2-launch-and-deep-link-intents)) |
| VoiceView | Screen reader for blind viewers | Every control labelled; [checklist](a11y/voiceview-checklist.md), [RUN-2026-10](device-checks/RUN-2026-10.md) checks 11 and 17 |
| Fire TV catalog integration (CDF / EMBER) + Integration SDK | Search, voice, Continue watching | **Researched; partner-only. Draft feed ready** (`GET /catalog/fire-tv.xml`); personalization reporter is a no-op ([bindings §1, §3](platform/fire-os-bindings.md)) |

Also: expo-audio (per-cue clips in Extended mode, spoken prompts).

**Vega OS / Vega CLI — not used (deferred, [decision 0004](decisions/0004-vega-deferred.md)).** The SDK was never
installed (a multi-gigabyte SDK plus a day of setup) and the media kit's Vega
adapter was not finished. `apps/vega` is a template; `packages/shared-ui` keeps the Vega-supported import rule.

**AWS** (pipeline calls through @aws-sdk v3 — client-bedrock-runtime, client-polly, client-transcribe, client-s3, lib-storage,
client-cloudfront — plus AWS CLI 2; the full list of calls, Regions and costs is [docs/aws.md](aws.md))

| Service | Why | How we use it |
|---|---|---|
| Bedrock — **Qwen3-VL 235B** (Converse) | Won the Gate C bake-off | **Describe**: one call per shot with 3–6 key frames ([0003](decisions/0003-gate-c.md)); **verify**: the same frames and the draft again, may only remove what the frames do not show ([0010](decisions/0010-verify-pass.md)). Not shipped for describe: Nova Pro, Nova 2 Lite, Pegasus 1.2 (InvokeModel) |
| Bedrock — **Amazon Nova Lite** (Converse) | Cheap, fast text model | **Scenes**: groups shots into places ([0012](decisions/0012-characters-and-scenes.md)); **fit**: shortens a description to its dialogue gap; the one over-budget shortening in the narrative pass; **rich captions** (SDH) |
| Bedrock — **DeepSeek v3.2** (Converse, plain JSON reply) | Kept about half the cues it rewrote under our guards, where Nova Lite only removed repeats | **Narrative pass** (step 5b): one call per scene window joins the cues into one narration; deterministic guards keep facts, names and pronouns honest ([0017](decisions/0017-narrative-pass.md)) |
| Bedrock — **Amazon Nova Pro** (Converse) | Fallback | Asked once when the DeepSeek call fails or its reply is unreadable ([0017](decisions/0017-narrative-pass.md)) |
| Amazon Polly (**generative**, voice Ruth; neural also supported) | The narration voice | One clip per cue; the clip's measured length sets the cue end; app prompt clips ([0017](decisions/0017-narrative-pass.md) "Voice") |
| Amazon Transcribe | Word timings, speaker labels | Dialogue gaps where narration may speak; the plain captions track |
| Amazon S3 + CloudFront | HLS delivery to the stick | Sources, work files and the published HLS; CloudFront serves only `/published/*`; invalidation after a re-publish |
| AWS Lambda (function URL) + Amazon RDS for PostgreSQL | A hosted API for judges, no developer machine | The release APK's API: Express in viewer mode behind an HTTPS function URL; RDS db.t4g.micro in isolated subnets, no NAT; ≈ $14.50 a month ([aws.md](aws.md#hosted-api-desc-034)) |
| AWS Secrets Manager, CloudWatch, SNS, AWS Budgets | Safety for a public URL | Database password generated at deploy; low-storage alarm; USD 25 / month budget alert by email |
| AWS CDK (TypeScript) | Infra as code | `infra/`: `described-media-<stage>` (eu-central-1) and `described-viewer-<stage>` (us-east-1) |

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
  ee9495d). Full pipeline with Qwen3-VL: 72.4 %, then 75.9 % after DESC-017. Adding DeepSeek v3.2 for the narrative pass was a
  model ID and a plain-JSON prompt in the same Converse call; with it, Gate C run g13 passed both clips at the 70 % bar with
  three blind raters: 82.8 % on Sintel and 77.4 % on the held-out Tears of Steel clip (it re-used g12's describe output;
  [evaluation.md](evaluation.md#gate-c-results), [0017](decisions/0017-narrative-pass.md)).
- **Forced tool use fixed the shape on short requests.** Nova Lite returned schema-shaped cues with no echoed input
  ([log update](friction/2026-10-01-nova-lite-json-echoes-input.md#update-2026-10-01)); Qwen3-VL honoured a forced tool over
  `bedrock-runtime` too, though its model card lists tools under `bedrock-mantle` only ([0006](decisions/0006-scene-edit-pass.md#model-choice-probes-on-r2-text-only-45-converse-calls--0013)).
  On Sintel's rich-captions call Nova Lite then failed the forced tool with `ModelErrorException` (§3 AWS 3), so rich
  captions and the narrative pass ask for plain JSON instead.
- **Costs are small and predictable.** Five 60 s titles went live for $0.293 in one batch, prompt clips included
  ([titles.md](titles.md)); $0.051–0.059 per title, Transcribe's $0.024/min the floor. The whole of Sintel (14:48) cost $1.10,
  and re-voicing all six titles in Ruth with the narrative pass $0.36. End to end ≈ $0.086 per minute with the generative voice, an
  estimate ([aws.md](aws.md#cost-per-title); CLI meter plus two estimated steps, list prices). ffmpeg ducked 9.03 dB against a 9.0 target
  ([0001](decisions/0001-week0-gates.md#local-dry-runs-desc-001-part-1)).
- **The MediaSession guide and Fire TV's logs pinned down a bug fast.** In the device run of 2026-10-10, "Alexa, fast forward /
  rewind" did nothing; the guide's voice-command → callback table and Fire TV's `whad` publisher log lines showed why (the
  session went inactive under the Alexa UI), fixed in PR #31 ([fire-os-bindings §4](platform/fire-os-bindings.md#4-media-controls-and-alexa-transport)).
  The voice re-check on 2026-10-14 was **inconclusive**: the session was published, but no voice command reached the app
  ([RUN-2026-10](device-checks/RUN-2026-10.md) check 14). On 2026-10-19 the logs named the cause, "No target session, trying
  button press": the manifest lacked `com.amazon.permission.media.session.voicecommandcontrol`. The fix is merged (#86,
  [log](friction/2026-10-19-fire-tv-voice-falls-back-to-key-injection-without-voicecommandcontrol-permission.md)); the device re-check is pending. Remote media keys did pass (check 13).

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
   activity, our session went inactive, and Fire TV unpublishes inactive sessions (fixed in 788e973). Voice still did not reach the session until we added Amazon's `voicecommandcontrol` permission
   ([log](friction/2026-10-19-fire-tv-voice-falls-back-to-key-injection-without-voicecommandcontrol-permission.md); fix merged in #86, device re-check pending). *Ask:* an Amazon RN package or sample for MediaSession that reports to JS;
   document that the session must stay active while the activity is paused for voice, and put the permission in the
   React Native samples.
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
7. **Fire TV Recommendations was retired, and its docs just 404** — [log](friction/2026-10-15-fire-tv-recommendations-retired-may-2025-docs-404-only-on-wayback.md).
   Impact: about an hour; no self-serve home-screen integration is left for a new app. *Ask:* keep retired doc URLs alive
   with a notice and the replacement (or "none").
8. **`CaptioningManager` gives no typeface name** — [log](friction/2026-10-15-captioningmanager-style-has-no-typeface-name-and-the-kit-draws-no-caption-edge.md).
   Impact: about 30 minutes; captions follow the viewer's colours, size and family, not the exact typeface. *Ask:* a public
   typeface name on the caption style.

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
3. **Nova Lite forced tool use failed with `ModelErrorException`** — [log update](friction/2026-10-01-nova-lite-json-echoes-input.md#update-2026-10-19).
   Nova Lite answered our forced `emit_sdh` rich-captions call with `ModelErrorException` "Model produced invalid sequence
   as part of ToolUse" (424), twice in a row, on full-length Sintel (and on Tears of Steel), with nothing in the error to say
   what to change. Impact: those titles shipped without Rich captions. #82 dropped the forced tool and asks for plain JSON.
   That was only part of it: the rest of the absence was our own merge rule, which rejected grounded sound cues that ran
   over 2 s or overlapped a caption; #85 trims them instead ([0018](decisions/0018-sdh-trim.md)). Since the 2026-10-19
   re-run, both Sintel titles carry Rich captions ([titles](titles.md)). *Ask:* say in the error what in the request or
   reply broke the tool use, and document any limits of forced tool use on Nova v1.
4. **Temperature 0 is not deterministic on Nova Lite** — [log](friction/2026-10-14-nova-lite-temperature-0-is-not-deterministic.md).
   Impact: a re-run could add or drop a caption with nothing changed. *Ask:* say on the inference-parameters page whether
   temperature 0 is greedy, and what to set if not (we pass `topK: 1` as well).
5. **Free plan error does not name the plan** — [log](friction/2026-10-01-transcribe-free-plan-subscription-required.md).
   Impact: `SubscriptionRequiredException` read as an IAM problem; ~30 min, pipeline blocked. *Ask:* name the Free plan
   and link the upgrade.
6. **Verification after the plan upgrade is invisible** — [log](friction/2026-10-01-bedrock-account-verification-after-upgrade.md).
   Impact: Bedrock 403 while Transcribe worked; ~10 min. *Ask:* show verification state in `get-account-plan-state` and
   the upgrade response.
7. **Aurora Serverless v2 resumes too slowly for a TV app** — [log](friction/2026-10-15-aurora-serverless-v2-auto-pause-resume-outlasts-a-tv-app-fetch-timeout.md).
   Impact: about 30 minutes; a ≈ 15 s resume outlasts the app's 10 s fetch timeout, so the hosted API uses RDS db.t4g.micro
   instead. *Ask:* a documented resume bound under 10 s, or a "warm while used today" mode.
8. **`cdk diff` does not say a region is not bootstrapped** — [log](friction/2026-10-01-cdk-second-region-bootstrap.md).
   Impact: a few minutes; the warning names only the lookup role. *Ask:* name the missing
   bootstrap and print the command.

## 4. Onboarding quality

- **Time from zero to first app on device: about 2 hours**, on 2026-09-26 — the multi-TV sample on the stick, then
  Gate A tests 1–6 on our own HLS. Started around 16:00; first Fire OS results on the stick recorded 18:06
  ([329ad88](https://github.com/moiz-lakkadkutta/vega-media-kit/commit/329ad88)); own-HLS test 18:52
  ([06240c1](https://github.com/moiz-lakkadkutta/vega-media-kit/commit/06240c1)).
- **Our own app** ran end to end on the stick as a local release build on 2026-10-10 (PR #30); EAS cannot see a linked
  package ([RUN-2026-10 §0.8](device-checks/RUN-2026-10.md)).
- **AWS:** account to first paid pipeline run cost ~40 min of plan and verification errors (§3 AWS 5–6). Claude on
  Bedrock was not tested because the use-case form had not been submitted ([0003](decisions/0003-gate-c.md)).
- **Amazon Appstore:** the submission kit is ready ([appstore/SUBMIT.md](appstore/SUBMIT.md)) but not submitted. Our APK
  needs a manifest fix first: an Expo build declares no `uses-feature` for touchscreen or microphone with
  `required="false"`, and expo-audio's default adds `RECORD_AUDIO` (an implied required microphone), so Fire TV device
  filtering would likely list no device. Nothing in the Expo or React Native TV path warned us; we found it with `aapt`.

## 5. Would you build with these tools again?

- **Fire OS — Yes.** Standard Android media (ExoPlayer, HLS, MediaSession, intents) did the core job on a low-cost stick;
  the costs were sample defaults, undocumented device limits and a partner-only catalog.
- **Vega OS — Not yet known** (decision 0004); we would try with a lighter install and a finished media adapter.
- **Amazon Bedrock — Yes.** Cents per title; three model families (Qwen3-VL, Nova, DeepSeek) through one Converse API,
  plus Pegasus through InvokeModel in the bake-off. We would keep checking newer models against the same Gate C clips, and
  ask for plain JSON rather than a forced tool.
- **Polly (generative), Transcribe, S3, CloudFront, CDK — Yes.** The friction was account-level error messages, not the services.
- **Lambda function URL + RDS — Yes** for a small always-on API: one CDK stack, ≈ $14.50 a month, no NAT.
- **The multi-TV sample as a starting point — Yes, with the fixes in §3.5 applied first.**
