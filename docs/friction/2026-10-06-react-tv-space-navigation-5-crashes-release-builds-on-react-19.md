# react-tv-space-navigation 5 crashes release builds on React 19

Task attempted: Device run-through check 1 (docs/device-checks/RUN-2026-10.md): install the Described release build on the
Fire TV Stick and launch it. Every unit test had passed.
Steps:
  1. `npx expo prebuild --clean` and `npx expo run:android --variant release` in `apps/expo` (Expo SDK 54, React 19.1,
     React Native 0.81, react-tv-space-navigation 5.2.0).
  2. Launched the app on the stick and read `adb logcat`.
Expected: the app starts on the first-run panels.
Actual: the app crashed at startup. Logcat: `TypeError: Cannot read property 'ReactCurrentOwner' of undefined`, then
`"main" has not been registered`.
Cause: react-tv-space-navigation 5.2.0 ships a webpack `dist` that embeds React 18's jsx runtime, which reads React
internals (`ReactCurrentOwner`) that React 19 no longer has. Expo SDK 54 uses React 19.1. 6.0.0-beta1 embeds React 19's
runtime; its type definitions changed only for React 19 typing, so the app needed no other change.
Severity: High — the release build did not start at all; it blocked the whole device run until fixed (PR #23). Unit tests
could not catch it because they stub the library.
Workaround: upgrade to react-tv-space-navigation 6.0.0-beta1. PR #23 adds a test that loads the real `dist` under React 19
(it fails on 5.2.0).
Suggestion: Amazon's multi-TV sample (AmazonAppDev/react-native-multi-tv-app-sample) uses react-tv-space-navigation for focus;
its docs should name the version that works with Expo SDK 54 / React 19, and say that 5.x fails only in release builds.
Environment: Fire TV Stick AFTSS, Fire OS 7.7.1.6 (Android 9, API 28); Expo SDK 54, React 19.1.0, React Native 0.81.0;
react-tv-space-navigation 5.2.0 → 6.0.0-beta1. Observed 2026-10-06.
Links: https://github.com/bamlab/react-tv-space-navigation/releases/tag/v6.0.0-beta1 ·
https://github.com/AmazonAppDev/react-native-multi-tv-app-sample · PR #23
