# 0019 — Extended mode pauses early, never late

Status: accepted 2026-10-19 · Ticket: DESC-007 (Extended mode), DESC-020 / 0007 (extended cues from dropped plot events) ·
Code: `ExtendedScheduler` (`packages/shared-ui/src/extended.ts`), `Player` (`packages/shared-ui/src/screens/Player.tsx`),
`speak` (`apps/expo/src/audio.ts`, log line only)

## Problem

On tears-of-steel-40-100 with Extended mode on, a description played over the next one. `ExtendedScheduler.tick` fired a cue
only once `pos >= cue.start`. The kit reports position at ≤ 4 Hz, so the tick that sees the start lands 0–250 ms after it. The
pause then goes through `setPaused(true)` → the RN bridge → ExoPlayer, another ~100–250 ms (estimated, not measured). So the
pause always landed late, and the film played whatever follows the cue's start:

- d10 (extended) at 43.226. The AD track's d11 starts at 43.376 and its voice at 43.589. "Man—" was heard, then the clip "Words
  appear: Dr Amstelwijk…" in the same voice.
- d1 (extended) at 0.000, with the opening dialogue at 0.05. The first tick only comes after playback starts, so "that I'm
  being…" played before the clip cut in.

The AD track itself is clean (scratchpad diagnosis, 2026-10-19). This is only about when the app pauses.

## Decision

1. **Fire up to `EXTENDED_LEAD_S` = 0.35 s early.** A tick fires every cue whose start is within `pos + EXTENDED_LEAD_S`: one
   tick interval (0.25 s) plus a margin. At 4 Hz the pause is requested 0.10–0.35 s before the start, never after it. Pausing
   early loses nothing, because the film resumes from where it paused. The scheduler keeps a horizon (every start up to
   `pos + lead` has been handled), so a cue never fires twice. Jitter and the ticks that arrive during the pause do not fire it
   again.
2. **A timer between ticks.** When the next cue's fire point (`start − lead`) is less than `ARM_WINDOW_S` = 0.5 s ahead, the
   tick returns `armIn`. Player arms a timer that ticks the scheduler at `pos + armIn`. The kit's position only moves on
   ticks, so the timer adds the wait to the last tick. The pause is then requested at `start − 0.35` whatever the tick phase.
   The timer does nothing unless the kit says `playing`, nothing is speaking and ◄► is not held. Every tick, seek, Extended mode
   off, or leaving the player clears it.
3. **Seeks keep their meaning.** After a seek, the first tick is a baseline. A cue the seek lands on or passes never fires. A
   cue starting after the landing point fires on the next tick. Seeking back before a cue and playing over it fires it again.
4. **A cue at 0:00 plays before the film.** From 0:00 in Extended mode the load does not autoplay (`autoplay` is fixed per
   load). Once the load is `ready` and the descriptions VTT has been read, the scheduler ticks at 0. A cue starting within the
   lead of 0:00 is spoken first, and the film plays after it. The film plays without waiting when the read 404s or runs out of
   retries, or `START_HOLD_MS` = 1.5 s after `ready`. Play from the viewer, or turning Extended mode off, also ends the wait. When
   resuming mid-film or with Extended mode off, the load autoplays as before.

## Cost

A pause can come up to 0.35 s before the cue's start (exactly 0.35 s when the timer runs). Nothing is skipped: the third of a
second between the pause and the cue's start plays after the clip, so the clip starts a little before the moment it describes.

## Measure it on the device

The 100–250 ms pause latency is an estimate. Measure it on the Fire TV before calling this fixed. Run `adb logcat -G 16M`, then
`adb logcat -c`, then play tears-of-steel-40-100 from 0:40 to 0:46 with Extended mode on, and grep `ReactNativeJS` for:

- `[described] extended pause requested d{n} start=… pos=…`: when the app asks for the pause, and at which position.
- `[described] extended paused (kit state)`: when the kit reports `paused`.
- `[described] extended clip playing <url>`: when the clip's expo-audio player first reports `playing`.

The time from "pause requested" to "paused" is the pause latency. If it is more than `EXTENDED_LEAD_S − 0.1` s, raise the lead.
Listen too: there should be no "Man—" before "Words appear". The pipeline fix (moving d10 back into its own shot in 06-voice
`afterClips`) is separate; this change protects every title without a re-run.
