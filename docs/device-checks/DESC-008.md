# DESC-008 device check — deep links, Alexa transport, media keys

Run on the stick (AFTSS, Fire OS 7) with a **release** build. Setup and build as in DESC-005 §0–1, plus
`npx expo prebuild --clean` once: this ticket adds an intent filter and a native module. Tick each box; failures go
to a friction log (`pnpm friction "<title>"`) or back to the ticket. Background: docs/platform/fire-os-bindings.md.

Handy logcat filter for the whole check (second terminal):

```sh
adb logcat -c && adb logcat -s ReactNativeJS:V DescribedMediaSession:V MediaSessionService:V
```

## 1. Build with the native module

- [ ] `EXPO_PUBLIC_API_URL=http://<mac-ip>:4000 npx expo run:android --variant release` succeeds.
      If it fails in `:described-media-session` (Kotlin), add `"expo": { "autolinking": { "exclude": ["described-media-session"] } }`
      to apps/expo/package.json, rebuild, file a friction log with the compiler error, and skip §3.
- [ ] `grep -A4 'android.intent.action.VIEW' android/app/src/main/AndroidManifest.xml` shows `android:scheme="described"`;
      MainActivity has `android:launchMode="singleTask"`.
- [ ] `npx expo-modules-autolinking resolve -p android | grep DescribedMediaSessionModule` prints the module.

## 2. Deep links (launch intents)

Catalog has `sintel-90-210` (DESC-005 §0).

- [ ] **Cold start, Title:** `adb shell am force-stop dev.moizp.described`, then
      `adb shell am start -a android.intent.action.VIEW -d "described://title/sintel-90-210"`
      → app opens, Home loads, then the Sintel Title screen. Logcat: `[described] launch described://title/sintel-90-210 → title sintel-90-210`.
- [ ] **Warm, Play with start time:** with the app open on Home,
      `adb shell am start -a android.intent.action.VIEW -d "described://play/sintel-90-210?t=60"`
      → Player starts at ≈ 1:00 with **Audio description** selected (status line). Back → Sintel Title.
- [ ] **Play without start time:** watch > 30 s, Back, Home, then `… -d "described://play/sintel-90-210"` → resumes at the saved point.
- [ ] **Unknown title:** `… -d "described://title/no-such-title"` → stays on Home, no offline screen. Logcat shows the launch line.
- [ ] **Not ours:** `… -d "described://settings/x"` → logcat `→ ignored`, nothing changes.
- [ ] **During first run:** clear the profile (new device id or reset `firstRunDone`), force-stop, start with the Title link
      → first run shows first; after its last panel the app goes to the Sintel Title screen, not Home.
- [ ] `adb shell am start` reports no `Error: Activity not started` and no second Described task appears in Recents.

## 3. Alexa transport (media session)

Start Sintel from the app and let it play. Watch logcat (`DescribedMediaSession`).

- [ ] On play: `session created`, `session active: Sintel`.
- [ ] `adb shell dumpsys media_session | grep -A12 DescribedMediaSession` → `active=true`, `state=PlaybackState {state=3` (playing),
      actions include play/pause/seek (`actions=` bit mask ≠ 0), metadata title Sintel.
- [ ] **Remote mic (near-field):** hold the Alexa button, say **"pause"** → video pauses; logcat `transport control=pause`;
      status line and the paused state agree. Say **"resume"** (or "play") → plays (`control=play`).
- [ ] Say **"fast forward"** / **"rewind"** → jumps ±10 s (`fastForward` / `rewind`).
- [ ] Say **"go to 5 minutes"** (or "skip to 5 minutes") → `control=seekTo positionS=300.0`, video at 5:00.
- [ ] **Echo (far-field)**, if one is paired: "Alexa, pause" / "Alexa, resume" behave the same.
- [ ] If any voice command logs `control=button keyCode=…` instead of a named control, Alexa arrives as a media button:
      set `createMediaSession(nativeMediaSession, { acceptButtons: true })` in apps/expo/App.tsx, rebuild, re-test §3–4,
      and note it in the friction log.
- [ ] While Alexa listens (blue bar), playback pauses or ducks; after the command it continues correctly. Note what happens.
- [ ] Back to Title → logcat `session released`; "Alexa, pause" on the Title screen does nothing to Described.
- [ ] Extended description: during a pause–speak–resume (DESC-007), say "resume" — note whether video talks over the
      narration (known gap; record, don't fix here).

## 4. Media keys

With the Player playing (key path from plugins/withKeyEvent.js; Player key handling is DESC-006):

- [ ] `adb shell input keyevent KEYCODE_MEDIA_PAUSE` → logcat `DescribedMediaSession: transport control=button keyCode=127`
      **once** (swallowed by the session) and the key also reaches JS (`onKeyDown` 127). Video pauses **once** after DESC-006.
- [ ] `adb shell input keyevent KEYCODE_MEDIA_PLAY` → resumes; `KEYCODE_MEDIA_PLAY_PAUSE` (85) toggles exactly once — no
      pause-then-play flicker.
- [ ] `KEYCODE_MEDIA_FAST_FORWARD` / `KEYCODE_MEDIA_REWIND` → ±10 s once per press (after DESC-006).
- [ ] Physical remote ⏯ behaves like the adb key.

## 5. Catalog feed (Mac, no device)

- [ ] `curl -s 'http://localhost:4000/catalog/fire-tv.xml' | xmllint --format -` is well-formed and lists every published title
      with `described://play/<slug>` in its comment.
- [ ] Each comment's play link, sent with `adb shell am start -a android.intent.action.VIEW -d …`, starts that title (§2).
