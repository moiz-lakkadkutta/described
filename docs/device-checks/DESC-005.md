# DESC-005 device check — Home → Title → Play on the Fire TV Stick

Run on the stick (AFTSS, Fire OS 7). D-pad only after launch. Tick each box; anything that fails goes in a friction log
(`pnpm friction "<title>"`) or back to the ticket. DESC-005 stays open in TASKS.md until this passes.

## 0. Setup (Mac)

- [ ] Android SDK + JDK 17 installed, `adb` on PATH; stick: Settings → My Fire TV → Developer options → ADB debugging **on**.
- [ ] Nothing else on port 8081 (friction 2026-09-26 "expo port 8081 wrong bundle"): `lsof -i :8081` is empty.
- [ ] `pnpm install` at the repo root (the kit must be checked out at `../vega-media-kit`).
- [ ] API with the published Sintel row: `pnpm db:up && pnpm db:migrate`, `.env` has `CLOUDFRONT_DOMAIN=dco7qa0c4m1pw.cloudfront.net`, then `pnpm api`.
- [ ] `curl -s -H 'x-device-id: stick' http://localhost:4000/catalog` lists `sintel-90-210`.
- [ ] `curl -s http://localhost:4000/titles/sintel-90-210` has `"manifestUrl":"https://dco7qa0c4m1pw.cloudfront.net/published/sintel-90-210/master.m3u8"`.
- [ ] Mac LAN IP: `ipconfig getifaddr en0` → `<mac-ip>`. Stick IP: Settings → My Fire TV → About → Network → `<stick-ip>`.

## 1. Build and install

Release build first — the D-pad latency in friction 2026-09-26 was measured on a debug build only.

```sh
adb connect <stick-ip>:5555 && adb devices            # stick listed as "device"
cd apps/expo
EXPO_PUBLIC_API_URL=http://<mac-ip>:4000 npx expo run:android --variant release
```

- [ ] Build succeeds. `grep -c 'described:keyevent' android/app/src/main/java/dev/moizp/described/MainActivity.kt` prints `1`
      (key forwarding from `plugins/withKeyEvent.js`).
- [ ] App appears in the Fire TV "Your Apps" row as **Described** and opens.

Debug alternative (fast refresh): `EXPO_PUBLIC_API_URL=http://<mac-ip>:4000 pnpm expo`, then press `a`.

## 2. First launch

- [ ] Ground is the dark blue-grey, never black or white. No red error screen.
- [ ] First-run panels appear (new device profile): press **Select** three times → Home. (First run is DESC-009; only check it does not trap focus.)

## 3. Fonts

- [ ] Text is Atkinson Hyperlegible, not Roboto — compare with https://fonts.google.com/specimen/Atkinson+Hyperlegible
      (e.g. the capital **I** has top and bottom bars, unlike the lowercase **l**).
- [ ] Bold weights (title, row labels, buttons) look bold once — not doubled or smeared.
- [ ] Row labels are ALL CAPS with slight tracking; nothing else is all caps.

## 4. Home

- [ ] While loading (first launch, or relaunch with the API slow): grey skeleton hero and cards; when data arrives the cards appear **in the same places**.
- [ ] Initial focus: **▶ Play with description** in the hero, with a 4 px off-white outline a few px outside it and a slight grow (≈ 150 ms). Focus is never shown by colour alone.
- [ ] Hero: Sintel name (large bold), two lines of synopsis, AD badge (ochre, letters "AD"), poster on the right, dark scrim at the bottom.
- [ ] ► moves Play with description → Play → My list. Select on My list shows a teal inner ring + ✓ (selected); Select again removes it.
- [ ] ▼ to the rows: **Continue watching** only when something has > 30 s progress; then **Newly described**, **All titles**.
- [ ] Cards: 3 full cards + a sliver of a fourth; AD badge top-left; title + "year · N min" below. ► scrolls the row; focus outline is never clipped.
- [ ] Row memory: in **All titles** move ► to the 2nd card, ▲ to Newly described, ▼ back → lands on the 2nd card again.
- [ ] ◄ from the first card of any row (and from Play with description) opens the rail: it widens over the content (content does not move) and shows **Home, Described, My list, Settings**; Home has the teal ring + ✓.
- [ ] ► from the rail returns to the card you left. ▲/▼ move within the rail.
- [ ] Hold ► for 2 s: focus steps along the row without skipping wildly (D-pad gate 120 ms).
- [ ] Latency: `for i in 1 2 3 4; do adb shell input keyevent 22; sleep 0.4; done` on a row — focus keeps up (note the delay if each step lags > 0.3 s).

