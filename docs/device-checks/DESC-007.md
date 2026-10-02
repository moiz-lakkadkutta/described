# DESC-007 device check — Extended mode on the Fire TV Stick

Run on the stick (AFTSS, Fire OS 7), release build, D-pad only after launch. Setup, build and install are the same as
[DESC-005](DESC-005.md) §0–1 (API running, `EXPO_PUBLIC_API_URL=http://<mac-ip>:4000`). Tick each box; failures go in a
friction log (`pnpm friction "<title>"`) or back to the ticket. DESC-007 stays open in TASKS.md until this passes.

How it works, so the checks make sense: the Player reads the whole **Description text** track, finds the cues marked
`{extended=1}` (shots with no gap in the dialogue), and when playback crosses one it pauses, shows the ochre bar, plays that
cue's clip from `GET /titles/:slug/cues/d{n}/audio` (a 302 to the Polly MP3 on CloudFront), then resumes. `d{n}` is the n-th
description cue by start time (packages/pipeline/src/cues.ts).

## 0. A title with extended cues — needs a paid run (awaiting the human's go-ahead)

The published `sintel-90-210` has **no** extended cues (Gate C confirmation run: 22 voiced, 0 extended), and no
`DescriptionCue` rows (no pipeline step wrote them before DESC-007). So there is nothing to test on it yet.

**Paid run — do not start without the human's go-ahead.** One 2-minute segment through the full pipeline, which now writes
the `DescriptionCue` rows in the publish step:

| Step | Service | Estimate (2 min, ~25 shots, ~20 cues) |
|---|---|---|
| speech | Transcribe | 2 min × $0.024 ≈ $0.05 |
| describe | Bedrock Qwen3-VL 235B | ≈ $0.03 (Gate C confirmation run) |
| fit / text | Nova Lite (shortener, SDH) | < $0.01 |
| voice | Polly neural, ≈ 20 cues × 80 chars ≈ 1,600 chars × $16 / 1M | ≈ $0.03 |
| publish | S3 PUT + CloudFront | < $0.01 |
| **Total** | | **≈ $0.10–0.15** |

Extended cues only appear where a shot brings new information and has no gap long enough, so pick a dialogue-dense segment.
In the fixture replay (`packages/pipeline/test/fixtures/sintel-90-150.*`) Sintel 1:30–2:30 yields one: shot 7,
"Words appear: The milk is good." at 0:44 of the clip — but the confirmation run on 1:30–3:30 gave none, so the result
depends on the describe output. If the run yields 0 extended cues, another segment costs the same again; ask first.

- [ ] Title row: `POST /admin/titles` (x-admin-token) with a fresh slug (e.g. `sintel-90-150`; re-runs reuse segment names, see 10-publish).
- [ ] Run with `DATABASE_URL` set so publish writes the rows: `pnpm --filter @described/pipeline cli describe --title <slug> --source s3://…`.
      Publish logs nothing about rows when it worked; `publish: no Title row…` or `no DATABASE_URL…` means they were not written.
- [ ] Mark the title published as for `sintel-90-210` (`UPDATE "Title" SET status='published' WHERE slug='<slug>'`).

## 1. Before you start (laptop)

- [ ] Extended cues in the published track: `curl -s https://dco7qa0c4m1pw.cloudfront.net/published/<slug>/descriptions.vtt | grep -B2 'extended=1'`.
      Note each one's id and start: d____ at ____, d____ at ____.
- [ ] Rows (psql or Prisma Studio): `SELECT "startMs", extended, "pollyKey" FROM "DescriptionCue" WHERE "titleId" = (SELECT id FROM "Title" WHERE slug = '<slug>') ORDER BY "startMs", "endMs";`
      — one row per cue, every row with a `pollyKey` (`published/<slug>/cues/cue_<i>.mp3`); row n is `d{n}`.
- [ ] Clip route: `curl -sI http://localhost:4000/titles/<slug>/cues/d<n>/audio` → `302`, `Location: https://…/published/<slug>/cues/cue_<i>.mp3`;
      `curl -sI <Location>` → `200`, `audio/mpeg`. The text of that row matches the VTT cue d<n>.
- [ ] `curl -sI http://localhost:4000/titles/<slug>/cues/d999/audio` → `404` (nothing is synthesised at request time).
- [ ] Keep the API log open (each clip request shows up as `GET /titles/<slug>/cues/d<n>/audio`) and `adb logcat | grep -i -E 'ExoPlayer|ReactNativeJS|Audio'`.

