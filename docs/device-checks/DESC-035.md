# DESC-035 device check — captions follow Fire TV caption settings; VoiceView

Run on the stick (AFTSS, Fire OS 7) with a **release** build. Integrations 3 and 4 in the README stay **pending** until
§1 and §2 pass. Background: docs/platform/fire-os-bindings.md §5 (captions) and §6 (VoiceView). Tick each box; write
what you actually saw where it differs; failures go to a friction log (`pnpm friction "<title>"`).

## 0. Build

- [ ] On the Mac, API running with Sintel published (DESC-005 §0).
- [ ] `cd apps/expo && npx expo prebuild -p android --clean` (this ticket adds the `described-captioning` module), then
      `git checkout package.json` (prebuild rewrites it).
- [ ] `EXPO_PUBLIC_API_URL=http://<mac-ip>:4000 npx expo run:android --variant release` succeeds.
      If it fails in `:described-captioning`, add `"expo": { "autolinking": { "exclude": ["described-captioning"] } }`
      to apps/expo/package.json, rebuild (captions then keep the app's look), file a friction log with the error.
- [ ] `npx expo-modules-autolinking resolve -p android | grep DescribedCaptioningModule` prints the module.
- [ ] Second terminal: `adb logcat -c && adb logcat -s DescribedCaptioning:V ReactNativeJS:V`

## 1. Captions follow the Fire TV caption style

- [ ] In the app: Settings → set "Caption style" to **Match Fire TV** (the default for new profiles; an existing profile
      keeps Box or Shadow until you change it). "Caption size" is 100 %.
- [ ] Home on the remote → Fire TV **Settings › Accessibility › Captions** (on some builds: Settings › Accessibility ›
      Closed Captioning). Turn **Captions On**. Set, writing down the menu names you used:
      - text size: **Large** (or the largest offered),
      - text colour: **Yellow**,
      - background colour: **Blue**, background opacity **100 %**,
      - font: **Serif** if offered.
- [ ] Logcat shows `DescribedCaptioning: change=…` lines while you change them (only while the app is running — open
      Described first and switch with Home if you want to see them live). Note `enabled=true`, `fontScale`, the colours.
- [ ] Open Described → Sintel → Captions: Rich captions → Play. Wait for a caption.
      Expected: yellow text on a blue box, larger than before, in a serif face.
- [ ] Screencap with a caption on screen:
      `adb exec-out screencap -p > docs/screens/captions-system-style.png`
      (if it is black — friction 2026-09-26 — photograph the TV instead and save it under the same name).
- [ ] **Live change:** while the film plays, Home → Fire TV caption settings → text colour **White**, background
      **Black** → back to Described (resume). The next caption is white on black without restarting the film.
- [ ] **Contrast floor:** set text colour **White** and background **White** (or the closest pair offered). Captions are
      still readable: dark text on the white box. Note what you saw.
- [ ] **Size in the app scales Fire TV's:** Described Settings → Caption size 150 % → play: captions larger again (the cap is 200 %).
- [ ] **App choice wins:** Settings → Caption style **Box** → play: the app's own dark translucent box, white
      Atkinson Hyperlegible text, whatever Fire TV says. Back to **Match Fire TV**.
- [ ] **Captions off in Fire TV:** Fire TV Captions **Off** → play: the app's own Box (Match Fire TV falls back), and
      captions are still shown (Rich captions is the app default; Fire TV's switch does not turn the app's captions off).
- [ ] Put Fire TV caption settings back as they were.

## 2. VoiceView

- [ ] Turn VoiceView on: hold **Back + Menu** for 2 s (or Settings › Accessibility › VoiceView › On).
- [ ] `adb logcat -c`
- [ ] Launch Described. On **Home**, listen: "Sintel. <synopsis>. Play Sintel with audio description".
      ▼ into a row: "Newly described. Open Sintel. 2010. <N> minutes. Audio description. Left and right move along the row".
      ► once: only "Open Tears of Steel…" (the row hint is not repeated).
- [ ] Select on a card → **Title**: "Sintel. 2010. … Play Sintel with audio description".
- [ ] Select → **Player** starts. Note what is spoken.
- [ ] Capture the accessibility log and a screencap:
      ```sh
      adb logcat -d | grep -i -E "voiceview|accessibility|announce" > docs/screens/voiceview-logcat.txt
      adb exec-out screencap -p > docs/screens/voiceview-player.png
      ```
      If the grep is empty, keep `adb logcat -d > /tmp/full.txt` and search it for the spoken strings
      (`grep -n "Play Sintel" /tmp/full.txt`); commit the matching lines instead and note the tag they came under.
- [ ] Settings → Caption style: "Caption style: Match Fire TV. Match Fire TV follows the caption style in Fire TV
      Settings, Accessibility, Captions. Press left or right to change".
- [ ] Turn VoiceView off (Back + Menu, 2 s). For the full pass, run docs/a11y/voiceview-checklist.md.

## 3. Wrap up

- [ ] Commit `docs/screens/captions-system-style.png`, `docs/screens/voiceview-player.png`,
      `docs/screens/voiceview-logcat.txt`, and this file with the boxes ticked.
- [ ] If both sections passed: in README.md and docs/submission.md change integrations 3 and 4 from **pending** to
      **verified on the stick (<date>)** and link the files above.
