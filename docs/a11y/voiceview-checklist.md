# VoiceView run-through — script (DESC-009)

The human pass on the Fire TV Stick that PLAN §8 asks for. Copy this file to `docs/a11y/voiceview-2026-10-xx.md`
(the date you run it), tick each box, write what was actually spoken where it differs, and commit it. Anything that
fails goes back to the ticket that owns the screen (Player and track sheet: DESC-006; extended pauses: DESC-007).

**How speech works in this app.** Focus moves in JavaScript (react-tv-space-navigation), not through Android, so
VoiceView does not read focus by itself: the app announces each focused element's label (then its hint) 200 ms after
focus settles. Holding ◄/► along a row speaks only where you stop. Some screens say a little context once before the
first label (a row's name, a title's facts). "Spoken:" lines below are what you should hear, word for word.

**App voice vs VoiceView.** First-run prompts are also played as audio clips in the app voice (Polly, the voice chosen
in Settings). The clips are not generated yet (TODO DESC-010: `prompts/<voice>/<key>.mp3`), so today you only hear
VoiceView. With VoiceView on, the app skips the clip on purpose so two voices never talk over each other.

## 0. Setup

- [ ] Build and install as in `docs/device-checks/DESC-005.md` §1 (release build). API running with at least Sintel published.
- [ ] Clear the profile so first run shows: `adb shell pm clear dev.moizp.described` (new device id → new profile),
      or in the app: Settings → Show the introduction again.
- [ ] Turn VoiceView on: hold **Back + Menu** together for **2 seconds** (or Settings → Accessibility → VoiceView → On).
      VoiceView confirms it is on.
- [ ] Note: build type, Fire OS version, VoiceView speech rate (default unless you changed it).

## 1. First run (three panels)

Launch the app. Each panel: the text is announced when it appears; Select advances; Back goes back.

- [ ] Panel 1. Spoken as one announcement: "Described plays every film with audio description. It's on now. Next tip. Tip 1 of 3. Press Back twice to skip the introduction."
      Nothing is said twice.
- [ ] Select → panel 2. Spoken: "Press Menu while watching to change voice, captions or turn it off. Next tip. Tip 2 of 3. Back goes to the previous tip."
- [ ] Back → panel 1 again (panel 1 text spoken again). Select → panel 2, Select → panel 3.
- [ ] Panel 3. Spoken: "Extended mode pauses the film when there's a lot to describe. Keep it on? Keep extended mode on. Tip 3 of 3. Finishes the introduction."
- [ ] ► → "Turn extended mode off. Finishes the introduction. You can turn it on again in Settings." ◄ → back to Keep on.
- [ ] Select on **Turn off** → Home. (Check later in Settings: Extended mode: Off.)
- [ ] Back from panel 3 while **Turn off** has focus: panel 2 is spoken once (not twice).
- [ ] Skip: Settings → Show the introduction again → on panel 1 press **Back**: "Press Back again to skip the introduction."
      (also shown on screen), said once. Press **Back** again → Settings, focus on "Show the introduction again".
- [ ] Back never leaves the app from any panel. No panel times out.
- [ ] Relaunch the app (`adb shell am force-stop dev.moizp.described && adb shell monkey -p dev.moizp.described 1`): first run does **not** show again.

## 2. Home

