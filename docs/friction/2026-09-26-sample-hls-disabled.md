# sample hls disabled

Task attempted: Play an HLS stream in the multi-TV sample's Expo app (react-native-video) on a Fire TV Stick.
Steps:
  1. Pointed the sample's player at an HLS (`.m3u8`) URL.
  2. Ran the app on the stick and started playback.
  3. Checked logcat.
  4. Found the sample's `app.json` configures the react-native-video plugin with
     `androidExtensions.useExoplayerHls=false` (→ `RNVideo_useExoplayerHls=false` in `gradle.properties`).
  5. Flipped it to `true` and did a full native rebuild.
Expected: HLS plays out of the box — it is the dominant streaming format on Fire TV.
Actual: Every HLS URL failed with the sample harness's generic "EXO Playback error". Only logcat showed the real
reason: "RNVExo Player Exception: HLS is not enabled!". Fixing it required a config change plus a full native rebuild;
the first Gradle build on this Mac took 10m58s (including SDK/NDK downloads).
Cause: The sample ships with ExoPlayer's HLS extension disabled in the react-native-video config plugin options.
Severity: Medium — blocks any real-world content until found; the on-screen error gives no hint, and the fix costs a
full native rebuild.
Workaround: Set `androidExtensions.useExoplayerHls: true` for the react-native-video plugin in `app.json`, re-run
prebuild / the native build, reinstall.
Suggestion: Enable HLS in the sample (Fire TV content is overwhelmingly HLS/DASH), or at least document the flag next to
the player code and surface the underlying ExoPlayer message in the harness's error UI.
Environment: Apple Silicon Mac, Darwin 25.2 (macOS 26); Fire TV Stick model AFTSS, Fire OS 7.7.1.6 (Android 9, API 28);
AmazonAppDev/react-native-multi-tv-app-sample at 92c6f7c (apps/expo-multi-tv: Expo SDK 54, react-native-tvos 0.81,
react-native-video ^6.8). Observed 2026-09-26.
Links: https://github.com/AmazonAppDev/react-native-multi-tv-app-sample
