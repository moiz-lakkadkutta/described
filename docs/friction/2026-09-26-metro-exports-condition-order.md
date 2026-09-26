# metro exports condition order

Task attempted: Consume an out-of-repo React Native library (vega-media-kit) from the multi-TV sample's Expo app, linked
via a Yarn 4 `portal:` dependency, so Fire OS and Vega apps share one player codebase.
Steps:
  1. Added the library to the sample with a Yarn 4 `portal:` dependency (Yarn warned that portals need
     `--preserve-symlinks`).
  2. The library's `package.json` `exports` entries list `import`/`require` conditions before `react-native`.
  3. Ran the app on the stick through Metro.
Expected: Metro picks the library's `react-native` source entry, and the library's imports resolve against the app's
dependencies.
Actual: Metro resolved the library's prebuilt `dist/` instead of its `react-native` source entry. The dist's lazy
`require('react-native-video')` then failed under Metro: "Requiring unknown module \"react-native-video\"" and
"TypeError: Cannot read property 'default' of undefined". Getting it working also needed:
  - a `blockList` for the library's own `node_modules` (duplicate React → invalid hook call risk);
  - a `resolveRequest` that resolves the library's bare imports from the app;
  - stubs for the other platform's player packages.
Cause: Metro's package-exports resolution takes the FIRST matching condition in object key order, so an `exports` map
with `import`/`require` ahead of `react-native` resolves to the non-RN build.
Severity: Medium — blocks the "one codebase" setup until Metro config is hand-tuned; the error points at a missing
native module rather than at resolution order.
Workaround: A custom `resolveRequest` (plus `blockList` and platform stubs) in the app's `metro.config.js`. Library fix:
put `react-native` first in each `exports` entry.
Suggestion: The multi-TV sample/docs should show how to consume a shared RN library across Fire OS and Vega apps (this
is exactly the "one codebase" story), including exports condition order and the Metro config needed for linked
packages.
Environment: Apple Silicon Mac, Darwin 25.2 (macOS 26); Fire TV Stick model AFTSS, Fire OS 7.7.1.6 (Android 9, API 28);
AmazonAppDev/react-native-multi-tv-app-sample at 92c6f7c (apps/expo-multi-tv: Expo SDK 54, react-native-tvos 0.81,
react-native-video ^6.8). Observed 2026-09-26.
Links: https://github.com/AmazonAppDev/react-native-multi-tv-app-sample ; https://metrobundler.dev/docs/package-exports/
