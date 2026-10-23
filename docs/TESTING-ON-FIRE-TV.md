# Testing Described on a Fire TV stick

A manual for two readers:

- **(a) a person** with a Fire TV Stick or Cube who has never sideloaded an app (sections 1–7), and
- **(b) an AI coding agent** with a shell on a computer on the same network as the stick (section 8, plus the checks in 5).

Everything here was checked on the project's Fire TV Stick (AFTSS, Fire OS 7.7.1.6) during earlier device runs
([docs/device-checks/RUN-2026-10.md](device-checks/RUN-2026-10.md)), or on an Android TV emulator (API 31) with the
v0.1.1 APK on 2026-10-23. Anything not yet seen on a stick is marked **(not yet verified on a stick)**.
Amazon's own pages are linked where a step comes from them.

Remote buttons are written in bold: **Select** (the centre of the ring), **Back**, **Home**, **Menu** (☰),
**Play/Pause**, ▲ ▼ ◄ ► (the ring), and **mic** (the microphone / Alexa button).

---

## 1. What you need

- A Fire TV Stick, Stick 4K / 4K Max, Stick Lite or Fire TV Cube running **Fire OS 7 or 8**, or Fire OS 6 (should install: the APK needs API 24 and Fire OS 6 is API 25; not yet verified on a stick),
  its remote, and a TV. Section 2 shows how to check the OS.
- Wi-Fi with internet. The app talks to a hosted copy of the Described API over HTTPS and streams from CloudFront, so
  nothing else on your network is needed. The hosted API stays up until 20 Nov 2026 (the end of judging).
- Optional: a computer (macOS, Windows or Linux) on the **same Wi-Fi**, with Android platform tools (`adb`) installed —
  only for install path B and for section 8.
- Optional: a phone to photograph or film the TV. Screenshots taken with `adb` come out black on the stick (section 7).
- **Time:** install 10–20 minutes the first time; the checklist in section 5 takes about 60–90 minutes.

## 2. Check your device can run it

Described is an Android app (an APK). Fire TV devices run either **Fire OS** (Android-based; can install APKs) or
**Vega OS** (not Android; cannot install APKs at all).

1. On the TV: **Home** → **Settings** (gear) → **My Fire TV** (on some versions **Device & Software** or **Device**) → **About**.
2. Note the device name at the top and the software version.
3. Compare with Amazon's device table ([Fire TV streaming media player specifications](https://developer.amazon.com/docs/device-specs/device-specifications-fire-tv-streaming-media-player.html),
   read 2026-10-23):

| Device | Model code | OS | Runs Described? |
|---|---|---|---|
| Fire TV Stick 4K Select (2025) | AFTCA002 | Vega OS 1.1 | **No** |
| Fire TV Stick HD (2026) | AFTCL001 | Vega OS 1.1 | **No** |
| Fire TV Stick 4K – 3rd Gen (2026) | AFTCR001 | Vega OS 2.0 | **No** |
| Fire TV Stick 4K Plus (2025) | AFTMA08C15 | Fire OS 8 | Yes (not yet verified on a stick) |
| Fire TV Stick 4K Max – 2nd Gen (2023) | AFTKRT | Fire OS 8 | Yes (not yet verified on a stick) |
| Fire TV Stick 4K – 2nd Gen (2023) | AFTKM | Fire OS 8 | Yes (not yet verified on a stick) |
| Fire TV Stick HD (2024), Fire TV Stick Lite (2020) | AFTSS | Fire OS 7 | **Yes — the stick this project tests on** |
| Fire TV Stick 4K Max – 1st Gen (2021) | AFTKA | Fire OS 7 | Yes (not yet verified on a stick) |
| Fire TV Stick – 3rd Gen (2020) | AFTSSS | Fire OS 7 | Yes (not yet verified on a stick) |
| Fire TV Stick 4K – 1st Gen (2018) | AFTMM | Fire OS 6 | Should install: minSdk 24 ≤ API 25 (not yet verified on a stick) |

