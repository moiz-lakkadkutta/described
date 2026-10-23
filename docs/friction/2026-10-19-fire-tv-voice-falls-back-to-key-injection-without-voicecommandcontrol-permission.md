# Fire TV voice falls back to key injection without the voicecommandcontrol permission

Task attempted: "Alexa, pause / resume / fast forward / rewind / restart" on Described's Player on a Fire TV Stick (Fire OS 7),
through the app's own `android.media.session.MediaSession` (DESC-008, device run check 14).
Steps:
  1. Played Sintel. The session was created once, active, and published by Fire TV's `whad`, with `actions=847` (play, pause,
     play/pause, stop, rewind, fast forward, seek to).
  2. Held the remote's mic button and said each command. Captured logcat (`adb logcat -G 16M`, `-c` first).
Expected: Fire TV's voice controller targets the active session: `onPause` / `onPlay`, and `onSeekTo(pos ± 10 s)` / `onSeekTo(0)`.
Actual: Vizzini logged `[Legacy] Checking for media session permission.` and then `No new active media sessions to target.`
  (47 times, never a hit). On all 18 directives it logged `OrchestratingCommandExecutor: No target session, trying button press.`
  and injected keys instead: Pause and Resume both as 85 (PLAY_PAUSE, so each command toggled), fast forward as 87 (MEDIA_NEXT),
  and rewind and restart both as 88 (MEDIA_PREVIOUS). No app can tell 88 for rewind from 88 for restart, or turn it into a
  seek. Nothing in the log or on screen says the permission is the reason. The doc presents the permission as a step that
  Fire OS 14 and later do not need, which reads as optional. On Fire OS 7 the MediaSession path does not work at all without it.
Severity: Medium — about two device runs lost (2026-10-14 inconclusive, 2026-10-19 failed); every Alexa transport box in check 14 blocked.
Workaround: declare `<uses-permission android:name="com.amazon.permission.media.session.voicecommandcontrol" />` (app.json
  `android.permissions`) and the opt-in `<meta-data android:name="com.amazon.voice.supports_background_media_session"
  android:value="true" />` (config plugin `apps/expo/plugins/withFireTvVoice.js`).
Suggestion: say plainly in the doc that before Fire OS 14 the permission is required for voice to reach a MediaSession at
  all. Have Vizzini log the missing permission by package name ("dev.moizp.described lacks …voicecommandcontrol") instead
  of "No target session".
Environment: macOS, Expo (React Native, old architecture), Fire TV Stick AFTSS (Fire OS 7), 2026-10-19.
Links: https://developer.amazon.com/docs/fire-tv/mediasession-api-integration.html · docs/device-checks/RUN-2026-10.md check 14 ·
  docs/device-checks/DESC-008.md §3
