# expo port 8081 wrong bundle

Task attempted: Build and run the multi-TV sample's Expo app on a Fire TV Stick with `yarn dev:android`
(= `EXPO_TV=1 expo run:android`), while another project's Metro dev server was already running on port 8081.
Steps:
  1. In another window, a different React Native project's Metro was serving on port 8081.
  2. In `apps/expo-multi-tv`: `yarn dev:android` with the stick connected over adb.
  3. Expo printed "Port 8081 is running <other project> in another window … Input is required, but 'npx expo' is in
     non-interactive mode … Skipping dev server", then built, installed, set up `adb reverse` 8081→8081 and launched
     the app.
  4. Tried a deep link with `?url=…:8082` to point the app at a different bundler.
Expected: Either the command fails because the port is taken, or Expo starts the sample's own dev server on a free port
and the app on the TV loads the sample's JS bundle.
Actual: The app is a plain React Native debug build (not an expo-dev-client) that loads its bundle from
`localhost:8081`, which adb reverse forwarded to the OTHER project's Metro. The TV silently ran the other project's JS:
black screen, logcat full of that project's route warnings (onboarding/step-4) and AsyncStorage null errors. The deep
link with `?url=…:8082` was ignored. Nothing in the Expo output said the installed app would load a foreign bundle.
Cause: In non-interactive mode Expo skips starting a dev server when 8081 is occupied, but still wires
`adb reverse tcp:8081 tcp:8081` and launches the app; a non-dev-client debug build has no way to pick another bundler
URL, so it loads whatever is on 8081.
Severity: High — the failure is silent and misleading: the app appears broken (black screen) and the logs point at code
that isn't in the project, so the natural debugging path is the sample's own code.
Workaround:
  1. Start the sample's Metro on another port: `npx expo start --port 8082`.
  2. `adb reverse tcp:8081 tcp:8082`.
  3. Relaunch MainActivity on the stick.
  4. Re-apply the reverse after every stick reboot or adb/server restart.
Suggestion: In non-interactive mode Expo should fail (not skip) when the dev server port is taken, or pick a free port
AND wire `adb reverse` to it. The sample README should mention the port-8081 collision and the workaround above.
Environment: Apple Silicon Mac, Darwin 25.2 (macOS 26); Fire TV Stick model AFTSS, Fire OS 7.7.1.6 (Android 9, API 28);
AmazonAppDev/react-native-multi-tv-app-sample at 92c6f7c (apps/expo-multi-tv: Expo SDK 54, react-native-tvos 0.81,
react-native-video ^6.8). Observed 2026-09-26.
Links: https://github.com/AmazonAppDev/react-native-multi-tv-app-sample
