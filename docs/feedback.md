# Product feedback — Described

Required by the hackathon. Written as engineers writing to engineers. Every point links to a friction log in
[docs/friction](friction/README.md), a decision record or a PR. Device: Fire TV Stick AFTSS, Fire OS 7.7.1.6 (Android 9, API 28).

## 1. Tools, APIs and SDKs used, and why

**Fire TV / Amazon devices**
- **Fire OS on a Fire TV Stick (AFTSS)** — the shipping target. Vega OS is deferred: no Vega SDK installed and the shared
  player's Vega adapter is not ready ([decision 0004](decisions/0004-vega-deferred.md)).
- **AmazonAppDev/react-native-multi-tv-app-sample** — the reference for an Expo TV app on Fire OS: react-native-video,
  react-tv-space-navigation focus, react-native-keyevent for remote keys. We ran Gate A in it, then built `apps/expo` on the same stack.
- **Android MediaSession, per Amazon's "MediaSession API integration" guide** — Alexa transport ("Alexa, pause / fast forward /
  restart") reaches the Player through a local Expo module (`apps/expo/modules/described-media-session`).
- **Fire TV catalog integration and Content Personalization docs** — read for search, "Alexa, play … on Described" and Continue
  watching; both are partner-only today ([fire-os-bindings](platform/fire-os-bindings.md)).
- **HLS audio renditions with `CHARACTERISTICS="public.accessibility.describes-video"`** — the description is a second audio track,
  so the player's own track selection is the switch.

**AWS** (details and cost in [docs/aws.md](aws.md))
- **Amazon Bedrock, Converse API** — Qwen3-VL 235B describes each shot from 3–6 key frames; Nova Lite shortens, edits and writes
  rich captions. One API for every model let us run a four-model bake-off on the same 29 shots and prompt ([0003](decisions/0003-gate-c.md)).
- **Amazon Transcribe** — word timings and speaker labels give the gaps between dialogue where narration may speak.
- **Amazon Polly (neural)** — the narration voice; the measured clip length sets each cue's end.
- **Amazon S3 + CloudFront** — HLS delivery; CloudFront serves only `/published/*`.
- **AWS CDK** — one stack in `infra/`.

