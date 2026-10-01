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
- [ ] **After Back exits (same JS process):** on Home press **Back** (app closes, the process stays —
      `adb shell pidof dev.moizp.described` still prints a pid), then send the **same** link again:
      `adb shell am start -a android.intent.action.VIEW -d "described://title/sintel-90-210"` → Sintel Title opens (not Home);
      logcat shows the launch line a second time. Repeat with `described://play/sintel-90-210?t=60` → Player at ≈ 1:00.
- [ ] **No replay:** after the step above, press Home on the remote and reopen Described from Your Apps → it resumes where it
      was; the link is not applied again (no second launch line in logcat).
- [ ] **Past the end:** `… -d "described://play/sintel-90-210?t=99999"` → Player opens on the last second (clamped), not an
      error. Note what the Player does with it (same as a resume point near the end; rule is DESC-006's).
- [ ] **Unknown title:** `… -d "described://title/no-such-title"` → stays on Home, no offline screen. Logcat shows the launch line.
- [ ] **Not ours:** `… -d "described://settings/x"` → logcat `→ ignored`, nothing changes.
- [ ] **During first run:** clear the profile (new device id or reset `firstRunDone`), force-stop, start with the Title link
      → first run shows first; after its last panel the app goes to the Sintel Title screen, not Home.
- [ ] `adb shell am start` reports no `Error: Activity not started` and no second Described task appears in Recents.

## 3. Alexa transport (media session) — BLOCKING

**DESC-008 is not done until every box in this section passes on the stick.** A failure here is a ticket bug, not a
note: record the logcat lines and stop.

Start Sintel from the app and let it play. Watch logcat (`DescribedMediaSession`, `ReactNativeJS`).

- [ ] On play: `session created`, `session active: Sintel`.
- [ ] `adb shell dumpsys media_session | grep -A12 DescribedMediaSession` → `active=true`, `state=PlaybackState {state=3` (playing),
      `actions=` ≠ 0, metadata title Sintel.
- [ ] **"Alexa, pause"** (hold the remote's Alexa button, say "pause") → video pauses within ~1 s and **stays paused**; status line
      agrees. Logcat shows exactly one of: `transport control=pause`, or `media button 127 action=0 → default mapping` followed
      by `transport control=pause`. Either is a pass.
- [ ] **"Alexa, resume"** (and separately **"Alexa, play"**) → plays again (`control=play`, or `media button 126 … → default mapping` then `control=play`).
- [ ] Repeat pause / resume three times in a row: the video ends in the state you last asked for every time (no double toggle).
- [ ] **"Alexa, fast forward"** / **"Alexa, rewind"** → jumps ±10 s once (`control=fastForward` / `rewind`).
- [ ] **"Alexa, go to 5 minutes"** → `control=seekTo positionS=300.0`, video at 5:00.
- [ ] If any voice command logs **only** `transport control=button keyCode=…` (85, 89 or 90) and the video does not react,
      Alexa sends relative media buttons: set `createMediaSession(nativeMediaSession, { acceptButtons: true })` in
      apps/expo/App.tsx, rebuild, re-run §3 and §4 (check §4 for double toggles), and file a friction log.
- [ ] **Echo (far-field)**, if one is paired: "Alexa, pause" / "Alexa, resume" behave the same.
- [ ] While Alexa listens (blue bar), playback pauses or ducks; after the command it continues correctly. Note what happens.
- [ ] **Background:** while playing, press the remote's Home → logcat `session inactive (background)`; `dumpsys media_session`
      shows `active=false`; "Alexa, pause" does not reach Described. Reopen Described → `session active (foreground)`, and
      "Alexa, pause" works again.
- [ ] Back to Title → logcat `session released`; "Alexa, pause" on the Title screen does nothing to Described.
- [ ] Extended description: during a pause–speak–resume (DESC-007), say "resume" — note whether video talks over the
      narration (known gap; record, don't fix here).

## 4. Media keys

With the Player playing (key path from plugins/withKeyEvent.js; Player key handling is DESC-006):

- [ ] `adb shell input keyevent KEYCODE_MEDIA_PAUSE` → logcat `media button 127 … → default mapping` and `control=pause`;
      the key also reaches JS (`onKeyDown` 127). Video pauses and stays paused (pause is idempotent, so both paths are safe).
- [ ] `adb shell input keyevent KEYCODE_MEDIA_PLAY` → resumes, same two log lines with 126 / `control=play`.
- [ ] `adb shell input keyevent KEYCODE_MEDIA_PLAY_PAUSE` (85) → logcat `control=button keyCode=85` (swallowed by the session);
      after DESC-006 the key path toggles **exactly once** — no pause-then-play flicker.
- [ ] `KEYCODE_MEDIA_FAST_FORWARD` / `KEYCODE_MEDIA_REWIND` → ±10 s once per press (after DESC-006).
- [ ] Physical remote ⏯ behaves like the adb key.

## 5. Catalog feed (Mac, no device)

- [ ] `curl -s 'http://localhost:4000/catalog/fire-tv.xml' | xmllint --format -` is well-formed and lists every published title
      with `described://play/<slug>` in its comment.
- [ ] Each comment's play link, sent with `adb shell am start -a android.intent.action.VIEW -d …`, starts that title (§2).