Fire TV Cubes run Fire OS; they are on a separate Amazon page and have not been tried (not yet verified on a stick).
Fire OS versions map to Android as: Fire OS 6 = Android 7.1 (API 25), Fire OS 7 = Android 9 (API 28), Fire OS 8 =
Android 10/11 (API 29/30) ([Fire OS overview](https://developer.amazon.com/docs/fire-tv/fire-os-overview.html)).
The APK needs API 24 or later, so every Fire OS device in the table qualifies.

**Vega OS:** if your device is one of the three Vega models, stop here — Vega has no "unknown sources" setting and runs
no Android apps ([AFTVnews on Vega OS and sideloading](https://www.aftvnews.com/tag/vega-os/page/2/), third-party
reporting). If you have a computer, `adb shell getprop ro.product.model` prints the model code (section 8).

## 3. Install

The release APK is on GitHub: <https://github.com/moiz-lakkadkutta/described/releases/latest>. Each release from v0.1.1
on carries the APK twice: as `described.apk` and as `described-<version>.apk` (the same file). The download address that
always gives the newest release is

```
https://github.com/moiz-lakkadkutta/described/releases/latest/download/described.apk
```

To pin one version, use its versioned file. v0.1.1 (sha256 `ab73e20547fe809e5b0cdb24851033bc162c70006832f0f0ad66680e01f33f9d`):

```
https://github.com/moiz-lakkadkutta/described/releases/download/v0.1.1/described-0.1.1.apk
```

v0.1.0 (`releases/download/v0.1.0/described-0.1.0.apk`) is older and has no privacy line in About & licenses.
To check a file on a computer: `shasum -a 256 <file>` and compare with the sha256 above or in the release notes.

### Path A — without a computer (Downloader)

Downloader is a free app by AFTVnews in the Amazon Appstore. The menu names below come from AFTVnews's guide
([sideload with Downloader](https://www.aftvnews.com/sideload-apk-app-amazon-fire-tv-stick-cube-edition-firestick-downloader/))
and Amazon's ADB page; this path has not been walked end to end with Described (not yet verified on a stick).

1. **Home** → search (magnifier) → type **Downloader** → install the orange Downloader app by AFTVnews.
2. Turn on Developer options if you do not see them: **Settings → My Fire TV → About**, highlight the device name (on
   some versions it reads "Your TV") and press **Select** 7 times. A message says you are now a developer
   ([Amazon: Connect to Fire TV through ADB](https://developer.amazon.com/docs/fire-tv/connecting-adb-to-device.html)).
   On older versions **Developer options** is already in **My Fire TV**.
3. **Settings → My Fire TV → Developer options**:
   - Fire OS 7 and 8: **Install unknown apps** → **Downloader** → **On**.
   - Fire OS 6: **Apps from Unknown Sources** → **On**.
   If Downloader is missing from the list, restart the stick, open Settings, wait a minute and look again — AFTVnews
   reports a Fire OS bug where the list renders before it has loaded
   ([AFTVnews](https://www.aftvnews.com/fire-tv-bug-is-preventing-downloader-and-other-apps-from-appearing-in-the-install-unknown-apps-list/)).
4. Open **Downloader**. Allow it to access files if it asks. In the address box type the full download address from
   above (`https://github.com/moiz-lakkadkutta/described/releases/latest/download/described.apk`),
   then **Go**.
5. When the download finishes, Android's installer opens: **Install**. Then **Done** (or **Open**).
6. Downloader offers to delete the APK file: **Delete** frees about 60 MB; the app stays installed.

### Path B — with a computer (adb)

1. On the TV, turn on Developer options (Path A step 2), then **Developer options → ADB debugging → On**
   ([Amazon](https://developer.amazon.com/docs/fire-tv/connecting-adb-to-device.html)). On Fire OS 6 also turn on
   **Apps from Unknown Sources**.
2. Find the stick's IP address under **Settings → My Fire TV → About → Network**. Amazon notes it is **not** under
   Settings → Network.
3. On the computer, download the APK (address above), then:

   ```sh
   adb connect <stick-ip>:5555        # prints: connected to <stick-ip>:5555
   ```

4. On the TV, **Allow USB debugging?** appears the first time: tick **Always allow from this computer**, then **OK**.
5. Install and open it:

   ```sh
   adb devices                         # the stick is listed as "device", not "unauthorized"
   adb install -r described-0.1.1.apk  # prints: Performing Streamed Install / Success
   adb shell monkey -p dev.moizp.described 1
   ```

macOS 15 or later: if `adb connect` says **No route to host** while `ping <stick-ip>` works, give your terminal app
**Local Network** permission (System Settings → Privacy & Security → Local Network), quit and reopen the terminal, then
`adb kill-server` and connect again ([friction note](friction/2026-09-26-adb-macos-local-network.md)).

### Opening it

The app appears as **Described** in **Your Apps & Channels** (Home → the apps row → **See all**). It has a 16:9 banner
with the Described logo. Highlight it and press **Menu** → **Move** if you want it on the first row.

### Updating from an older version

Install the newer APK the same way (Downloader, or `adb install -r`). v0.1.0 and v0.1.1 are signed with the same key,
so v0.1.1 installs over v0.1.0 and keeps your settings, My list and resume points (checked on the emulator, 2026-10-23).
If Android says **App not installed**, the two files were signed with different keys: uninstall first (below), then
install. Your settings, My list and resume points live on the server under the device's Android ID, and from Android 8
(API 26, so every Fire OS 7 and 8 device) that ID depends on the key the app is signed with
([apps/expo/src/deviceId.ts](../apps/expo/src/deviceId.ts)). An uninstall and reinstall of a copy signed with the **same**
key keeps the same ID, so they come back. A copy signed with a **different** key (the Amazon Appstore copy, or a local
debug build made with another keystore) gets a new ID and starts with a fresh profile: settings, My list and resume points
do not carry over.

### Uninstalling

**Settings → Applications → Manage Installed Applications → Described → Uninstall**, or `adb uninstall dev.moizp.described`.
To also remove the stick's settings, My list and resume points from the server, see [docs/privacy.md](privacy.md#delete-your-data).

## 4. First run: what you should see

1. **Introduction** (three panels, focus on the button):
   - "Described plays every film with audio description." / "It's on now." → **Next**.
   - "Press Menu while watching to change voice, captions or turn it off." → **Next**.
   - "Extended mode pauses the film when there's a lot to describe." / "Keep it on?" → **Keep on** or **Turn off**.
   **Back** goes to the previous panel; **Back** twice on panel 1 skips the introduction.
   Each panel is also spoken in the Described voice.
2. **Home**: a dark blue-grey screen. A left rail with **H**ome, **D**escribed, **M**y list, **S**ettings. A large hero
   (the newest title: Sintel, with the **AD** badge) with **▶ Play with description**, **Play** and **My list**. Rows
   below: **Continue watching** (once you have watched something), **Newly described**, **All titles**. The focused item
   has a light outline and grows slightly.
3. **Title** (press **Select** on a card): poster, name, year and length, badges (**AD**, **RICH CAPTIONS**,
   **Extended: N pauses**), then **▶ Play with description**, **Play without description**, **Hear a sample** (on titles
   that have one), **Captions: … ▾**, **My list**, and the film's credit sentence.
4. **Player**: the film with the name top left, a progress bar, and a status line bottom left such as
   "Description on · Ruth · Rich captions". The name and bar hide after about 4 s; the status line stays.
5. **Track sheet** (press **Menu** while the film plays): **Audio & captions** — AUDIO: **Original**, **Audio description
   (Ruth)**; CAPTIONS: **Off**, **Captions**, **Rich captions**, **Description text**; at the foot **Extended mode · On/Off**.
6. **Settings** (rail → **S**): Description on by default, Voice, Hear it, Extended mode, Caption size, Caption style,
   Show the introduction again, About & licenses.
7. **About & licenses**: the films' credit sentences, FONT AND CODE licences, then (from v0.1.1) **PRIVACY** with
   "Privacy policy: github.com/moiz-lakkadkutta/described/blob/main/docs/privacy.md", then **Close**.

## 5. The checklist

Before you start: open the app once and finish the introduction. Note the version under
**Settings → Applications → Manage Installed Applications → Described** (or section 8).

The titles in the library (hosted `/catalog`, 2026-10-23):

| Card name | Slug | Length | Badges |
|---|---|---|---|
| Sintel | `sintel` | 15 min (14:48, the whole film) | AD, Rich captions, Extended: 18 pauses |
| Tears of Steel | `tears-of-steel-40-100` | 1 min | AD, Extended: 5 pauses |
| Caminandes: Gran Dillama | `caminandes-35-95` | 1 min | AD, Extended: 1 pause |
| Elephants Dream | `elephants-dream-0-60` | 1 min | AD, Extended: 1 pause |
| Big Buck Bunny | `big-buck-bunny-0-60` | 1 min | AD |
| Sintel | `sintel-90-150-r2` | 1 min (1:30–2:30 of the film) | AD, Rich captions, Extended: 1 pause |

There are two cards called **Sintel**: tell them apart by the length under the card (15 min or 1 min). Details per
title: [docs/titles.md](titles.md).

Write **PASS**, **FAIL** or **SKIP** and a note for each check. Who can check it: **H** = a person watching or
listening, **A** = an agent with adb alone, **H+A** = an agent drives and logs, a person confirms what is seen or heard.

| # | Check | Steps | Expected | Who | Result / notes |
|---|---|---|---|---|---|
| 1 | Install, banner, icon | Install (section 3). **Home** → Your Apps & Channels. | **Described** is listed with its banner (logo on dark ground), not a blank tile or the Android robot. | H (A: install and version only) | |
| 2 | Catalogue loads | Open Described. | Within about 10 s Home shows the hero and the rows with poster art. No "Can't reach the library" screen. | H+A | |
| 3 | Playback | Hero → **▶ Play with description** (full Sintel). Watch 30 s. | Picture moves smoothly, sound plays, the description voice speaks over the film between lines of dialogue; status reads "Description on · Ruth · …". | H | |
| 4 | Seek and pause | In the film: **Select**, then **Play/Pause**; ► once; ◄ three quick presses. | **Select** and **Play/Pause** each pause and play. ► jumps +10 s; three quick ◄ make one −30 s jump. | H | |
| 5 | Described audio track (app's sheet) | While the voice speaks, **Menu** → ▲ ▼ to **Original** → **Select**. Then **Audio description (Ruth)** → **Select**. **Back** closes the sheet. | Original: no voice, status "Description off · …". Audio description: voice again, "Description on · Ruth · …". A short fade, no picture freeze, no "Loading…". The app writes nothing to the log on a switch — this needs a person listening. | H | |
| 6 | Description is a real audio track | With **Audio description** on, change the volume with the TV's or soundbar's own control. | The voice and the film get louder and quieter together: the narration is mixed into the stream's second audio track (the film's sound dips under the voice), not played as a separate app sound. Whether any Fire TV system menu outside the app offers this track: (not yet verified on a stick). | H | |
| 7 | Rich captions, full Sintel | Open the **15 min** Sintel → **Captions** until it reads **Rich captions** → Play with description. ► to about 3:15 and watch to 5:40. | Captions in a dark box at the bottom, at most two lines. **[creature roars]** at about 3:23 and **[woman gasps]** at about 5:33. | H | |
| 8 | Rich captions, 1-minute Sintel | Open the **1 min** Sintel, Rich captions, play from the start. | **[fire crackling]** at about 0:11 and **[broth pours]** at about 0:30. | H | |
| 9 | Caption kinds | In the film, **Menu** → **Off**, **Captions**, **Description text** in turn. | Off: no captions. Captions: dialogue only, no [sounds]. Description text: the description shown as text. The status line ends with the choice. | H | |
| 10 | Extended mode | Settings → **Extended mode: On**. Open **Tears of Steel** (badge "Extended: 5 pauses") → Play with description from 0:00. | Before the film starts, the picture holds and a **Describing…** bar shows while the voice reads a long description; then the film plays on by itself. More pauses at about 0:08, 0:17, 0:42 and 0:59. Each time the film resumes without a key press. | H+A (log lines in 8.6) | |
| 11 | Extended mode off | **Menu** → **Extended mode** → Off, ◄ back to 0:00. | No pauses; the film never holds. | H | |
| 12 | Hear a sample | Open **Tears of Steel** → **Hear a sample**. | A short description plays in the voice over the poster (about 20 s at most); the button reads **Stop the sample**; **Select** again stops it. | H | |
| 13 | My list | Title → **My list** → **Select**. Rail → **M**. Force-close and reopen the app, open My list again. | A teal ring and ✓ on the button. The title is first in My list, and still there after reopening. **Select** again removes it. | H | |
| 14 | Resume | Play a title to about 5 minutes (full Sintel), **Back**, **Back** to Home. | **Continue watching** shows it. Play continues at about the same point. (A point in the last 30 s of a film starts over, by design.) | H | |
| 15 | Settings are kept | Settings → **Caption size** 150 %, **Voice** another voice → **Hear it**. Force-close (section 8, or **Settings → Applications → … → Force stop**) and reopen. | Hear it plays one sentence in the new voice. After reopening both values are still set. Put them back. | H | |
| 16 | About & privacy | Settings → **About & licenses** → ▼ to the end. | Credit sentences for each film, the font and code licences, **PRIVACY** with "Privacy policy: github.com/moiz-lakkadkutta/described/blob/main/docs/privacy.md", then **Close**. **Back** returns to Settings. | H | |
| 17 | Back never traps | From the track sheet press **Back** repeatedly. | Sheet → Player → Title → Home → the Fire TV home screen. Never stuck, never closes from the Player directly. | H+A | |
| 18 | Home exits | While a film plays, press **Home**. | Fire TV home appears within 2 s and the film's sound stops at once. Reopening Described returns where you were. | H (A: foreground app only) | |
| 19 | Voice commands | While a film plays on screen, hold **mic** and say "pause"; then "resume", "fast forward", "rewind", "restart". No wake word needed. | Pause and resume act once each; fast forward / rewind jump about 10 s; restart goes to 0:00. (not yet verified on a stick with v0.1.0 or later — the permission fix for this shipped in v0.1.0, and the last stick run, before it, failed: [RUN-2026-10 §14](device-checks/RUN-2026-10.md).) | H+A | |
| 20 | VoiceView | Hold **Back** + **Menu** for 2 s to turn VoiceView on; follow [docs/a11y/voiceview-checklist.md](a11y/voiceview-checklist.md). Turn it off the same way. | Every item is read with its purpose ("Play Sintel with audio description"), nothing is read as just "button". | H | |
| 21 | Offline | Disconnect the internet (unplug the router's internet cable or turn off the phone hotspot the stick uses). Force-close and reopen Described. Then reconnect and press **Select**. | Within about 10 s: "Can't reach the library. Check the network and press Select to retry." with **Try again**. After reconnecting, **Select** loads Home. | H | |
| 22 | No crash | During the whole run. | The app never closes by itself, never shows "Described isn't responding" or "has stopped". | H+A | |

## 6. Results template

Copy this into a new issue at <https://github.com/moiz-lakkadkutta/described/issues>:

```markdown
### Fire TV test run — Described <version>

- Device: <name from About> (<model code>), Fire OS <version>
- Installed with: Downloader / adb; updated over an older version: yes / no
- Date, time zone:
- Tester: person / agent + person

| # | Check | Result | Notes |
|---|---|---|---|
| 1 | Install, banner, icon | | |
| 2 | Catalogue loads | | |
| 3 | Playback | | |
| 4 | Seek and pause | | |
| 5 | Described audio track | | |
| 6 | Description is a real audio track | | |
| 7 | Rich captions, full Sintel | | |
| 8 | Rich captions, 1-minute Sintel | | |
| 9 | Caption kinds | | |
| 10 | Extended mode | | |
| 11 | Extended mode off | | |
| 12 | Hear a sample | | |
| 13 | My list | | |
| 14 | Resume | | |
| 15 | Settings are kept | | |
| 16 | About & privacy | | |
| 17 | Back never traps | | |
| 18 | Home exits | | |
| 19 | Voice commands | | |
| 20 | VoiceView | | |
| 21 | Offline | | |
| 22 | No crash | | |

For every FAIL: what you did, what you saw or heard, and a phone photo or video. Agents: attach the saved log
(section 8.6) and the lines around the failure.
```

## 7. Troubleshooting

| Problem | What to do |
|---|---|
| `adb devices` shows **unauthorized** | The TV is waiting for **Allow USB debugging?** — accept it with **Always allow from this computer**. If no prompt shows: `adb disconnect`, `adb kill-server`, connect again. |
| `adb devices` shows **offline**, or `adb connect` says **Connection refused** after the stick slept | Wake it (press a remote button, or `adb shell input keyevent KEYCODE_WAKEUP` if still connected), check **ADB debugging** is still on, then `adb disconnect <ip>:5555 && adb connect <ip>:5555`. The IP can change after a router restart — check **About → Network** again. Amazon's own advice for connection errors is to restart the Fire TV ([Amazon](https://developer.amazon.com/docs/fire-tv/connecting-adb-to-device.html)). |
| macOS: **No route to host** while `ping` works | Local Network permission for your terminal (section 3, Path B). |
| Video fails right after a scripted launch, log says `Current Activity is null!` | The stick was asleep. Wake it and check `adb shell dumpsys power \| grep mWakefulness` says `Awake` before launching ([friction note](friction/2026-10-01-fire-tv-asleep-react-native-video-says-current-activity-is-null.md)). |
| **App not installed** / `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | The installed copy was signed with another key (for example an Appstore copy or a local debug build). Uninstall it first (section 3), then install. |
| Downloader is missing from **Install unknown apps** | Restart the stick, open Settings, wait a minute, look again (section 3, Path A step 3). |
| Home is empty or shows "Can't reach the library" | Check the stick's internet. On a computer: `curl -s https://3ujym5cqm72ttey4wrttjqwszy0yfmdk.lambda-url.us-east-1.on.aws/health` must print `{"success":true,"data":{"ok":true,"service":"described-api","mode":"viewer"}}`. If it does not, the hosted API is down — report it. After 20 Nov 2026 it may be shut down on purpose. |
| `adb exec-out screencap -p` gives an all-black PNG | Expected on the stick ([friction note](friction/2026-09-26-adb-screencap-black.md)). Photograph the TV with a phone. |
| No narration on **Audio description** | Check the status line says "Description on". Narration only plays between lines of dialogue, so wait 10–20 s; the full Sintel has description from the first seconds. Check the TV or soundbar is not muted and that **Original** gives sound. If Original has sound and Audio description has none, report it with the time in the film. |
| A run's log is gone | The default log buffer is 256 KB and rotates within minutes. Set `adb logcat -G 16M` (lost on every reboot) and clear it before each run (section 8.6). |

## 8. For AI agents

A deterministic runbook. Run each command, compare with the **expected** text, and stop on a mismatch.

### 8.0 Rules

- Never factory reset. Never uninstall any app other than `dev.moizp.described`. Never change system settings beyond what
  this manual says (Developer options, ADB debugging, unknown apps).
- **Ask the person before rebooting** the stick, and before uninstalling Described (it deletes local data).
- Address the stick explicitly with `-s <stick-ip>:5555` on every adb command when more than one device is attached
  (an emulator counts). Below, `adb` means `adb -s $FTV` with `FTV=<stick-ip>:5555`.
- Do not take screenshots as evidence: `screencap` is black on the stick. Ask the person (8.8).
- Keep Described in the foreground until the log is saved; otherwise Android may kill it and the log changes.

### 8.1 Connect

```sh
FTV=<stick-ip>:5555
adb connect $FTV
```

Expected: `connected to <stick-ip>:5555` (or `already connected to …`). On a first connection, ask the person to accept
**Allow USB debugging?** on the TV with **Always allow from this computer**.

```sh
adb devices
```

Expected: a line `<stick-ip>:5555	device`. `unauthorized` → ask the person to accept the prompt; `offline` → section 7.
macOS `No route to host` → ask the person to grant Local Network permission to the terminal (section 3).

### 8.2 Identify the device

```sh
adb -s $FTV shell getprop ro.product.model          # model code, e.g. AFTSS — compare with the table in section 2
adb -s $FTV shell getprop ro.build.version.release  # Android version: 9 on Fire OS 7, 7.1.x on Fire OS 6
adb -s $FTV shell getprop ro.build.version.sdk      # API level: 28 on Fire OS 7
adb -s $FTV shell getprop ro.build.version.name     # Fire OS name and build (not yet verified on a stick)
adb -s $FTV shell pm list features | grep amazon.hardware.fire_tv   # feature:amazon.hardware.fire_tv
```

`amazon.hardware.fire_tv` identifies any Fire TV ([Amazon: Identify Fire TV devices](https://developer.amazon.com/docs/device-specs/identify-fire-tv-devices.html)).
If `ro.product.model` is AFTCA002, AFTCL001 or AFTCR001 (Vega OS), stop: the APK cannot run there.

### 8.3 Install and verify

```sh
curl -sL -o described.apk https://github.com/moiz-lakkadkutta/described/releases/latest/download/described.apk
#   pinned alternative: https://github.com/moiz-lakkadkutta/described/releases/download/v0.1.1/described-0.1.1.apk
shasum -a 256 described.apk   # v0.1.1: ab73e20547fe809e5b0cdb24851033bc162c70006832f0f0ad66680e01f33f9d
adb -s $FTV install -r described.apk
```

Expected: `Performing Streamed Install` then `Success`. `INSTALL_FAILED_UPDATE_INCOMPATIBLE` → a copy signed with another
key is installed: ask the person before `adb -s $FTV uninstall dev.moizp.described`.

```sh
adb -s $FTV shell pm list packages | grep described                       # package:dev.moizp.described
adb -s $FTV shell dumpsys package dev.moizp.described | grep -E 'versionName|versionCode'
#     versionCode=2 minSdk=24 targetSdk=36
#     versionName=0.1.1
adb -s $FTV shell dumpsys package dev.moizp.described | grep voicecommandcontrol
#       com.amazon.permission.media.session.voicecommandcontrol    (needed for voice commands, check 19)
```

### 8.4 Wake, launch, see what is in front

```sh
adb -s $FTV shell input keyevent KEYCODE_WAKEUP
adb -s $FTV shell dumpsys power | grep mWakefulness                     # mWakefulness=Awake
adb -s $FTV shell am force-stop dev.moizp.described
adb -s $FTV shell monkey -p dev.moizp.described -c android.intent.category.LEANBACK_LAUNCHER 1
#   … Events injected: 1          (plain `monkey -p dev.moizp.described 1` works too)
adb -s $FTV shell am start -n dev.moizp.described/.MainActivity          # the form Amazon documents
adb -s $FTV shell dumpsys activity activities | grep mResumedActivity
#   mResumedActivity: ActivityRecord{… u0 dev.moizp.described/.MainActivity t…}
adb -s $FTV shell pidof dev.moizp.described                              # a process id
```

Both `monkey` forms and the `mResumedActivity` output were checked on the Android TV emulator with v0.1.1; `am start -n`
is from [Amazon: Install and run your app](https://developer.amazon.com/docs/fire-tv/installing-and-running-your-app.html).
When the Fire TV home screen is in front, `mResumedActivity` names Amazon's launcher instead (package name on the stick
not yet verified on a stick).

Deep links open a title or play it from a time (seconds):

```sh
adb -s $FTV shell am start -a android.intent.action.VIEW -d 'described://title/tears-of-steel-40-100'
adb -s $FTV shell am start -a android.intent.action.VIEW -d 'described://play/sintel?t=200'
```

### 8.5 Drive the UI

`adb -s $FTV shell input keyevent <code>` — give the app about 0.5 s between keys.

| Remote | Key | Code |
|---|---|---|
| ▲ | `KEYCODE_DPAD_UP` | 19 |
| ▼ | `KEYCODE_DPAD_DOWN` | 20 |
| ◄ | `KEYCODE_DPAD_LEFT` | 21 |
| ► | `KEYCODE_DPAD_RIGHT` | 22 |
| **Select** | `KEYCODE_DPAD_CENTER` | 23 |
| **Back** | `KEYCODE_BACK` | 4 |
| **Home** | `KEYCODE_HOME` | 3 |
| **Menu** | `KEYCODE_MENU` | 82 |
| **Play/Pause** | `KEYCODE_MEDIA_PLAY_PAUSE` | 85 |
| Play | `KEYCODE_MEDIA_PLAY` | 126 |
| Pause | `KEYCODE_MEDIA_PAUSE` | 127 |
| Fast forward | `KEYCODE_MEDIA_FAST_FORWARD` | 90 |
| Rewind | `KEYCODE_MEDIA_REWIND` | 89 |
| Wake | `KEYCODE_WAKEUP` | 224 |

Paths that were checked on the emulator with v0.1.1 (start: Home, focus on the hero's **Play with description**):

- Settings: 21, 20, 20, 20, 23 (◄ opens the rail, ▼ three times to **S**, **Select**).
- About & licenses from Settings: 20 ×7, 23. The privacy line is the last line before **Close**.
- From About back to Home: 4, 21, 19 ×3, 23.
- Play the hero title without description: 22, 23. With description: 23.
- Track sheet in the Player: 82; ▼ moves; 23 chooses; 4 closes.

There is no way to read the screen back on the stick, so after each path ask the person to confirm what is shown (8.8),
or rely on the log lines below.

### 8.6 Logs

Before each run (the buffer size is lost on every reboot):

```sh
adb -s $FTV logcat -G 16M
adb -s $FTV logcat -c
```

Right after the run, while Described is still in front:

```sh
adb -s $FTV logcat -d -v time > run-$(date +%Y%m%d-%H%M).log
```

Fire OS drops debug (`D`) lines, so only Info and above are there
([friction note](friction/2026-10-10-fire-os-drops-log-d.md)). What to grep for:

| Pattern | Meaning |
|---|---|
| `FATAL EXCEPTION` with `dev.moizp.described` nearby | Crash. Always a FAIL. |
| `ANR in dev.moizp.described` | The app stopped responding. FAIL. |
| `ReactNativeJS.*\[described\] launch <url> → <target>` | A deep link or launch intent was handled. |
| `ReactNativeJS.*\[described\] extended pause requested d<n> start=… pos=…` | Extended mode paused the film for cue d<n> (check 10). |
| `ReactNativeJS.*\[described\] extended clip playing <url>` | The long description clip started. |
| `ReactNativeJS.*\[described\] extended paused (kit state)` | The player confirmed the pause. |
| `DescribedMediaSession: session created` / `session active: <title>` | Playback started; Fire TV's media session is live. |
| `DescribedMediaSession: now playing: <title> playing at <s>s` (or `paused at`) | Play/pause state; after an Extended pause a `playing` line shows the film resumed. |
| `DescribedMediaSession: transport control=<pause\|play\|seekTo…>` | A voice or media-key command reached the app (check 19). |
| `OrchestratingCommandExecutor: No target session, trying button press` | Fire TV's voice controller did not target the app: check 19 FAIL ([friction note](friction/2026-10-19-fire-tv-voice-falls-back-to-key-injection-without-voicecommandcontrol-permission.md)). |
| `DescribedMediaSession: session inactive (activity stopped)` | The app went to the background (expected after **Home**). |
| `DescribedCaptioning: change=…` | Fire TV caption settings changed while the app ran. |
| `AudioService.*Audio Settings Permission Denial: setMode()` / `setSpeakerphoneOn()` | Expected from v0.1.1 (the app no longer asks for `MODIFY_AUDIO_SETTINGS`; the player's call is ignored). Not a failure. |

Not in the log at all: **switching the audio track** (Original ↔ Audio description) and what the narration sounds
like. Those need a person listening.

```sh
grep -E 'FATAL EXCEPTION|ANR in dev.moizp.described' run-*.log            # expected: no output
grep -E '\[described\]|DescribedMediaSession' run-*.log | cut -c1-200
```

### 8.7 The hosted API

```sh
API=https://3ujym5cqm72ttey4wrttjqwszy0yfmdk.lambda-url.us-east-1.on.aws
curl -s $API/health
#   {"success":true,"data":{"ok":true,"service":"described-api","mode":"viewer"}}
curl -s $API/catalog | python3 -c 'import json,sys; print([t["slug"] for t in json.load(sys.stdin)["data"]["all"]])'
#   ['sintel', 'tears-of-steel-40-100', 'caminandes-35-95', 'elephants-dream-0-60', 'big-buck-bunny-0-60', 'sintel-90-150-r2']
```

If `/health` fails, every check after 2 fails for that reason: stop and report it.

### 8.8 What an agent can check alone, and what to ask

| Check | Agent alone | Ask the person (exact question) |
|---|---|---|
| 1 Install | Yes: `Success`, `pm list packages`, `versionName` | "In Your Apps & Channels, does Described show a banner with the Described logo (not a blank or Android tile)?" |
| 2 Catalogue | Partly: `/health`, `/catalog`, no crash in the log | "Does Home show a large Sintel picture at the top and rows of film posters below?" |
| 3 Playback | Partly: `session active`, `now playing … playing` | "Is the picture moving smoothly, and do you hear a voice describing the scene between the dialogue?" |
| 4 Seek and pause | Partly: send 85 / 22 / 21, read `now playing … at <s>s` | "Did the film pause and play once per press, and jump forward about 10 seconds?" |
| 5 Audio track | No (nothing is logged) | "After choosing Original, has the describing voice stopped? After choosing Audio description, is it back? Did the picture freeze?" |
| 6 Real audio track | No | "With Audio description on, does the TV volume change the voice and the film together?" |
| 7–8 Rich captions | No | "At about 3:23 in the 15-minute Sintel, does a caption read [creature roars]?" / "In the 1-minute Sintel, do you see [fire crackling] at about 0:11?" |
| 9 Caption kinds | No | "With Captions, are there only spoken lines? With Description text, is the description shown as text?" |
| 10 Extended mode | Yes for the pause and resume: `extended pause requested d1`, `extended clip playing`, then `now playing … playing` | "Before Tears of Steel starts, does a 'Describing…' bar show while the voice speaks, and does the film then start on its own?" |
| 11 Extended off | Partly: no `extended pause requested` lines | "Does the film play without holding still?" |
| 12 Hear a sample | No | "After pressing Hear a sample, do you hear the voice, and does the button now say Stop the sample?" |
| 13 My list | No | "Is Tears of Steel (or the title you added) first in My list, and still there after reopening?" |
| 14 Resume | Partly: `now playing … at <s>s` on the second play | "Does Continue watching show the film, and does it continue near where you stopped?" |
| 15 Settings kept | No | "After reopening, is Caption size still 150 % and the voice still the one you chose?" |
| 16 About & privacy | No | "At the end of About & licenses, is there a PRIVACY heading with 'Privacy policy: github.com/moiz-lakkadkutta/described/blob/main/docs/privacy.md'?" |
| 17 Back | Yes: after 4 ×N, `mResumedActivity` is no longer `dev.moizp.described` and no crash | "Did each Back go one screen back, ending on the Fire TV home screen?" |
| 18 Home | Partly: after 3, `mResumedActivity` changes and `session inactive (activity stopped)` | "Did the Fire TV home screen appear within 2 seconds, and did the film's sound stop at once?" |
| 19 Voice | Partly: `transport control=` lines; no `No target session` | "Hold the mic button and say 'pause' — did the film pause? Then 'resume', 'fast forward', 'rewind', 'restart': what happened each time?" |
| 20 VoiceView | No (ask the person to follow the checklist) | "Is every item read with what it does, and is nothing read as just 'button'?" |
| 21 Offline | No (an agent must not change the network) | "With the internet disconnected, does Described say 'Can't reach the library…', and does Select load Home once it is back?" |
| 22 No crash | Yes: the grep in 8.6 | "Did the app ever close by itself or show 'isn't responding'?" |

When done, stop the log capture, save the file, and fill in the template in section 6.
