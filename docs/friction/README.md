# Friction logs

One file per incident, created with `pnpm friction "<short title>"`. Format follows the hackathon rules (task, steps,
expected vs actual, severity, workaround, suggestion). Target: 8–12 per submission. Link the relevant ones from
`docs/feedback.md`. These logs earn up to a 10 % bonus in judging and are the raw material for the required feedback.

## Index (28)

| Date | Log | Area | Severity |
|---|---|---|---|
| 2026-09-26 | [adb on macOS: "No route to host" from Local Network privacy](2026-09-26-adb-macos-local-network.md) | Fire TV tooling | Medium |
| 2026-09-26 | [`adb screencap` gives a black image on the stick](2026-09-26-adb-screencap-black.md) | Fire TV tooling | Low |
| 2026-09-26 | [D-pad: native `Pressable` focus never moves; per-press latency](2026-09-26-dpad-pressable-focus-and-latency.md) | Multi-TV sample | High |
| 2026-09-26 | [Expo skips its dev server on a busy port 8081 and the TV runs another project's bundle](2026-09-26-expo-port-8081-wrong-bundle.md) | Expo / sample | High |
| 2026-09-26 | [Metro takes the first `exports` condition, so a linked library resolves to its non-RN build](2026-09-26-metro-exports-condition-order.md) | Metro / sample | Medium |
| 2026-09-26 | [HLS is turned off in the sample's react-native-video config](2026-09-26-sample-hls-disabled.md) | Multi-TV sample | Medium |
| 2026-10-01 | [Alexa transport needs a native MediaSession that reports to JS](2026-10-01-alexa-transport-needs-a-native-media-session.md) | Fire OS / Alexa | Medium |
| 2026-10-01 | [Bedrock 403 "account is being verified" after the plan upgrade](2026-10-01-bedrock-account-verification-after-upgrade.md) | AWS account / Bedrock | Low |
| 2026-10-01 | [`cdk diff` hides a missing bootstrap in a second Region](2026-10-01-cdk-second-region-bootstrap.md) | AWS CDK | Low |
| 2026-10-01 | [A sleeping stick: react-native-video says "Current Activity is null!"](2026-10-01-fire-tv-asleep-react-native-video-says-current-activity-is-null.md) | Fire TV / player | Medium |
| 2026-10-01 | [Fire TV catalog integration is partner-only](2026-10-01-fire-tv-catalog-integration-is-partner-only.md) | Fire TV discovery | Medium |
| 2026-10-01 | [Fire TV Stick caps H.264 at 1920 wide and falls back to software silently](2026-10-01-fire-tv-stick-caps-h-264-decode-at-1920-wide-and-falls-back-to-software-silently.md) | Fire TV hardware | High |
| 2026-10-01 | [Nova Lite "JSON only" reply echoes the input](2026-10-01-nova-lite-json-echoes-input.md) | Bedrock / Nova | Medium |
| 2026-10-01 | [Nova Pro invented on-screen text](2026-10-01-nova-pro-hallucinated-on-screen-text.md) | Bedrock / Nova | High |
| 2026-10-01 | [react-native-keyevent needs the old architecture](2026-10-01-react-native-keyevent-needs-the-old-architecture.md) | RN / sample | Medium |
| 2026-10-01 | [Transcribe: "needs a subscription" on the Free plan](2026-10-01-transcribe-free-plan-subscription-required.md) | AWS account / Transcribe | Medium |
| 2026-10-06 | [react-tv-space-navigation 5 crashes release builds on React 19](2026-10-06-react-tv-space-navigation-5-crashes-release-builds-on-react-19.md) | Focus library / sample | High |
| 2026-10-10 | [Fire OS drops `Log.d`: a native module's debug logs never reach logcat](2026-10-10-fire-os-drops-log-d.md) | Fire OS tooling | Medium |
| 2026-10-14 | [Nova Lite at temperature 0 gives different replies to the same request](2026-10-14-nova-lite-temperature-0-is-not-deterministic.md) | Bedrock / Nova | Medium |
| 2026-10-14 | [Gate C re-run: no stop-before-publish in the CLI; earlier rater packets lost with the scratchpad](2026-10-14-gate-c-re-run-no-cli-stop-before-publish-and-previous-rater-packets-lost-with-the-scratchpad.md) | Pipeline / evaluation | Low |
| 2026-10-15 | [Aurora Serverless v2 auto-pause resume outlasts a TV app's fetch timeout](2026-10-15-aurora-serverless-v2-auto-pause-resume-outlasts-a-tv-app-fetch-timeout.md) | AWS / RDS, Lambda | Low |
| 2026-10-15 | [Fire TV Recommendations retired May 2025; docs 404, only on the Wayback Machine](2026-10-15-fire-tv-recommendations-retired-may-2025-docs-404-only-on-wayback.md) | Fire TV discovery | Medium |
| 2026-10-15 | [CaptioningManager style has no typeface name; the kit draws no caption edge](2026-10-15-captioningmanager-style-has-no-typeface-name-and-the-kit-draws-no-caption-edge.md) | Fire OS / captions | Low |
| 2026-10-19 | [`build:lambda` ships a stale Prisma engine unless `prisma generate` runs first](2026-10-19-build-lambda-ships-a-stale-prisma-engine-unless-prisma-generate-runs-first.md) | AWS Lambda / Prisma | Low |
| 2026-10-19 | [CDK RDS generated secret fails when every punctuation mark is excluded](2026-10-19-cdk-rds-generated-secret-fails-when-every-punctuation-mark-is-excluded.md) | AWS CDK / Secrets Manager | Medium |
| 2026-10-19 | [Metro transform cache ignores `EXPO_PUBLIC_*` values and bakes the wrong API URL](2026-10-19-metro-transform-cache-ignores-expo-public-values-and-bakes-the-wrong-api-url.md) | Expo / Fire TV build | Medium |
| 2026-10-19 | [Polly extended clips play louder than the narration mixed into the AD track](2026-10-19-polly-extended-clips-play-louder-than-the-narration-mixed-into-the-ad-track.md) | AWS Polly / mix | Medium |
| 2026-10-19 | [npm publish E403 until 2FA is on for the account](2026-10-19-npm-publish-e403-until-2fa-is-on-for-the-account.md) | npm / open source | Medium |
