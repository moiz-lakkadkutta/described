# Submitting Described to the Amazon Appstore — owner checklist

Everything here that does not need the owner's Amazon Developer Console account is done; the console steps are listed
in order, each field mapped to a file or value. Copy for every text field: [listing.md](listing.md). Privacy policy:
[docs/privacy.md](../privacy.md). Prepared 2026-10-22 against the APK now published as the GitHub release
[`v0.1.0/described-0.1.0.apk`](https://github.com/moiz-lakkadkutta/described/releases/tag/v0.1.0) (built from `d0608dc`; sha256 `b417fe075496802ae5ef4a2820321263713b07e01c0a1ff9ad6cfe54d281aaec`;
package `dev.moizp.described`, versionName 0.1.0, versionCode 1).

**Update 2026-10-23 — B1 and D6 done (this PR, `feat/appstore-b1-rebuild`).** The APK to upload is now
`described-0.1.1.apk` (versionName 0.1.1, versionCode 2, same debug signing certificate as v0.1.0 so it installs over it;
sha256 `ab73e20547fe809e5b0cdb24851033bc162c70006832f0f0ad66680e01f33f9d`, 59.9 MB). Rows A4, A5, A7 and A13 below are
re-checked on it. A GitHub release for it is not created yet. Manual test on a stick (including Amazon's Home-button
and microphone criteria, A15): [docs/TESTING-ON-FIRE-TV.md](../TESTING-ON-FIRE-TV.md).

