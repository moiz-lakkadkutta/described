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
      error, and does not start over (an explicit `?t=` skips the resume-near-end rule).
- [ ] **Same title, new time:** while Sintel plays, `… -d "described://play/sintel-90-210?t=300"` → the Player restarts at 5:00.
- [ ] **Unknown title:** `… -d "described://title/no-such-title"` → stays on Home, no offline screen. Logcat shows the launch line.
- [ ] **Not ours:** `… -d "described://settings/x"` → logcat `→ ignored`, nothing changes.
- [ ] **During first run:** clear the profile (new device id or reset `firstRunDone`), force-stop, start with the Title link
      → first run shows first; after its last panel the app goes to the Sintel Title screen, not Home.
- [ ] `adb shell am start` reports no `Error: Activity not started` and no second Described task appears in Recents.

## 3. Alexa transport (media session) — BLOCKING

**DESC-008 is not done until every box in this section passes on the stick.** A failure here is a ticket bug, not a
note: record the logcat lines and stop.

Start Sintel from the app and let it play. Watch logcat (`DescribedMediaSession`, `ReactNativeJS`).

**Prerequisite (Fire OS before 14):** Fire TV's voice controller only targets a MediaSession when the app declares
`<uses-permission android:name="com.amazon.permission.media.session.voicecommandcontrol" />` (app.json
`android.permissions`) and opts in with `<meta-data android:name="com.amazon.voice.supports_background_media_session"
android:value="true" />` (plugins/withFireTvVoice.js). https://developer.amazon.com/docs/fire-tv/mediasession-api-integration.html

- [ ] `aapt dump xmltree <apk> AndroidManifest.xml | grep -iE "voicecommandcontrol|supports_background_media_session"` → both present;
      after install `adb shell dumpsys package dev.moizp.described | grep voicecommandcontrol` → granted.
- [ ] Clear logcat first (`adb logcat -G 16M && adb logcat -c`). After the voice commands,
      `adb logcat -d | grep -E "OrchestratingCommandExecutor|ButtonPressCommand|transport control="` shows **no**
      `No target session, trying button press` / `ButtonPress…Command` and no `control=button keyCode=85/87/88`.

**Result 2026-10-19 (Fire OS 7, build without the permission): FAIL.** Pause and resume toggled; fast forward, rewind and
restart did nothing. Vizzini logged `No target session, trying button press.` on every directive and injected keys 85
(pause and resume), 87 (fast forward) and 88 (rewind and restart). The session itself was created once, active and
published. Cause: the missing permission (and opt-in). Details: RUN-2026-10.md check 14.

- [ ] On play: `session created`, `session active: Sintel`.
- [ ] `adb shell dumpsys media_session | grep -A12 DescribedMediaSession` → `active=true`, `state=PlaybackState {state=3` (playing),
      `actions=` ≠ 0, metadata title Sintel.
