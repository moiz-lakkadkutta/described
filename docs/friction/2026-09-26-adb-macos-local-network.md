# adb macos local network

Task attempted: Connect ADB over the network to a Fire TV Stick from an Apple Silicon Mac, following Amazon's
"Connect to Fire TV through ADB" doc, as the first step of a Fire OS deploy.
Steps:
  1. On the Fire TV: Settings › My Fire TV › About › pressed the device name 7 times to enable Developer options.
  2. Developer options › ADB debugging: ON.
  3. Noted the stick's IP from About › Network (192.168.1.232).
  4. On the Mac: `adb connect 192.168.1.232:5555` (adb from the Homebrew cask `android-platform-tools`,
     `/opt/homebrew/bin/adb`).
  5. Restarted the adb server (`adb kill-server; adb start-server`) and retried: same result.
Expected: `connected to 192.168.1.232:5555`, then an "Allow USB debugging?" prompt on the TV.
Actual: `failed to connect to '192.168.1.232:5555': No route to host`. From the same Mac, at the same time,
`ping 192.168.1.232` succeeded, the ARP entry for the stick was present on en0, and `nc -z 192.168.1.232 5555`
succeeded. So the stick was reachable and listening; Apple-signed tools reached the LAN, third-party adb did not.
Cause: macOS Local Network privacy (introduced in macOS 15 Sequoia) blocks non-Apple binaries from contacting
local-network hosts unless the hosting app (Terminal / iTerm / IDE) has Local Network permission. The block surfaces
as a generic "No route to host", and in this case no permission prompt was shown.
Severity: Medium — blocks every first Fire OS deploy from a current Mac; ~20–30 min lost. The error message points at
the network, not at permissions, so the natural debugging path (Wi-Fi, IP, firewall, router isolation) is a dead end.
Workaround:
  1. System Settings › Privacy & Security › Local Network › enable the terminal app you run adb from.
  2. Quit and relaunch that terminal app (the permission is not picked up by running processes).
  3. `adb kill-server && adb connect <ip>:5555`.
  4. On the TV, accept "Allow USB debugging?" with "Always allow from this computer".
  5. `adb devices -l` now lists the stick.
Suggestion: Add a macOS note to the troubleshooting section of Amazon's ADB-connect doc: "`No route to host` on
macOS 15+ while `ping` works → grant Local Network permission to your terminal app in System Settings › Privacy &
Security › Local Network, then relaunch it." Ideally, any Amazon CLI or tooling that wraps adb should run a one-line
check (e.g. adb fails but a plain TCP probe to the same host:port succeeds) and print that hint instead of the raw
socket error.
Environment: Apple Silicon Mac, Darwin 25.2 (macOS 26); adb from Homebrew cask `android-platform-tools`; Fire TV Stick
model AFTSS, Fire OS 7.7.1.6 (Android 9, API 28); ADB over Wi-Fi on the same LAN. Observed 2026-09-26.
Links: https://developer.amazon.com/docs/fire-tv/connecting-adb-to-device.html
