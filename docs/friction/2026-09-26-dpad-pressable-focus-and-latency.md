# dpad pressable focus and latency

Task attempted: Build a screen in the multi-TV sample's Expo app and navigate it with the Fire TV remote's D-pad.
Steps:
  1. Built a screen with React Native `Pressable` elements and `hasTVPreferredFocus` on the first one.
  2. Ran it on the stick (debug build) and pressed the D-pad.
  3. Rebuilt the screen with react-tv-space-navigation, as the sample's own screens do.
  4. Sent D-pad RIGHT presses 0.4 s apart with `adb shell input keyevent` and logged focus changes with timestamps.
Expected: Native Android focus moves between `Pressable`s on D-pad presses; each press moves focus promptly.
Actual:
  (a) With `Pressable` + `hasTVPreferredFocus`, focus never moved. The sample's MainActivity `onKeyDown`/`onKeyUp`
      (react-native-keyevent plugin) return `true`, consuming the key events, so native focus navigation never runs.
      Only react-tv-space-navigation focus works.
  (b) With space-navigation, each RIGHT press moved focus ~1.3 s after the previous one even though presses were sent
      0.4 s apart (focus log timestamps 16:03:45.318, 46.651, 47.995, 49.425). A human pressing at normal speed saw
      focus "stuck" and pressed the wrong button. This was measured on a debug build (JS dev mode); a release-build
      measurement is still needed.
Cause: (a) Key events are consumed in MainActivity by the keyevent plugin. (b) Not determined; debug-mode JS on a
low-end stick is a likely contributor.
Severity: High — (a) the standard RN TV focus API silently does nothing in the sample; (b) per-keypress lag causes
wrong selections.
Workaround: Build every focusable screen with react-tv-space-navigation instead of native `Pressable` focus. For (b),
none yet beyond pressing slowly; verify on a release build.
Suggestion: Document in the sample that key events are consumed by the keyevent plugin and that only space-navigation
focus works (or make `onKeyDown`/`onKeyUp` return the super result). Investigate per-keypress latency on low-end
sticks and publish a release-build baseline.
Environment: Apple Silicon Mac, Darwin 25.2 (macOS 26); Fire TV Stick model AFTSS, Fire OS 7.7.1.6 (Android 9, API 28);
AmazonAppDev/react-native-multi-tv-app-sample at 92c6f7c (apps/expo-multi-tv: Expo SDK 54, react-native-tvos 0.81,
react-native-video ^6.8). Observed 2026-09-26.
Links: https://github.com/AmazonAppDev/react-native-multi-tv-app-sample
