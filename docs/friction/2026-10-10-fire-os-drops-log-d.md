# Fire OS drops Log.d: a native module's debug logs never reach logcat on the stick

Task attempted: DESC-008 device run check 14 — read `adb logcat -s DescribedMediaSession` while Alexa commands arrive.
Steps:
  1. Build and install the release app with the `described-media-session` module (it logs with `Log.d(TAG, …)`).
  2. Play Sintel; `adb logcat -d | grep DescribedMediaSession`.
  3. `adb logcat -d -v brief | cut -c1 | sort | uniq -c` — count lines by priority.
Expected: `session created`, `session active: Sintel`, `transport control=…` lines from the module.
Actual: only Fire TV's own `whad-MediaSessionClient` lines mention the tag. The whole buffer holds E / I / W lines and
  not a single D or V line from any process: the Fire OS 7 user build (AFTSS, PS7717.5741N, API 28) drops debug
  priority at logd. The device check could not tell whether the module ran, which cost the diagnosis of the session
  churn an evening (run check 14: Alexa fast forward / rewind / go to did nothing).
Severity: Medium — hours lost; blocks any device check that reads a module's debug log.
Workaround: log at `Log.i` in native modules meant to be read on the stick (DescribedMediaSessionModule.kt now does).
  Also: the main log buffer is small; a cold start wraps it in ~10 s, so read with a tag filter
  (`adb logcat -d -s DescribedMediaSession:I whad-MediaSessionClient:I`) rather than grepping `logcat -d`.
Suggestion: a note in docs/device-checks/RUN-*.md §0.9 (log windows): "Fire OS shows I and above only".
Environment: macOS, Expo SDK 54 / expo-modules-core 3.0.30, Fire TV Stick AFTSS Fire OS 7 (Android 9, API 28).
Links: docs/device-checks/DESC-008.md §3, docs/platform/fire-os-bindings.md §4.