## 5. Title (Sintel)

- [ ] Select on a Sintel card opens Title. Initial focus: **▶ Play with description**.
- [ ] Left: poster 480×720 (at 1080p). Right: name, `<year> · <N> min ·` then **AD** (ochre), **RICH CAPTIONS**, **EXTENDED: N PAUSES** (only if the title has extended cues).
- [ ] Synopsis is cut at 4 lines; **More** (above the actions) opens a full-screen reading view at 36 px; **Close** or **Back** returns to Title with **More** focused.
- [ ] Actions top to bottom: Play with description · Play without description · Hear a sample (only if the title has a sample cue) · Captions: Rich captions ▾ · My list.
- [ ] **Hear a sample**: the description voice plays; five ochre bars move over the bottom of the poster with "Playing a sample"; the button reads **Stop the sample**; Select stops it. Leaving the screen stops it too.
- [ ] **Captions** cycles Off → Captions → Rich captions → Description text (value saved to `/me/prefs`).
- [ ] Attribution sentence at the bottom ("Sintel © Blender Foundation, CC-BY 3.0. Described by Described." or as stored).
- [ ] **Back** returns to Home with focus on the card you opened (focus memory).

## 6. Play — the done criterion

- [ ] Title → **▶ Play with description** → Player loads `https://dco7qa0c4m1pw.cloudfront.net/published/sintel-90-210/master.m3u8`.
- [ ] Audio description is selected: description narration is spoken over the film; status line reads `Description on · Joanna · …`.
- [ ] `adb logcat | grep -i -E 'ExoPlayer|Video'` shows no load error. **Back** returns to Title.
- [ ] Repeat with **Play without description**: no narration, status line `Description off`.

## 7. VoiceView

Turn on: Settings → Accessibility → VoiceView → On (or hold **Back + Menu** for 2 s).

- [ ] Each D-pad move speaks the focused element's label (the app announces it: spatial navigation moves its own focus, not Android's).
- [ ] Labels heard — Home: "Play Sintel with audio description", "Play Sintel without description", "Add Sintel to My list",
      "Open Sintel. <year>. <N> minutes. Audio description", rail "Go to Home" … "Go to Settings".
      Title: "Read the full synopsis of Sintel", "Play Sintel with audio description", "Play Sintel without description",
      "Hear a sample of the description voice for Sintel. Plays about 20 seconds over the poster", "Captions: Rich captions. Press to change captions",
      "Add Sintel to My list"; reading view "Close the synopsis".
- [ ] No element is read as just "button" with no purpose. Note anything VoiceView reads twice or skips (input for DESC-009).
- [ ] Turn VoiceView off again.

## 8. Offline

- [ ] Stop the API (Ctrl-C on `pnpm api`), then relaunch: `adb shell am force-stop dev.moizp.described && adb shell monkey -p dev.moizp.described 1`.
- [ ] Full screen: "Can’t reach the library. Check the network and press Select to retry." with **Try again** focused; with VoiceView on it is announced.
- [ ] Start the API again, press **Select** → Home loads with skeletons then cards.

## 9. Record

- [ ] Screenshots of Home, Title, reading view, offline: `adb exec-out screencap -p > desc-005-home.png` (UI only; video frames come out black — friction 2026-09-26).
- [ ] Note the build type, Fire OS version and any failures in the ticket, then tick DESC-005 in TASKS.md.
