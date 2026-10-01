# fire tv asleep react native video says current activity is null

Task attempted: Launch an RN app with react-native-video on a Fire TV Stick over adb for an unattended device test.
Steps:
  1. `adb connect <stick>:5555`.
  2. `adb shell am start -n <pkg>/.MainActivity`.
  3. The player mounts on the initial route.
Expected: The video plays, or an error that names the device state (asleep, display off).
Actual: react-native-video fails on every launch with EXO error 1001 `java.lang.Exception: Current Activity is null!` at
`ReactExoplayerView.initializePlayer` (ReactExoplayerView.java:671). `adb shell dumpsys activity` lists the Activity as
the ResumedActivity, but `adb shell dumpsys power` shows `mWakefulness=Asleep` with the display OFF. Two launches lost
(~5 min).
Cause: The Activity was started while the device was asleep, so the ReactContext had no current Activity when the
player initialised.
Severity: Medium — ~5 min lost; the error text points at the RN lifecycle, not device power, and it hits any unattended
or scripted device run.
Workaround: `adb shell input keyevent KEYCODE_WAKEUP`, then confirm `adb shell dumpsys power | grep mWakefulness`
reports `Awake` before `am start`.
Suggestion: The Fire TV "Connect to Fire TV Through ADB" and "Install and Run Your App" pages (neither mentions sleep or
wake today) should note that a sleeping device must be woken (`KEYCODE_WAKEUP`) before `am start`. react-native-video
could add a hint to the Activity-null error ("is the device asleep or the app in the background?").
Environment: Apple Silicon Mac, Darwin 25.2 (macOS 26); Fire TV Stick model AFTSS, Fire OS 7.7.1.6 (Android 9, API 28);
react-native-video 6.x (androidx.media3 1.8.0). Observed 2026-10-01.
Links: https://developer.amazon.com/docs/fire-tv/connecting-adb-to-device.html,
https://developer.amazon.com/docs/fire-tv/installing-and-running-your-app.html