## 2. Pause, speak, resume

Home → the title → **▶ Play with description**. Menu → **Extended mode · On** (default). Seek with ► to ~20 s before the first extended cue.

- [ ] About **10 s before** the cue, the API log shows one request for its clip (the prefetch). Note the lead: ______ s.
- [ ] At the cue the picture **freezes** (the film pauses), a thin **ochre bar** runs along the bottom edge with **Describing…** above
      its right end, and the description is spoken in the title's voice. The film's own sound is silent while it speaks.
- [ ] How late is the pause after the cue's start (phone slow-mo of the TV against the elapsed time)? ______ ms (expect ≤ ~300 ms: positions arrive at 4 Hz).
- [ ] When the voice ends, the bar goes and the film plays on from the same frame. Gap between voice end and picture moving: ______ ms.
- [ ] The clip starts promptly (prefetched): delay from freeze to voice ______ ms. No second request for the same clip in the API log.
- [ ] The status line reads **Description on · <voice> · …** throughout; the chrome shows while paused and hides again 4 s after the resume.
- [ ] The next extended cue does the same, once. Let a cue pass and keep watching 10 s: it does not pause again.

## 3. Keys during the pause

Seek back to ~5 s before a cue each time (◄), let it pause, then:

- [ ] **►** (or ◄): the voice stops at once, the bar goes, the film plays on from the new place. It does not pause again at the old cue.
- [ ] **Back**: the voice stops at once and Title appears (progress saved as usual). Nothing plays in the background.
- [ ] **Menu**: the voice stops, the film plays on, the track sheet opens.
- [ ] **Select** (or Play/Pause, or the remote's Pause key): the voice finishes, the bar goes, and the film **stays paused** (your pause wins).
      **Select** again plays.
- [ ] **Select** twice quickly during the voice: it finishes and the film resumes (the second press undid the pause).
- [ ] Alexa "pause" during the voice (once DESC-008 lands): same as Select — stays paused after the voice.

## 4. Seeking over cues

- [ ] From ~15 s before a cue, **►** twice (+20 s, past the cue): no pause, no voice.
- [ ] **◄** back to before the cue and let it play: it pauses at the cue again (each crossing counts once).
- [ ] Hold **►** across several cues: no pause until you let go and the film plays over a cue.

## 5. Settings honoured live

- [ ] Menu → **Extended mode · Off**, close, play over an extended cue: no pause, no bar, no clip request in the API log.
      (The description is simply not voiced — extended cues are not in the narration track.) Turn it back **On**: the next cue pauses again.
- [ ] Menu → **Original** (description off), play over an extended cue: no pause. Back to **Audio description**: pauses again.
- [ ] Settings → Extended mode Off (DESC-009, once landed), then play: no pauses.
- [ ] Turn Extended mode Off **during** a pause (Menu opens the sheet, which already ends the pause; then Off): the film keeps playing.

## 6. Failures never leave the film paused

- [ ] Remove one clip's key: `UPDATE "DescriptionCue" SET "pollyKey" = NULL WHERE …` (row of a later extended cue). At that cue the film
      pauses and resumes within ~1 s (the route says 404; the bar flashes). Restore the key afterwards.
- [ ] Stop the API just before a cue (`Ctrl-C` on `pnpm api`): at the cue the film pauses and resumes by itself within **8 s** (load timeout). Restart the API.
- [ ] No case leaves the film paused with the bar gone and no voice.

## 7. VoiceView

Settings → Accessibility → VoiceView → On.

- [ ] At an extended cue VoiceView says **"Describing…"** once (politely, not cutting into the description voice for long); the voice follows.
- [ ] Nothing else is announced at the resume. Turn VoiceView off again.

## 8. Title screen (regression)

- [ ] **Hear a sample** on the new title plays the first extended cue's clip (`sampleCue`, now that the rows exist) and stops when you leave.

## 9. Record

- [ ] Screenshot during a pause (`adb exec-out screencap -p > desc-007-bar.png`; the video comes out black — friction 2026-09-26, the bar shows).
- [ ] Note the slug, the run's cost, the timings above and any failures in the ticket; then tick DESC-007 in TASKS.md.
