# Metro transform cache ignores EXPO_PUBLIC values and bakes the wrong API URL

Task attempted: build the judges' release APK for the Fire TV stick pointing at the hosted API (DESC-034),
`pnpm --filter @described/expo build:apk -- --hosted`, which sets `EXPO_PUBLIC_API_URL` to the Lambda function URL.
Steps:
  1. An earlier release bundle that day was built without `EXPO_PUBLIC_API_URL`.
  2. Built again with `EXPO_PUBLIC_API_URL=https://…lambda-url.us-east-1.on.aws`; Gradle finished without errors.
  3. `unzip -p described-0.1.0.apk assets/index.android.bundle | grep 10.0.2.2` found the fallback URL.
Expected: a production bundle that inlines the `EXPO_PUBLIC_*` values present at build time.
Actual: babel-preset-expo inlines `process.env.EXPO_PUBLIC_*` during the transform, but Metro's transform cache key hashes
  files and config only, never those values. The cached transform of `App.tsx` (in `$TMPDIR/metro-cache`) from the build
  without the variable was reused, so the APK held `http://10.0.2.2:4000` (the emulator fallback). On a stick that means
  "Can't reach the library" and nothing in the build log says why. Reproduced with `expo export:embed`: with and without the
  variable, both bundles gave the fallback.
Severity: Medium — a bisect across Gradle, the daemon and Metro (time not recorded); a release APK that looks fine and cannot reach any API would have gone to judges (PR #75).
Workaround: `apps/expo/metro.config.js` folds the `EXPO_PUBLIC_*` values into `cacheVersion` (Metro hashes it into the
  transform key), and `scripts/build-apk.js` unzips the bundle after Gradle and fails if the hosted URL is missing or the
  fallback is present.
Suggestion: Expo should include inlined `EXPO_PUBLIC_*` values in its transform cache key, or say on the environment-variables
  page that changing them needs `--clear`; for Fire TV, a sideload or App Tester note that release bundles are cached
  across builds would help teams that build for the stick with Expo.
Environment: macOS, Expo SDK 54, React Native 0.81, Hermes, Fire TV Stick (AFTSS), 2026-10-15.
Links: https://docs.expo.dev/guides/environment-variables/ · https://metrobundler.dev/docs/configuration/#cacheversion ·
  https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html · PR #75