- [ ] Initial focus. Spoken: "Sintel. <synopsis>. Play Sintel with audio description" (the hero's name and synopsis come first, once).
- [ ] ► "Play Sintel without description" · ► "Add Sintel to My list". Select → "Sintel added to My list"; Select again → "Sintel removed from My list".
- [ ] ▼ into a row. Spoken: "Newly described. Open Sintel. 2010. <N> minutes. Audio description" (row name only when you enter the row).
      ► "Open Tears of Steel. 2012. <N> minutes. Audio description" (no row name). Continue watching cards add "<N> minutes watched".
- [ ] Hold ► for 2 s: only the card where you stop is spoken.
- [ ] ◄ from the first card → rail. Spoken: "Go to Home" (▲▼: "Go to Described", "Go to My list", "Go to Settings").
- [ ] Slow API (or first launch): after 2 s of skeletons you hear "Loading…" once.

## 3. Title (Sintel)

- [ ] Open Sintel. Spoken, once: "Sintel. 2010. <N> minutes. Audio description. Rich captions. Pauses <N> times for longer descriptions. <synopsis>. Play Sintel with audio description".
- [ ] ▼ "Play Sintel without description" · "Hear a sample of the description voice for Sintel. Plays about 20 seconds over the poster" ·
      "Captions: Rich captions. Press to change captions" · "Add Sintel to My list". ▲ from Play with description: "Read the full synopsis of Sintel" (only if the synopsis is longer than 4 lines).
- [ ] Select on Captions → "Captions: Description text"; again → "Captions: Off" → "Captions: Captions" → "Captions: Rich captions".
- [ ] Hear a sample: the voice plays; the button becomes "Stop the sample" (not announced: the clip itself is the feedback — note if that is confusing).
- [ ] More → reading view. Spoken: "Sintel. <full synopsis>. Close the synopsis". Back → Title, focus on More, the summary is **not** repeated.
- [ ] A title still processing: the summary ends with "We're still describing this film — about <N> minutes left."
- [ ] Back → Home, focus on the card you opened.

## 4. Settings

Rail → "Go to Settings" → Select. Values change with ◄► (Select also steps forward); each change is spoken.

- [ ] First row. Spoken: "Description on by default: On. Press left or right to change". ► → "Description on by default: Off".
      Back to Home: focus is now on "Play Sintel without description" (and on Title too). Set it back to On.
- [ ] "Voice: Joanna. Press left or right to change". ► "Voice: Daniel" ► "Voice: Matthew" ► "Voice: Vicki" ► "Voice: Joanna".
- [ ] ▼ "Hear the voice Joanna. Plays one sentence in this voice". Select: the clip plays (silent until the prompt clips exist — note it).
- [ ] "Extended mode: Off" (from the first-run choice) ► "Extended mode: On".
- [ ] "Caption size: 100%" ► 125% ► 150% ► 200% ► 100%. ◄ goes the other way.
- [ ] "Caption style: Box" ► "Caption style: Shadow".
- [ ] Holding ► changes a value once, not repeatedly.
- [ ] ◄ on a value row changes the value; ◄ on "Hear the voice", "Show the introduction again" or "About and licenses" opens the rail.
- [ ] "Show the introduction again. Opens the three introduction screens now" (covered in §1).
- [ ] "About and licenses: film credits and the licenses of the font and code" → Select. Spoken: the first title's attribution sentence,
      e.g. "Sintel © Blender Foundation, CC-BY 3.0. Described by Described." ▼ walks each title, then
      "Atkinson Hyperlegible © Braille Institute of America, used under the SIL Open Font License 1.1.", the kit and app MIT lines, "Close About and licenses".
      Back → Settings, focus on About.
- [ ] Relaunch: every value you set is kept (saved to the profile).

## 5. Player and track sheet (DESC-006 — record only)

- [ ] Play with description: the status line ("Description on · Joanna · sdh") — is anything spoken when playback starts? Note it.
- [ ] Menu → track sheet: note each spoken label and whether the selected item is announced as selected.
- [ ] Switch Audio description off/on: is "Description off/on" announced?
- [ ] An extended pause (title with extended cues, DESC-007): is the pause announced?

## 6. Offline

- [ ] Stop the API, relaunch. Spoken: "Can’t reach the library. Check the network and press Select to retry." then "Try the library again".
- [ ] Settings → About with the API stopped: "Can’t reach the library, so the film credits are missing…" shown; the license lines are still read.

## 7. Wrap up

- [ ] Nothing was read as just "button" or skipped; nothing was read twice in a row. List exceptions here with the screen and the exact words.
- [ ] Turn VoiceView off (Back + Menu, 2 s).
- [ ] Commit as `docs/a11y/voiceview-<date>.md`; file friction logs (`pnpm friction "<title>"`) for platform surprises.
