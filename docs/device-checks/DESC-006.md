# DESC-006 device check — Player and track sheet on the Fire TV Stick

Run on the stick (AFTSS, Fire OS 7), release build, D-pad only after launch. Setup, build and install are the same as
[DESC-005](DESC-005.md) §0–1 (API running with the published Sintel row, `EXPO_PUBLIC_API_URL=http://<mac-ip>:4000`).
Tick each box; failures go in a friction log (`pnpm friction "<title>"`) or back to the ticket. DESC-006 stays open
in TASKS.md until this passes.

Stream under test: `https://dco7qa0c4m1pw.cloudfront.net/published/sintel-90-210/master.m3u8`

## 0. Before you start

- [ ] `curl -s http://localhost:4000/titles/sintel-90-210 -H 'x-device-id: x' | jq '.data | {voice, resumeS, synopsis}'` shows
      `"voice": "Joanna"`, `"resumeS": null` and a synopsis (the status line reads the voice from here; if `voice` is missing, the API build predates fix 5bca731/81a2629).
- [ ] `curl -s https://dco7qa0c4m1pw.cloudfront.net/published/sintel-90-210/master.m3u8` lists two `TYPE=AUDIO` renditions
      (Original; Audio description with `CHARACTERISTICS="public.accessibility.describes-video"`) and the SUBTITLES renditions
      Captions / Rich captions (`…describes-music-and-sound`) / Description text. Note which are present — the sheet's
      choices fall back when one is missing (Rich → Captions).
- [ ] Keep a log open: `adb logcat | grep -i -E 'ExoPlayer|ReactNativeJS|Video'`.

## 1. Start and status line

- [ ] Home → Sintel → **▶ Play with description**. The film starts; until it plays the bottom-left line reads **Loading…**.
- [ ] Chrome while starting: the name top-left over a dark band, a bar with elapsed time left and length right
      (`0:00 … 14:48`-style), and the status line under it: **Description on · Joanna · Rich captions** (28 px, on a dark pill).
      Until the caption track is chosen it may read **… · Captions off** for a moment — it names what is really on screen.
- [ ] The narration is heard over the film (AD rendition chosen by role, not by position in the playlist).
- [ ] Rich captions show bottom-centre: 44 px off-white text in a dark box, sound cues in brackets, ≤ 2 lines. While the
      chrome shows, captions sit above the bar, not under it.
- [ ] Settings → caption size (if DESC-009 has landed; otherwise `PUT /me/prefs {"captionScale":150}` and replay): captions grow.

## 2. Auto-hide

- [ ] With the film playing and no key pressed, the name, bar and times vanish after **4 s** (time it with a stopwatch: 3.5–4.5 s).
- [ ] The **status line stays** bottom-left the whole time (persistent, so "Description on" can be checked at a glance); it stays readable over bright scenes.
- [ ] Any key (▼ is the safest) brings the chrome back and starts the 4 s again. Pressing ▼ every 3 s keeps it up.
- [ ] Pause: chrome stays up for as long as the film is paused.

## 3. Play, pause, seek

- [ ] **Select** pauses; **Select** again plays. Same with the remote's **Play/Pause** key.
- [ ] **►** once: the time jumps +10 s on the bar at once; the picture follows within ~0.3 s (presses within 0.3 s gather into one seek).
- [ ] **◄** three quick presses: −30 s, one seek.
- [ ] **◄** at `0:05`: stops at `0:00`, no error. **►** near the end stops 1 s before the end (the film does not end by seeking).
- [ ] **►**, wait ~0.5 s (while it is still loading the new place), **►** again: the second press lands +20 s from the start, not +10.
- [ ] Hold **►** for ~6 s: the time moves by 10 s steps at first, then faster (30 s, then 60 s steps); release → one seek, playback continues there.
      Note how long the picture takes to resume after release: ________ s.
- [ ] Fast-forward / rewind keys (if the remote has them) behave like ► / ◄.
- [ ] Let the film end: status reads **The end. Press Select to watch again, Back for the title.** **Select** (or Play/Pause) plays again from `0:00`.

## 4. Track sheet

- [ ] **Menu** opens a panel on the right (about a third of the screen): **Audio & captions**; AUDIO: Original · Audio description (Joanna);
      CAPTIONS: Off · Captions · Rich captions · Description text; at the foot **Extended mode · On**.
- [ ] Focus starts on the audio in use. Selected items have the teal inner ring + ✓; the focused item has the off-white outline and grows slightly.
- [ ] **▲ / ▼** move through one vertical list; ◄ ► do nothing (and do not seek the film). Play/Pause does nothing while the sheet is open.
- [ ] **Back** closes the sheet (does not leave the film). **Menu** closes it too. **▲** from the film opens it as well.
- [ ] After closing, **Select** pauses the film (focus is back on the player, not lost). Reopen: focus is on the item you were on.

