# Described — Fire OS (Expo)

`pnpm expo` then press `a` with the stick connected (`adb connect <ip>`), or `pnpm --filter @described/expo build:tv` for an APK. Leanback launcher intent is set so the app shows on the Fire TV home.

The stick cannot reach `10.0.2.2`: set `EXPO_PUBLIC_API_URL=http://<mac-ip>:4000`. Remote keys reach react-tv-space-navigation through
react-native-keyevent (`plugins/withKeyEvent.js`); `metro.config.js` resolves the linked kit from source. Full check: docs/device-checks/DESC-005.md.

`newArchEnabled: false` in app.json is required by react-native-keyevent (old-architecture module); React Native 0.82 drops the
old architecture — see docs/friction/2026-10-01-react-native-keyevent-needs-the-old-architecture.md. Release builds allow cleartext HTTP
only to the host in `EXPO_PUBLIC_API_URL` (plugins/withLocalApi.js); debug builds allow it everywhere so Metro loads. After
changing the URL run `npx expo prebuild --clean`.