**Open source**: Expo SDK 54, React Native 0.81, react-native-video 6 (Media3 ExoPlayer), react-tv-space-navigation, Shaka Packager,
ffmpeg, Express, Prisma, pg-boss, and our own [`@moizp/vega-media-kit`](https://github.com/moiz-lakkadkutta/vega-media-kit).

## 2. What worked well

- **Bedrock Converse is one shape for every model.** Swapping the describe model from Nova Pro to Qwen3-VL was a model id and an
  image content block; the same request ran through four models for the bake-off (Qwen3-VL 75.9 %, Pegasus 44.8 %, Nova Pro 17.2 %,
  Nova 2 Lite 3.4 %, [0003](decisions/0003-gate-c.md)). Token usage comes back on every reply, so cost per job is exact (`cost.ts`).
- **Forced tool use makes Nova Lite's output structured.** `toolConfig` plus `toolChoice: {tool}` returned schema-shaped cues where a
  "JSON only" prompt had not; we use it for rich captions and the edit pass ([friction: Nova Lite JSON](friction/2026-10-01-nova-lite-json-echoes-input.md), update section).
- **Transcribe word timings are accurate enough to place narration.** On sintel-90-150-r2 no cue overlapped dialogue, and a
  started job can be resumed by name, so retries do not pay twice (`03-speech.ts`).
- **Polly neural + SSML** — a 150 ms lead-in break and the clip length from ffprobe gave cue ends we could trust (DESC-013).
- **Hardware decode is fast once the stream fits the decoder.** At 1920×818 H.264 High L4.0 the stick used `OMX.MTK.VIDEO.DECODER.AVC`
  with no fallback, and the first frame came in 1.8–2.1 s (device run 2026-10-10, check 4), against 2.9–3.9 s in Gate A.
- **Android deep links on Fire OS** — `described://title/…` and `described://play/…?t=…` worked cold, warm and after Back on the
  first device run (check 12).
- **Amazon's MediaSession guide has the voice-command → callback table** (fast forward / rewind → `onSeekTo(position ± 10 s)`,
  restart → `onSeekTo(0)`, absolute time not supported). That table is what pinned down the cause of the check 14 failure (PR #31).
- **CloudFront Functions + Origin Access Control** — a one-line function and a bucket-policy deny keep `work/` private while
  `published/` is public, all in CDK.

## 3. What needs improvement

Fire TV and its samples
- **macOS blocks adb with "No route to host"** while ping works: Local Network privacy, no prompt, ~20–30 min lost. One line in
  the ADB doc would fix it ([log](friction/2026-09-26-adb-macos-local-network.md)).
- **`adb exec-out screencap` returns a black PNG on the stick**, for the app UI as well as video; device evidence had to be phone
  photos ([log](friction/2026-09-26-adb-screencap-black.md)).
- **The multi-TV sample consumes key events in MainActivity**, so native `Pressable` focus never moves; only react-tv-space-navigation
  works, and nothing says so ([log](friction/2026-09-26-dpad-pressable-focus-and-latency.md)).
- **HLS is off in the sample's react-native-video config**; the on-screen error is a generic "EXO Playback error"
  ([log](friction/2026-09-26-sample-hls-disabled.md)).
- **Expo runs another project's bundle on the TV** when port 8081 is busy in non-interactive mode
  ([log](friction/2026-09-26-expo-port-8081-wrong-bundle.md)).
- **Metro takes the first `exports` condition**, so a linked library shared by Fire OS and Vega resolves to its non-RN build. The
  "one codebase" story needs a documented Metro setup ([log](friction/2026-09-26-metro-exports-condition-order.md)).
- **react-native-keyevent pins the app to the old architecture** (RN 0.81 / Expo SDK 54 is the last with it); no new-architecture key
  source is shown in the sample ([log](friction/2026-10-01-react-native-keyevent-needs-the-old-architecture.md)).
- **react-tv-space-navigation 5 crashes release builds on React 19**, and only release builds; 6.0.0-beta1 fixes it
  ([log](friction/2026-10-06-react-tv-space-navigation-5-crashes-release-builds-on-react-19.md)).
- **The stick caps H.264 at 1920×1088 and falls back to a software decoder silently** (5–6 fps). The spec page says "1080p, Level 4"
  but no maximum width ([log](friction/2026-10-01-fire-tv-stick-caps-h-264-decode-at-1920-wide-and-falls-back-to-software-silently.md)).
- **A sleeping stick makes react-native-video fail with "Current Activity is null!"**; the error points at React Native, not device
  power ([log](friction/2026-10-01-fire-tv-asleep-react-native-video-says-current-activity-is-null.md)).
- **Alexa transport needs native code.** react-native-video's MediaSession drives ExoPlayer directly and only with a notification
  service; a TV app whose JS owns playback state needs its own Kotlin module ([log](friction/2026-10-01-alexa-transport-needs-a-native-media-session.md)).
- **Fire OS user builds drop `Log.d`**, so a native module's debug logs never reach logcat; it cost an evening on check 14
  ([log](friction/2026-10-10-fire-os-drops-log-d.md)).
- **Catalog integration is partner-only** (CDF closed to new partners, EMBER XSD behind a login), so a new app cannot appear in
  search, voice "play … on …" or Continue watching ([log](friction/2026-10-01-fire-tv-catalog-integration-is-partner-only.md)).

AWS
- **Transcribe on the Free plan says "needs a subscription"** and names neither the plan nor the fix
  ([log](friction/2026-10-01-transcribe-free-plan-subscription-required.md)).
- **Bedrock returns 403 "account is being verified"** for ~10 min after the plan upgrade while Transcribe already works; nothing in
  the upgrade response says so ([log](friction/2026-10-01-bedrock-account-verification-after-upgrade.md)).
- **A "JSON only" prompt is not enforced for Nova Lite** — it echoed the input envelope; the forced-tool pattern should be on the
  prompting page ([log](friction/2026-10-01-nova-lite-json-echoes-input.md)).
- **Nova Pro invented on-screen text** when the prompt asked it to read text unconditionally; for audio description that misleads
  blind viewers ([log](friction/2026-10-01-nova-pro-hallucinated-on-screen-text.md)).
- **`cdk diff` hides a missing bootstrap in a second Region** behind a lookup-role warning
  ([log](friction/2026-10-01-cdk-second-region-bootstrap.md)).

## 4. Onboarding quality

- Time from zero to first app on device: TODO(human) hours (the first Fire OS deploy was 2026-09-26; the first Gradle build of the
  sample took 10 min 58 s including SDK/NDK downloads, [log](friction/2026-09-26-sample-hls-disabled.md)).
- Six of the eighteen friction logs come from that first day with the stick and the multi-TV sample (2026-09-26). In most of them
  the error pointed somewhere other than the cause.
- AWS onboarding: the Free-plan account had to be upgraded before Transcribe worked, then Bedrock refused calls for about
  10 minutes while the account was verified. The first error named neither the plan nor the fix; the upgrade response gave no warning of the second (two logs above).

## 5. Would we build with these tools again?

**Yes, with notes.**
- **Bedrock Converse, Transcribe, Polly: yes.** The bake-off and the per-job cost metering leaned on Converse's single request
  shape and the token usage in every reply; Transcribe job names made retries resumable.
- **Fire OS with React Native: yes, but budget for native work and device-only bugs.** Three of our blocking bugs appeared only on the
  stick (React 19 crash in the release build, decoder fallback, MediaSession lifecycle); unit tests could not see them.
- **Fire TV discovery: not yet.** Without a self-serve catalog tier a small app cannot reach search, voice "play" or Continue watching.
- **Vega OS: not evaluated** in this entry ([0004](decisions/0004-vega-deferred.md)).