### Audio switch and stall

- [ ] Select **Original**: narration stops, the film's own mix continues. Status line: **Description off · Rich captions**.
- [ ] Select **Audio description (Joanna)**: narration returns. Status: **Description on · Joanna · Rich captions**.
- [ ] Measure the stall for each switch (video freeze or audio gap, phone slow-mo video of the TV if needed): Original → AD ________ ms, AD → Original ________ ms.
      Segments are 4 s with aligned GOPs, so expect no rebuffer; anything over ~500 ms goes in a friction log.
- [ ] There is **no volume fade** yet: the kit's `KitPlayerRef` has no volume control (react-native-video's `volume` prop is not passed through by
      the kit's Fire OS adapter). Note whether the hard cut is audible as a click: ________.

### Captions

- [ ] **Off**: captions disappear; status ends **Captions off**.
- [ ] **Captions**: plain dialogue captions (no [sound] cues). Status ends **Captions**.
- [ ] **Rich captions**: dialogue + sound cues. Status ends **Rich captions**.
- [ ] **Description text**: the descriptions appear as text (what the narrator says). Status ends **Description text**.
- [ ] Back to Title, then Play again: the caption choice is remembered (`GET /me/prefs` → `captionKind`).
- [ ] **Extended mode** toggles On/Off and `GET /me/prefs` shows `extendedMode` changed. (Its behaviour is DESC-007; nothing else should change.)

## 5. Back saves, Play resumes

- [ ] Home → **▶ Play with description**, press **Back** before the film appears ("Loading…"): Title opens; the app does not close.
- [ ] Start a title never played, press **Back** at once: no `PUT /me/progress` (nothing to resume).
- [ ] Play to about `3:00`, press **Back**: Title appears with **Play with description** focused.
- [ ] API log shows `PUT /me/progress` with `positionS` ≈ 180; `psql` / Prisma Studio `Progress` row matches.
- [ ] **Play with description** again: playback starts at ≈ `3:00` (Fire OS seeks once the stream is up — the first frame may show `0:00` for a moment; note it: ________).
- [ ] Force-stop and relaunch the app, open Sintel, Play: still resumes at ≈ `3:00` (resume point comes from `GET /titles/:slug` → `resumeS`).
- [ ] Back to Home: **Continue watching** lists Sintel without a relaunch (Home refetches the catalog after a save); focus stays where it was.
- [ ] While watching, the API log shows a `PUT /me/progress` about every 10 s of playback — not several per second, and in order (each later than the last).
- [ ] Seek to the last 20 s, let it end, press **Back**, Play: starts from `0:00`.

## 6. Buffering and errors

- [ ] A deep link / transport seek (DESC-008, once it lands) during loading is not undone by the resume point.
- [ ] Throttle the stick's network (Mac hotspot with Network Link Conditioner "Very Bad Network", or pull the router uplink briefly):
      status line reads **Loading…** and the chrome stays up while it stalls.
- [ ] Turn the API/CDN path off mid-play (airplane the hotspot ~20 s): once ExoPlayer gives up the status line reads
      **Playback stopped. Press Select to try again, Back for the title.** — no code, no red screen.
- [ ] Restore the network, press **Select**: playback restarts near where it stopped. **Back** instead returns to Title.

## 7. VoiceView

Turn on: Settings → Accessibility → VoiceView → On.

- [ ] On entering the player: "Play or pause Sintel. Left and right skip 10 seconds. Menu changes audio and captions."
- [ ] A stall longer than 2 s is announced once: "Loading…" (a short one says nothing; a long one, or loading → buffering, is not repeated).
- [ ] The end is announced ("The end. Press Select to watch again, Back for the title.").
- [ ] Opening the track sheet says "Audio & captions"; items name their section and purpose: "Audio: Original, no description",
      "Audio: Audio description, voice Joanna", "Captions off", "Captions: Captions, dialogue only", "Captions: Rich captions, with sounds and music",
      "Captions: Description text", "Extended mode is on. Press to turn it off". Selected items are also read as selected; each ✓ shows once.
- [ ] Focusing the player reads the status line with it (e.g. "Play or pause Sintel. Description on · Joanna · Rich captions. Left and right …").
- [ ] Switching audio announces **"Description off"** / **"Description on"** (never "disabled"/"enabled").
- [ ] The error state is announced with the same sentence as on screen.
- [ ] Turn VoiceView off again.

## 8. Record

- [ ] Screenshots: chrome up, track sheet open (`adb exec-out screencap -p > desc-006-sheet.png`; video comes out black — friction 2026-09-26).
- [ ] Note build type, Fire OS version, the stall and seek timings above, and any failures in the ticket; then tick DESC-006 in TASKS.md.