- [ ] **"Alexa, pause"** (hold the remote's Alexa button, say "pause") → video pauses within ~1 s and **stays paused**; status line
      agrees. Logcat shows exactly one of: `transport control=pause`, or `media button 127 action=0 → default mapping` followed
      by `transport control=pause`. Either is a pass.
- [ ] **"Alexa, resume"** (and separately **"Alexa, play"**) → plays again (`control=play`, or `media button 126 … → default mapping` then `control=play`).
- [ ] Repeat pause / resume three times in a row: the video ends in the state you last asked for every time (no double toggle).
- [ ] **"Alexa, fast forward"** / **"Alexa, rewind"** → jumps ±10 s once. Fire TV sends these as a seek to the computed
      position (`control=seekTo positionS=<current ± 10>`, per the Fire TV doc's table); `control=fastForward` / `rewind`
      would come from another controller and is also a pass.
- [ ] **"Alexa, restart"** → `control=seekTo positionS=0.0`, video at 0:00.
- [ ] "Alexa, go to N seconds / minutes" is absolute time, which Fire TV's mapping does not support (the doc: "absolute
      time is not supported"): Alexa says it is not supported, or nothing happens. **Not a FAIL.**
- [ ] **One session per playback (run check 14 regression):** across all the voice commands above, logcat shows
      `session created` **once**, and `adb logcat -d | grep -c 'New Session: tag=DescribedMediaSession'` stays at 1 for
      this playback (Fire TV's publisher `whad` logs one per *activation*). During each voice interaction logcat shows
      `activity paused, still visible: session stays active` and **no** `session inactive (activity stopped)`, and
      `dumpsys media_session` keeps `active=true` while the Alexa UI is up — the Alexa UI pauses the activity, and an
      inactive session would be unpublished before the SeekTo directive lands. (If the Alexa UI stopped the activity
      instead, `(activity stopped)` would show and the visibility fix would be a no-op: record it as a FAIL.)
- [ ] If any voice command logs **only** `transport control=button keyCode=…` (85, 87, 88, 89 or 90), Fire TV fell back to
      key injection and did not target the session: FAIL. Check the prerequisite above first. Do **not** set
      `acceptButtons` or map 87 / 88 to seeks: 85 is a toggle either way, and rewind and restart both arrive as 88. If the
      permission is granted and Vizzini still says `No target session`, uninstall and reinstall (not an update in place),
      then capture `adb shell dumpsys media_session` while the Alexa overlay is up.
- [ ] **Echo (far-field)**, if one is paired: "Alexa, pause" / "Alexa, resume" behave the same.
- [ ] While Alexa listens (blue bar), playback pauses or ducks; after the command it continues correctly. Note what happens.
- [ ] **Background:** while playing, press the remote's Home → logcat `session inactive (activity stopped)`; `dumpsys
      media_session` shows `active=false`; "Alexa, pause" does not reach Described. Reopen Described → `session active
      (activity started)`, and "Alexa, pause" works again. (Fire OS drops `Log.d`: the module logs at `Log.i`, so
      `adb logcat -s DescribedMediaSession` shows everything.)
- [ ] Back to Title → logcat `session released`; "Alexa, pause" on the Title screen does nothing to Described.
- [ ] Extended description: during a pause–speak–resume (DESC-007), say "resume" → the description stops at once and
      the film plays (video never plays over the narration). Say "pause" during the description instead → the description
      finishes and the film **stays paused**. See DESC-007.md §3.

## 4. Media keys

With the Player playing. Each key must have exactly one handler (docs/platform/fire-os-bindings.md §4):

**Fallback switch.** Key ownership is one constant: `MEDIA_SESSION_OWNS_KEYS` in apps/expo/src/platform/mediaSession.ts
(default `true`). JS takes 126 / 127 / 86 off the key path only while a Player is published **and** the native module has
reported `onSessionState { active: true }` (session created and active, app in the foreground). If a step below fails
because the session does not get the key, set it to `false`, rebuild, re-run §4, and file a friction log — every media
key then stays on the key path (Player's handling), and Alexa still works through the session's own callbacks.

- [ ] On play, logcat shows `session active: Sintel` before you press anything (that is when JS starts skipping 126/127/86).
- [ ] `adb shell input keyevent KEYCODE_MEDIA_PAUSE` → logcat `media button 127 … → default mapping` and `control=pause`;
      the video pauses once. **If nothing happens**, Android is not handing the key to the session: set
      `MEDIA_SESSION_OWNS_KEYS = false` (above) and repeat this section.
- [ ] `adb shell input keyevent KEYCODE_MEDIA_PLAY` → resumes once (`media button 126 …`, `control=play`).
- [ ] `adb shell input keyevent KEYCODE_MEDIA_PLAY_PAUSE` (85) → logcat `control=button keyCode=85` (swallowed by the session);
      the Player's key handling toggles **exactly once** — no pause-then-play flicker.
- [ ] `KEYCODE_MEDIA_FAST_FORWARD` / `KEYCODE_MEDIA_REWIND` → the bar jumps ±10 s once per press and the seek commits ~0.3 s later;
      `adb shell dumpsys media_session | grep -A6 DescribedMediaSession` shows the new position after the commit.
- [ ] Back to Title, then `KEYCODE_MEDIA_PAUSE` on the Title screen → nothing breaks (no session; key path, no Player).
- [ ] Remote Home while playing (`session inactive (background)`), reopen Described (`session active (foreground)`), then
      `KEYCODE_MEDIA_PAUSE` → pauses once.
- [ ] Physical remote ⏯ behaves like the adb key.

## 5. Catalog feed (Mac, no device)

- [ ] `curl -s 'http://localhost:4000/catalog/fire-tv.xml' | xmllint --format -` is well-formed and lists every published title
      with `described://play/<slug>` in its comment.
- [ ] Each comment's play link, sent with `adb shell am start -a android.intent.action.VIEW -d …`, starts that title (§2).
