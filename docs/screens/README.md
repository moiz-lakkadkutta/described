# Screenshots — to capture

For the README, Devpost and the video (DESC-011, DESC-012). Captured by the human on the Fire TV Stick from a release build
of main (see README "Release build on the stick"). Files go in this folder as `<name>.png`, 1920×1080.

## Recipe

```sh
adb connect <stick-ip>:5555
adb shell input keyevent KEYCODE_WAKEUP                      # a sleeping stick breaks playback (friction 2026-10-01)
adb exec-out screencap -p > docs/screens/<name>.png
file docs/screens/<name>.png                                 # expect: PNG image data, 1920 x 1080
```

**Check the first capture before you go on.** On this stick `screencap` has returned all-black images, for the UI and for
video ([friction 2026-09-26](../friction/2026-09-26-adb-screencap-black.md)). Open the PNG. If it is black:

- try again with no video on screen (Home, Settings); if that works, only the Player shots need the fallback;
- fallback: photograph the TV straight on with a phone, crop to the screen, save as `<name>.jpg`, and note "photo" in the table.

Moving on the remote between shots: D-pad, **Select**, **Back**, **Menu**. Leave focus where the table says, so each
image shows the focus outline (outline + 1.04 scale).

## Shots

| # | Name | Screen | State to set up | Shows |
|---|---|---|---|---|
| 1 | `first-run` | First run, panel 1 | `Settings › Show the introduction again`, relaunch | "Described plays every film with audio description." / "It's on now." |
| 2 | `home` | Home | focus on **▶ Play with description** in the hero | hero, AD badge, rows, rail collapsed |
| 3 | `home-rail` | Home, rail open | ◄ from the first card | rail: Home, Described, My list, Settings |
| 4 | `title` | Title | open TODO(DESC-010): a title with extended cues, focus on **▶ Play with description** | poster, badges (AD, Rich captions, "Extended: N pauses"), actions, attribution |
| 5 | `player-captions` | Player, chrome up | play with description, Rich captions on, press ▼ at a line with a [sound] cue | status line "Description on · <voice> · Rich captions", caption box |
| 6 | `track-sheet` | Player, track sheet | **Menu** during playback | Audio: Original / Audio description (<voice>); Captions: Off / Captions / Rich captions / Description text; Extended mode |
| 7 | `player-extended` | Player, Extended mode pause | Extended mode on, play up to an extended cue | ochre bar "Describing…" (needs a DESC-010 title with extended cues) |
| 8 | `settings` | Settings | rail › Settings | Description on by default, Voice + Hear it, Extended mode, Caption size, Caption style, About & licenses |
| 9 | `described` | Described grid | rail › Described, focus on the first card | grid heading above the cards, three per row |
| 10 | `my-list` | My list | add two titles first, then rail › My list | grid of saved titles (and, separately, `my-list-empty` with none saved) |
| 11 | `about` | About & licenses | Settings › About & licenses | film attribution sentences, font and code licences |

Shots 5–7 show video: if `screencap` is black there, use phone photos.

After capture: list the files in README "Screens", and tick the screenshot item under DESC-011 in TASKS.md.

## Captured 2026-10-22 (Android TV emulator)

Release APK `v0.1.0-rc1` (sha256 `b417fe07…aaec`) against the hosted API, on an Android TV emulator: system image `android-31;android-tv;arm64-v8a`, AVD `tv_1080p` (1920 × 1080, 320 dpi, the stick's density). Captured with `adb exec-out screencap -p`; the only processing was dropping the all-opaque alpha channel (24-bit PNG for the Appstore). Video decoded on the emulator, so shots 5–7 are real frames, not photos. Not a Fire TV: re-shoot on the stick if the UI differs.

| # | File | State |
|---|---|---|
| 1 | `first-run.png` | fresh install, panel 1, focus on Next |
| 2 | `home.png` | after a relaunch, focus on ▶ Play with description (Sintel hero) |
| 3 | `home-rail.png` | ◄ from the first card; rail open, Home checked |
| 4 | `title.png` | Sintel (whole film): AD, Rich captions, "Extended: 18 pauses"; focus on ▶ Play with description |
| 5 | `player-captions.png` | Sintel 3:23, `[creature roars]` rich caption, status line "Description on · Ruth · Rich captions" |
| 6 | `player-extended.png` | Sintel 3:22, Extended mode pause: chrome up, ochre bar "Describing…" |
| 7 | `track-sheet.png` | Menu during playback: Audio & captions sheet |
| 8 | `settings.png` | rail › Settings, focus on Description on by default |
| 11 | `about.png` | Settings › About & licenses |

Not captured: 9 `described` and 10 `my-list` (not needed for the Appstore set). Store upload order and Devpost 3:2 copies: [docs/appstore/SUBMIT.md](../appstore/SUBMIT.md#3-upload-folder).
