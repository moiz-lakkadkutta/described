# adb screencap black

Task attempted: Capture screenshots of the running app on a Fire TV Stick as evidence for device tests.
Steps:
  1. With the app visibly rendering on the TV: `adb exec-out screencap -p > shot.png`.
  2. Repeated during video playback.
Expected: A PNG of what is on screen.
Actual: An all-black 1920×1080 PNG every time, both with the app UI showing and during video playback. Evidence for
device tests had to come from logcat plus phone photos of the TV.
Cause: Not confirmed; likely the device blocks screen capture (HDCP / secure surfaces).
Severity: Low — does not block development, but makes device-test evidence and bug reports much harder to produce.
Workaround: Logcat for state/assertions; photograph the TV with a phone for visuals.
Suggestion: Document which Fire TV models block `screencap` (HDCP/secure surfaces) and provide an Amazon-supported way
to capture screenshots/evidence for dev builds.
Environment: Apple Silicon Mac, Darwin 25.2 (macOS 26); Fire TV Stick model AFTSS, Fire OS 7.7.1.6 (Android 9, API 28);
AmazonAppDev/react-native-multi-tv-app-sample at 92c6f7c (apps/expo-multi-tv: Expo SDK 54, react-native-tvos 0.81,
react-native-video ^6.8). Observed 2026-09-26.
Links: https://github.com/AmazonAppDev/react-native-multi-tv-app-sample