Amazon docs used (read 2026-10-22): [Submit your app](https://developer.amazon.com/docs/app-submission/submitting-apps-to-amazon-appstore.html) ·
[Step 1](https://developer.amazon.com/docs/app-submission/upload-app-file.html) ·
[Step 2](https://developer.amazon.com/docs/app-submission/target-app.html) ·
[Step 3](https://developer.amazon.com/docs/app-submission/appstore-details.html) ·
[Step 4](https://developer.amazon.com/docs/app-submission/review-submit.html) ·
[Test criteria](https://developer.amazon.com/docs/app-testing/test-criteria.html) ·
[Device filtering on Fire OS](https://developer.amazon.com/docs/app-submission/device-filtering-and-compatibility.html) ·
[Manifest filters](https://developer.amazon.com/docs/app-submission/supported-filters-on-the-amazon-appstore.html) ·
[Taking screenshots](https://developer.amazon.com/docs/app-submission/taking-screenshots.html) ·
[Content policy](https://developer.amazon.com/docs/policy-center/understanding-content-policy.html) ·
[Privacy and security policy](https://developer.amazon.com/docs/policy-center/privacy-security.html) ·
[Fire TV design guidelines](https://developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html) ·
[Amazon app signatures](https://developer.amazon.com/docs/app-submission/understanding-submission.html).

## 1. APK readiness

Checked with `aapt dump badging` / `aapt dump xmltree`, `apksigner verify --print-certs`, `zipalign -c`, and on an
Android TV emulator (API 31, arm64, 1920 × 1080, 320 dpi — the Fire TV Stick's density). The emulator is not a Fire TV:
Amazon requires a run on a physical device before submitting ([presubmission checklist](https://developer.amazon.com/docs/app-submission/presubmission-checklist.html)).

| # | Check | Result | Criterion |
|---|---|---|---|
| A1 | Not debuggable | **Pass** — no `android:debuggable` in the manifest; the installed package's flags are `HAS_CODE ALLOW_CLEAR_USER_DATA ALLOW_BACKUP` (no `DEBUGGABLE`) | [Understanding submission, "strip all debug symbols"](https://developer.amazon.com/docs/app-submission/understanding-submission.html) |
| A2 | Signing | **Signed with the Android debug key** (v2 scheme; `CN=Android Debug, O=Unknown, C=US`, cert SHA-256 `fac61745…1b9c`), because `build-apk.js` runs Expo's prebuild template, which signs release with the debug keystore. **Not a blocker for the Appstore**: Amazon removes your signature and re-signs with your account's Amazon key. Still: create an upload keystore (D2) so public builds stop using a development key. | [Amazon app signatures](https://developer.amazon.com/docs/app-submission/understanding-submission.html) |
| A3 | targetSdk / minSdk | **Pass** — targetSdk 36, minSdk 24. Amazon's minimum targetSdk: Fire OS 16 → 36, Fire OS 14 → 34, Fire OS 8 → 30 | [Minimum API levels for targetSdkVersion](https://developer.amazon.com/docs/app-submission/device-filtering-and-compatibility.html) |
| A4 | Fire TV device filtering: `android.hardware.touchscreen` `required="false"` | **Pass (v0.1.1, B1).** `aapt dump badging` lists `uses-feature-not-required` for `android.hardware.touchscreen`, `android.hardware.faketouch`, `android.hardware.microphone` and `android.software.leanback` (plugin `withTvFeatures`). The only required feature left is `android.hardware.screen.landscape` (implied by the landscape activity, as in v0.1.0; TVs are landscape). Was: no `<uses-feature>` at all, faketouch implied required. | [Device filtering for Fire TV devices](https://developer.amazon.com/docs/app-submission/device-filtering-and-compatibility.html), [Manifest filters › Touchscreen](https://developer.amazon.com/docs/app-submission/supported-filters-on-the-amazon-appstore.html) |
| A5 | Implied features from permissions | **Pass (v0.1.1, B1).** No `uses-implied-feature` for the microphone: `RECORD_AUDIO` is gone and the microphone is declared not required. Was: `RECORD_AUDIO` implied `android.hardware.microphone` required. | [Common hardware and software capabilities](https://developer.amazon.com/docs/app-submission/device-filtering-and-compatibility.html) |
| A6 | Leanback | **Pass** — `MainActivity` has `LEANBACK_LAUNCHER` and `LAUNCHER`; `android:banner` is set (PR #89). `android.software.leanback` is not declared, which Fire TV does not need. | [Differences from Android TV](https://developer.amazon.com/docs/fire-tv/differences-from-android-tv-development.html) |
| A7 | Permissions | **Pass (v0.1.1, B1)** — the APK asks for `INTERNET`, `ACCESS_NETWORK_STATE`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, the Fire TV voice permission, and two automatic library entries (table below). `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `READ_/WRITE_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW` and `VIBRATE` are removed (`android.blockedPermissions`, expo-audio `recordAudioAndroid: false`). | [Test criteria group 1](https://developer.amazon.com/docs/app-testing/test-criteria.html), [Privacy and security › Permissions](https://developer.amazon.com/docs/policy-center/privacy-security.html) |
| A8 | Back on Home exits; Back never traps | **Pass** (emulator) — Back from the track sheet → Player → Title → Home, and Back on Home returns to the TV launcher (`mResumedActivity` = launcher). | [Test criteria 2.13 Navigability, 4.5 Back button, 4.7 All remaining buttons](https://developer.amazon.com/docs/app-testing/test-criteria.html) |
| A9 | Focus is always visible | **Pass** — every capture shows the outline + scale focus state. | [Test criteria 2.11 UI highlighting](https://developer.amazon.com/docs/app-testing/test-criteria.html) |
| A10 | No crash during the run | **Pass** — no `FATAL EXCEPTION` or `ANR` in logcat across first run, Home, Settings, About, Title, playback with seek, Extended pause and the track sheet. | [Test criteria 2.4–2.5 stability](https://developer.amazon.com/docs/app-testing/test-criteria.html) |
| A11 | 64-bit | **Pass** — arm64-v8a and armeabi-v7a (plus x86, x86_64). | [Devices supporting only 64-bit apps](https://developer.amazon.com/docs/app-submission/device-filtering-and-compatibility.html) |
| A12 | Size | **Pass** — APK 59.9 MB; zipaligned (`zipalign -c -p 4` passes). | [Test criteria 2.1 Install size](https://developer.amazon.com/docs/app-testing/test-criteria.html), [Step 1, zipalign](https://developer.amazon.com/docs/app-submission/upload-app-file.html) |
| A13 | Privacy policy inside the app | **Pass (v0.1.1, D6).** Settings › About & licenses ends with a PRIVACY section: "Privacy policy: github.com/moiz-lakkadkutta/described/blob/main/docs/privacy.md" (a focusable text line, so VoiceView reads it), seen on the emulator. Amazon's policy: "Display a legally adequate privacy policy within the app and on the app detail page." | [Privacy and security › User data](https://developer.amazon.com/docs/policy-center/privacy-security.html) |
| A14 | Install location | Recommendation only: `android:installLocation` is unset; Amazon suggests `preferExternal`. | [Presubmission checklist](https://developer.amazon.com/docs/app-submission/presubmission-checklist.html) |
| A15 | Home button / exit within 2 s, audio stops on exit, microphone button | **Not tested** — needs the stick (Fire TV Home and voice remote): checks 18 and 19 in [TESTING-ON-FIRE-TV.md](../TESTING-ON-FIRE-TV.md). | [Test criteria 2.22, 4.2, 4.4](https://developer.amazon.com/docs/app-testing/test-criteria.html) |

Seen on the emulator, worth a look on the stick: right after the introduction's last panel, Home opened scrolled down
(hero cut off at the top); after a relaunch it opened at the top.

### Permissions in the APK

| Permission | Source | Needed? |
|---|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE` | React Native / players | Yes — API and streaming |
| `com.amazon.permission.media.session.voicecommandcontrol` | `app.json` (DESC-008, Alexa transport) | Yes |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | react-native-video / expo-audio media service | Yes (playback) |
| `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` | expo-audio's config plugin default (`recordAudioAndroid = true`) | **No — removed in v0.1.1.** The app never records. The only runtime user of `MODIFY_AUDIO_SETTINGS` is react-native-video, which calls `AudioManager.setMode(MODE_NORMAL)` and `setSpeakerphoneOn(true)` when a player starts; without the permission Android logs `Audio Settings Permission Denial` and ignores both (no exception), and MODE_NORMAL is already the default. Seen on the emulator: playback, the AD track and Extended-mode clips (expo-audio) all play. |
| `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW`, `VIBRATE` | Expo / React Native template defaults | No — removed in v0.1.1 |
| `com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE` | Install Referrer library pulled in by `expo-application` | No (harmless; not used) |
| `dev.moizp.described.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | AndroidX (signature-level, internal) | Automatic |

## 2. Blockers and decisions for the owner

**B1 — manifest fix and rebuild — done (this PR, v0.1.1; versionCode 2 so it installs over the sideloaded v0.1.0).** Without
`android.hardware.touchscreen required="false"` the Appstore is likely to list no Fire TV device as compatible, so the
app cannot target Fire TV at all; the implied microphone requirement can filter more. Approved and done as below; built
with `node scripts/build-apk.js --url <hosted API URL>` (the same URL `--hosted` resolves to; this checkout had no
`infra/cdk-outputs-viewer.json`). The aapt check in step 3 and an emulator run (in-place update over v0.1.0, Home from
the hosted API, About's privacy line, playback with the AD track, Extended pause at 0:00 of Tears of Steel, Back to the
launcher, no `FATAL EXCEPTION` or `ANR`) pass; the stick run is still to do:

1. `apps/expo/app.json`: add `"blockedPermissions": ["android.permission.RECORD_AUDIO", "android.permission.MODIFY_AUDIO_SETTINGS", "android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE", "android.permission.SYSTEM_ALERT_WINDOW", "android.permission.VIBRATE"]` under `android`
   ([Expo `android.blockedPermissions`](https://docs.expo.dev/versions/latest/config/app/#blockedpermissions)), and
   `["expo-audio", { "recordAudioAndroid": false }]` in `plugins`
   (option read from `expo-audio/plugin/build/withAudio.js`; [expo-audio config](https://docs.expo.dev/versions/latest/sdk/audio/)).
   Check first that nothing uses MODIFY_AUDIO_SETTINGS at runtime (narration ducking is mixed into the stream, not done on the device).
2. A config plugin (like `plugins/withTvBanner.js`) that adds to `<manifest>`:
   `<uses-feature android:name="android.hardware.touchscreen" android:required="false"/>`,
   `<uses-feature android:name="android.hardware.faketouch" android:required="false"/>`,
   `<uses-feature android:name="android.hardware.microphone" android:required="false"/>`,
   `<uses-feature android:name="android.software.leanback" android:required="false"/>`.
3. Verify: `aapt dump badging described-0.1.1.apk` lists those four as `uses-feature-not-required` and no
   `uses-implied-feature` for the microphone; then the same emulator/stick run as §1.
4. Bundle D6 (privacy link in the app) into the same rebuild.

**D2 — upload keystore.** Create one dedicated key, keep it out of git, and sign every public APK with it:

```sh
mkdir -p ~/.described-keys && chmod 700 ~/.described-keys
keytool -genkeypair -v -storetype PKCS12 -keystore ~/.described-keys/described-upload.p12 \
  -alias described-upload -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Described, O=Moiz Lakkadkutta"
# after build-apk.js (output is debug-signed), re-sign the APK with the upload key:
$ANDROID_HOME/build-tools/36.0.0/apksigner sign --ks ~/.described-keys/described-upload.p12 \
  --ks-key-alias described-upload --out apps/expo/dist/described-0.1.1-upload.apk apps/expo/dist/described-0.1.1.apk
$ANDROID_HOME/build-tools/36.0.0/apksigner verify --print-certs apps/expo/dist/described-0.1.1-upload.apk
```

Back the `.p12` and its password up somewhere safe (a password manager); losing it means sideloaded users must
uninstall to update. `*.p12`, `*.jks` and `*.keystore` should stay out of the repo. Note: the Appstore copy is re-signed
by Amazon, so its Android ID — and therefore its device key, settings and My list — differs from a sideloaded install on
the same stick.

**D3 — keep the hosted API up after 20 Nov 2026?** The hosted API (Lambda function URL + RDS, us-east-1) is planned to
stay up until 20 Nov 2026, the end of judging. A store listing is for the public: if the API goes away, the app shows
no catalogue and fails Amazon's core-functionality checks, and the listing can be suppressed. Choose one before
submitting: (a) keep the API and RDS running for as long as the app is listed (ongoing AWS cost for Lambda, RDS and
CloudFront), or (b) plan to unlist the app on the Appstore before shutting the API down. Either way, update the privacy
policy's "until the hosted service is shut down" if you set a date.

**D4 — Fire TV background image (required, missing).** Amazon lists it as *Required*: 1920 × 1080, JPG or 24-bit PNG, no
transparency, main subject on the right inside the 1214 × 830 safe area, no logos or titles, different imagery from the
app icon. Nothing in `apps/expo/assets/store/` fits, and this PR does not draw new art. A simple option: a still from
Sintel (CC-BY 3.0, credited in the long description) exported at full width from the official
`Sintel.2010.1080p.mkv`, letterboxed onto `#0D1215`, subject on the right. Save it as
`apps/expo/assets/store/described-firetv-background-1920x1080.png` and to `~/Downloads/described-devpost/appstore/art/`.

**D5 — customer support email.** Step 1 fills *Customer support email/phone/website* from your company profile. The
privacy policy points to GitHub issues, not an email address; decide whether to put an email in the console field or
leave only the website (`https://github.com/moiz-lakkadkutta/described/issues`).

**D6 — privacy policy inside the app — done (this PR, v0.1.1).** Add a line under Settings › About & licenses: "Privacy policy:
github.com/moiz-lakkadkutta/described/blob/main/docs/privacy.md" (text, as the TV has no browser), in the same rebuild
as B1.

**D7 — deletion approach.** The app does not show the device key, so [privacy.md](../privacy.md#delete-your-data)
promises to delete every viewer's settings, My list and resume points on any deletion request. If you would rather
delete one device's rows, the app needs to show its key (for example in About) — a later version.

**D8 — Amazon DRM.** Recommended **No**: the app is free and the catalogue is open films.

**D9 — availability.** Recommended: all countries (default). The narration and captions are English only.

## 3. Upload folder

| What | Path |
|---|---|
| APK (B1 and D6 in; debug-signed until D2) | `~/Downloads/described-devpost/described-0.1.1.apk` — sha256 `ab73e20547fe809e5b0cdb24851033bc162c70006832f0f0ad66680e01f33f9d` |
| Icons, Fire TV app icon | `~/Downloads/described-devpost/appstore/art/` — `described-icon-114.png`, `described-icon-512.png`, `described-firetv-1280x720.png` |
| Screenshots (1920 × 1080, 24-bit PNG, upload in this order) | `~/Downloads/described-devpost/appstore/screens/01-home.png` … `09-about.png` |
| Devpost gallery copies (1800 × 1200, letterboxed on `#0D1215`) | `~/Downloads/described-devpost/gallery-app/` |
| Background image | missing — D4 |

Art check (PR #89's `apps/expo/assets/store/`): the 512 and 114 icons are RGBA PNGs (format allows transparency; both
are fully opaque, full-bleed, which Amazon's "key art to the edge, no rounded corners" asks for). The 1280 × 720 Fire TV
icon was RGBA; Amazon requires no transparency, so this PR flattens it onto `#0D1215` and saves it as 24-bit RGB (pixels
unchanged, as its alpha was 255 everywhere).

Screenshots were captured from the release APK on the Android TV emulator with `adb exec-out screencap -p` (Amazon's
documented method), with the hosted API and CloudFront, no mock-ups or composites; the only processing was dropping the
all-255 alpha channel to make 24-bit PNGs. Video decoded on the emulator, so the player shots are real frames.

## 4. Developer Console steps, in order

Sign in at https://developer.amazon.com/apps-and-games/console/apps/list.html → **Add new app** → **Android** (Fire OS).

### Step 1 — Upload your app file

1. Drag in the APK (after B1 and D2). Open **Manifest** on the uploaded file and check: package `dev.moizp.described`,
   versionCode 2, minSdk 24, `android.hardware.touchscreen` not required.
2. **Apply Amazon DRM?** → No (D8).
3. **App title** → `Described`. **App SKU** → `dev.moizp.described.v1`.
4. **App category** → Movies & TV › On-Demand Movie Streaming.
5. **Language support** → English.
6. **Customer support contact** → website `https://github.com/moiz-lakkadkutta/described/issues`; email/phone per D5.
7. Save.

### Step 2 — Target your app

1. **Supported devices** → Edit supported devices: keep only the **Amazon Fire TV** tab's devices; clear Fire tablets and
   Amazon Automotive. If no Fire TV device can be selected, hover the help icon — it is B1.
2. **Availability** → all countries (D9).
3. **Target audience** → Apps not designed for children (16 and above) — [listing.md](listing.md#target-audience-step-2).
4. **Content rating** → answers and reasons in [listing.md](listing.md#content-rating-questionnaire-step-2).
5. **User data privacy** → Yes; privacy policy URL
   `https://github.com/moiz-lakkadkutta/described/blob/main/docs/privacy.md` (works after this PR is on main);
   questionnaire and deletion link per [listing.md](listing.md#user-data-privacy-step-2).
6. Save.

### Step 3 — Appstore details

1. **Pricing** → Free.
2. **Display title**, **Short description**, **Long description**, **Product feature bullets**, **Keywords** → the
   blocks in [listing.md](listing.md).
3. **Tablet assets** → small icon `described-icon-114.png`, large icon `described-icon-512.png`; screenshots: the same
   nine files (1920 × 1080 is an allowed tablet size).
4. **Fire TV assets** → App icon `described-firetv-1280x720.png`; Screenshots `01-home.png` … `09-about.png` in order;
   Background image per D4.
5. No promotional image or video needed.
6. Save.

### Step 4 — Review and submit

1. **When would you like publishing to start?** → leave blank (as soon as it passes).
2. **Testing instructions** → paste:

```
No sign-in. The app streams from our hosted service; it needs an internet connection.
Home: the first row's "Play with description" plays Sintel (15 min) with audio description; the narration is a second audio track.
Press Menu during playback to open Audio & captions: Audio (Original / Audio description), Captions (Off / Captions / Rich captions / Description text) and Extended mode.
Extended mode pauses the film briefly ("Describing…" bar) when there is more to describe; Sintel has 18 such pauses; one is at about 3:22.
Rich captions show a bracketed sound at Sintel 3:23 ("[creature roars]").
Settings (left rail) holds description default, voice, Extended mode and caption options; About & licenses shows the film credits.
All films are Blender Foundation open movies under CC-BY 3.0 / 2.5, credited in the app and the listing.
```

3. **Export compliance** → confirm.
4. **Submit App.**

After submitting: Amazon emails the account owner; review usually takes several days
([Step 4](https://developer.amazon.com/docs/app-submission/review-submit.html)).
