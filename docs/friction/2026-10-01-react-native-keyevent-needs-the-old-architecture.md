# react native keyevent needs the old architecture

Task attempted: Feed Fire TV remote keys to react-tv-space-navigation in the Described Expo app (DESC-005), the way the
multi-TV sample does, on Expo SDK 54 / React Native 0.81.
Steps:
  1. Added react-native-keyevent 0.3.2 and a config plugin that forwards `dispatchKeyEvent` to its `KeyEventModule`
     (adapted from the sample's `withKeyEvent`).
  2. Read the library: a 2023 Java `ReactContextBaseJavaModule` registered by a classic `ReactPackage`; a static
     `getInstance()` that stays null until the bridge creates the module; events go out through
     `RCTDeviceEventEmitter`. Its JS `onKeyDownListener` keeps exactly one listener.
  3. Expo SDK 54 turns the new architecture on by default; the sample Gate A ran on sets `newArchEnabled: false`.
Expected: A documented, new-architecture-ready way to receive D-pad key-downs on Android TV / Fire OS from JS.
Actual: The only path proven on the stick runs on the old architecture, so the app sets `newArchEnabled: false`.
React Native 0.82 runs only on the new architecture and Expo SDK 54 is the last SDK with the old one, so this pins the
app to RN 0.81 / SDK 54 until the key source changes. Not yet tried on the new architecture (interop layer), so whether
it works there is unknown. The single-listener JS API also means a second listener (e.g. Play/Pause) silently replaces
D-pad navigation; the app subscribes to `DeviceEventEmitter` directly instead.
Severity: Medium — no failure today, but it blocks the RN/Expo upgrade path and the cause is easy to miss.
Workaround: `newArchEnabled: false` (comment in apps/expo/plugins/withKeyEvent.js); subscribe with
`DeviceEventEmitter.addListener('onKeyDown', …)` per consumer.
Suggestion: The multi-TV sample (and react-tv-space-navigation's docs) should show a new-architecture key source for
Android TV — e.g. react-native-tvos `TVEventHandler`, or a small Turbo Module — and say that keyevent needs the old one.
Environment: Linux dev container; Expo SDK 54.0.37, React Native 0.81.0, react-native-keyevent 0.3.2,
react-tv-space-navigation 5.2.0. Target Fire TV Stick AFTSS, Fire OS 7.7.1.6. Observed 2026-10-01 (code reading + prebuild).
Links: https://github.com/kevinejohn/react-native-keyevent ; https://github.com/AmazonAppDev/react-native-multi-tv-app-sample ;
https://docs.expo.dev/guides/new-architecture/ ; https://reactnative.dev/architecture/landing-page
