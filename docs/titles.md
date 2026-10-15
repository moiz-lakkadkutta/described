# Catalogue titles (DESC-010)

Five Blender open-movie segments, ≈ 60 s each, all five described end to end by the pipeline CLI with its defaults (Qwen3-VL 235B
from key frames, Nova Lite edit pass on, extended cues for dropped plot events) and published on 2026-10-14 — Sintel re-run that
day, because its rows from the 2026-10 device run had been written by hand and it had no DescriptionCue, Rendition or TextTrack
rows. The rows live in `apps/api/prisma/titles.json` (`pnpm titles:seed` upserts them by slug; `prisma migrate reset`, and
`pnpm db:migrate` when it creates or resets the database, run the same seed — `apps/api/package.json` `prisma.seed`; the pipeline fills duration, voice, language, art, cues,
tracks and status). Every film is CC-BY, and its credit sentence (`attribution`) is shown on the Title screen and under Settings → About &
licenses (`GET /about`), as CC-BY requires in-app.

**People and places (DESC-029).** Each entry also carries `characters[]` (name, look, short, role, `revealedAtS` in segment seconds,
`nameEvidence`) and `settings[]` (name, look, `firstAtS`), written from evidence only — the captions, the films' official subtitles,
the synopsis and the frames — in a director's voice inside the guardrails of
[decision 0012](decisions/0012-characters-and-scenes.md): only what a sighted viewer can see or has been told by that point; no name
before it is revealed inside the segment, and only for a figure with that look; no role is ever voiced (Emo 25.1 s; Thom 2.2 s;
Celia, Sintel, Proog, Koro, the shaman and Big Buck Bunny never inside their segment). Every look was checked against frames. The pipeline reads them from this file (describe prompt, scene
step, fit, edit pass and its grounding guard); the API does not store them. Baseline before the change:
[docs/eval/character-scene-baseline.md](eval/character-scene-baseline.md).

| Slug | Film | Source (official Blender download) | Segment | Licence | Credit |
|---|---|---|---|---|---|
| `sintel-90-150-r2` | Sintel (Durian, 2010) | https://download.blender.org/durian/movies/Sintel.2010.1080p.mkv (1920×818, as the S3 source is; the cut predates this file and was not recorded) | 1:30–2:30 | CC-BY 3.0 | Sintel © Blender Foundation, CC-BY 3.0. |
| `big-buck-bunny-0-60` | Big Buck Bunny (Peach, 2008; 2013 "sunflower" re-render) | https://download.blender.org/demo/movies/BBB/bbb_sunflower_1080p_30fps_normal.mp4.zip | 0:00–1:00 | CC-BY 3.0 | Big Buck Bunny © 2008 Blender Foundation, CC-BY 3.0. |
| `elephants-dream-0-60` | Elephants Dream (Orange, 2006) | https://download.blender.org/ED/elephantsdream-1024-h264-st-aac.mov | 0:00–1:00 | CC-BY 2.5 | Elephants Dream © 2006 Blender Foundation / Netherlands Media Art Institute, CC-BY 2.5. |
| `caminandes-35-95` | Caminandes 2: Gran Dillama (Blender Institute, 2013) | https://download.blender.org/demo/movies/caminandes_gran_dillama.mp4.zip | 0:35–1:35 | CC-BY 3.0 | Caminandes: Gran Dillama © 2013 Blender Foundation (a Blender Institute production, www.caminandes.org), CC-BY 3.0. |
| `tears-of-steel-40-100` | Tears of Steel (Mango, 2012) | https://download.blender.org/demo/movies/ToS/tears_of_steel_1080p.mov.zip | 0:40–1:40 | CC-BY 3.0 | Tears of Steel © 2012 Blender Foundation, CC-BY 3.0. |

Why these segments: Big Buck Bunny opens on its title card, a slow landscape pan and the rabbit waking (on-screen text, no
dialogue); Elephants Dream opens on two title cards and the machine chase with shouted lines (text, dialogue gaps, action);
Caminandes is slapstick with no dialogue at all (the whole minute is one gap); Tears of Steel carries three on-screen text
cards ("40 YEARS LATER", "SIMULATION READY", the title), a dialogue scene and VFX shots; Sintel is the Gate C segment (0003).

Tears of Steel: `ToS/copyright.txt` on download.blender.org is the CC-BY-ND 3.0 notice for the **soundtrack files** in
`Tears-Of-Steel-OST/`; the film itself is CC-BY 3.0 (© Blender Foundation, mango.blender.org). The segment is a clip of the film,
not of the OST release. Elephants Dream is the one CC-BY 2.5 title (its release licence).

Caminandes: Gran Dillama, checked from the film itself (2026-10-14): the official download
(`caminandes_gran_dillama.mp4.zip`, 146.0 s) ends on a licence card at ≈ 2:23 — the CC BY icons and "Released under Creative
Commons Attribution 3.0 / Blender Foundation - www.caminandes.org" — after the credits card "A Blender Institute Production 2013".
So the film is CC-BY 3.0, © Blender Foundation; the credit sentence now names both. Frames were read with ffmpeg from the last
40 s; the download was deleted afterwards.

How a segment is cut (the same for every title): `ffmpeg -ss <start> -i <film> -t 60 -map 0:v:0 -map 0:a:0 -c:v libx264 -crf 18
-pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart sources/<slug>.mp4`, uploaded to `s3://$S3_BUCKET_MEDIA/sources/`, then
`pnpm pipeline describe --title <slug> --source s3://$S3_BUCKET_MEDIA/sources/<slug>.mp4 --voice <Title.voice>`. The CLI writes
the rows and marks the title published itself (`persistForCli`), so no SQL step remains: DescriptionCue, Rendition and TextTrack
rows, art keys, durationS, and voice and language from the run (`--voice` / `--lang`: what was spoken, which labels the AD track;
a re-seed no longer overwrites them), with status = published last, all in one transaction — a `--from` re-run of a published
title swaps its rows at once, never serving a mix.

What the Player reads: the audio and text tracks it offers come from the HLS master (the kit's `textTracksFromHls`, plus the
master's CHARACTERISTICS for Rich captions), not from the API's Rendition and TextTrack rows. Extended mode reads
`GET /titles/:slug/descriptions.vtt` and `GET /titles/:slug/cues/d{n}/audio`, both built from the DescriptionCue rows, and the
Title screen's sample cue and Extended badge come from those rows too. So Sintel without rows still played with captions and
AD, but had no Extended mode pauses, no sample cue and an empty `tracks` in `GET /titles/:slug`.

## Measured cost per title (2026-10-14)

From the CLI meter (`src/cost.ts` list prices, unverified — each still marked `TODO(price): verify`), printed per step by the CLI.
`Job.costUsd` stays empty on the CLI path: only the worker writes Job rows.

| Title | Shots | Transcribe | Describe (Qwen3-VL) | Edit + SDH (Nova Lite) | Polly | **Total** |
|---|---|---|---|---|---|---|
| sintel-90-150-r2 (re-run, Joanna) | 15 | $0.0240 | $0.0177 | $0.0004 | $0.0094 | **$0.0514** |
| big-buck-bunny-0-60 | 11 | $0.0240 | $0.0198 | $0.0002 | $0.0112 | **$0.0553** |
| elephants-dream-0-60 | 10 | $0.0240 | $0.0197 | $0.0004 | $0.0080 | **$0.0521** |
| caminandes-35-95 | 14 | $0.0240 | $0.0218 | $0.0002 | $0.0125 | **$0.0586** |
| tears-of-steel-40-100 | 16 | $0.0240 | $0.0166 | $0.0004 | $0.0148 | **$0.0557** |
| app-voice prompt clips (`pnpm pipeline prompts --run`, 16 clips, 1,232 characters) | — | — | — | — | $0.0197 | **$0.0197** |
| re-runs `--from text` (Elephants Dream, Tears of Steel: VTT ends clamped; one Nova Lite 424, retried) | — | — | — | $0.0003 | — | **$0.0003** |
| **Batch** | | | | | | **$0.293** for the five first runs and the prompt clips ($0.2731 + $0.0197), plus **$0.0003** for the `--from text` re-runs (approved ≈ $5, cap $10) |
| re-run after #37/#39: sintel-90-150-r2 `--from fit` | — | — | — | $0.0003 | $0.0060 | **$0.0063** |
| re-run after #37/#39: tears-of-steel-40-100 from the start (work dir not on this machine, see below) | 16 | $0.0240 | $0.0171 | $0.0004 | $0.0145 | **$0.0559** |
| **Re-runs after #37/#39** | | | | | | **$0.0622** (cap $1.00); two CloudFront invalidations (`/published/<slug>/*`, inside the free 1,000 paths a month) |
| re-run after #41/#42: tears-of-steel-40-100 `--from fit` (2026-10-14) | — | — | — | $0.0002 | $0.0117 | **$0.0119** (cap $0.30); one CloudFront invalidation |
| re-run after #44: sintel-90-150-r2 `--from edit` (2026-10-14; d3 "Snowy mountains. A figure walks, falls. Logo fades." → "A figure walks, falls. Logo fades.", edit.json `by: "repeat"`; validate no problems; no `<v ` in captions) | — | — | — | $0.0002 | $0.0069 | **$0.0071** (cap $0.10); one CloudFront invalidation |

Transcribe is the floor: $0.024 for 60 s (billed per second, 15 s minimum) even when the clip has no speech (Caminandes). Every
title took 4–5 minutes wall clock, four in parallel with `DESCRIBE_CONCURRENCY=2`; no throttling. Sintel's earlier figure,
$0.0499 (2026-10-04), was the same segment before DESC-017/018/020.

## Validation (2026-10-14)

Per title: `validate` reported no problems; the manifest parsed with the kit's HLS and VTT parsers (two audio renditions,
Original and Audio description; text tracks as listed below); `master.m3u8`, `audio_ad.m3u8`, `captions.vtt`, `descriptions.vtt`,
`art/poster.jpg` and `art/hero.jpg` all answer 200 from CloudFront; `GET /catalog` lists all five with poster art and
`GET /about` lists the five credit sentences. After the Sintel re-run, `GET /titles/sintel-90-150-r2` returns two audio and two
text tracks, `extendedCount` 2 and a sample cue.

| Title | Description cues (extended) | Captions / Rich captions | Notes from reading descriptions.vtt |
|---|---|---|---|
| sintel-90-150-r2 | 11 (2) | 11 / omitted (degraded) | "Words appear: SINTEL." split into its own text pause at 0:00; "Red-haired girl accepts bowl." became an event pause (267 ms over its slot); "Red-haired woman stares downward." dropped (432 ms over, not a new event); the last cue is a bare "Darkness." |
| big-buck-bunny-0-60 | 9 (0) | 1 cue / omitted (SDH degraded: no additions) | clean; title card read as "Words appear: Big Buck Bunny."; "Darkness." at 0 ms dropped by voice (381 ms over its limit); the rabbit is "a large, dark figure" until it leaves the burrow, then "a large gray rabbit" |
| elephants-dream-0-60 | 7 (1) | 12 / omitted (degraded) | both title cards read ("the orange open movie project presents", "elephants dream"); 0:11–0:33 (the machine chase, shouted dialogue) has no cue — the gaps were too short; the last cue (19 words) is an extended pause |
| caminandes-35-95 | 13 (0) | none (no speech) / none | **invented details**: "a tan llama with sunglasses" (d2 — the llama has dark brow markings, no sunglasses), "an orange fox tumbles from a bridge" (d10 — it is the llama falling off the fence tower); the same animal is "tan llama", "brown llama", "orange fox" across cues (no stable descriptor); the electric flash becomes "Sun flares, then dims." |
| tears-of-steel-40-100 | 15 (3) | 4 / 5 (the `--from text` re-run added sound cues; the first run had degraded) | all three text cards read ("40 YEARS LATER", "SIMULATION READY…", the title as an extended cue); **faults**: d8 "Darkness. in metallic silver, centered." is the fragment left after the title clause was split off (06-voice split, DESC-017); the newspaper headline cue ("Hand holds crumpled newspaper headline: ROBOTICIST CREATES KILLER ROBOTS") was **dropped** by voice (741 ms over) because it is not phrased as "Words appear:" and so was not split into a text pause; "Darkness." prefixes on d10 and d12 contradict the rest of the line ("Darkness. A mechanical airship … hovers"); d10 "a figure kneels beside a prone body, candles flicker" is unverified against the frame (a dark hideout interior) |

## Re-runs after #37 and #39 (2026-10-14)

The 0008 fixes (text clause with its modifier, unlabelled on-screen text, "Darkness." prefix) and #39 (Rich captions only from
evidence) reach a published title only on a re-run from fit. Where each title's work dir was:

- sintel-90-150-r2: `packages/pipeline/work/sintel-90-150-r2/` is on this machine → `--from fit` (no describe call).
- tears-of-steel-40-100: its work dir is gone (the batch ran in a worktree since removed), and S3 keeps only `work/<slug>/mezz.mp4`
  and `transcript.json`, never `described.json` → run from the start (`--source s3://…/sources/tears-of-steel-40-100.mp4 --voice
  Matthew`), so this describe used the **0008 prompt** (a 60 s segment, not the full-length run DESC-024 gates).
- big-buck-bunny-0-60, elephants-dream-0-60, caminandes-35-95: work dirs gone as well, so `described.json` could not be grepped.
  Checked instead: their published descriptions.vtt (no cue starts lowercase, no "Darkness." prefix before content — Caminandes d9
  and the Big Buck Bunny cue dropped at 0 ms are a bare "Darkness.", which 0008 keeps) and their batch run logs (no text clause split
  off, no on-screen text dropped by voice). None has a fault #37 fixes; not re-run. #39 does not change them either (no Rich
  captions before or after).

After both runs: `validate` reported no problems (also re-run on the work dirs: Sintel 2 audio + Captions, Rich captions,
Description text; Tears of Steel 2 audio + Captions, Description text); master.m3u8 and the VTTs downloaded from CloudFront after
the invalidation are byte-identical to the work dirs (and an `audio_ad/5.m4s` segment of each); no description cue starts with a
lowercase word; no "Darkness." prefix before visible content; no `[footsteps]` or `[Name]` anywhere. `GET /catalog` (API started
locally on a spare port) lists all five titles; badges: Sintel `ad sdh extended`, Tears of Steel `ad extended` (was `sdh`).

| Title | Description cues (extended) before → after | Rich captions before → after | What changed |
|---|---|---|---|
| sintel-90-150-r2 | 11 (2) → 11 (2) | omitted → **present**, 12 cues (11 captions + `[broth pours]` at 0:33.170, from "Old man pours broth.") | d4 "Darkness. A faint fire glows in a stone pit." → "A faint fire glows in a stone pit."; the last cue, a bare "Darkness.", is now "Faint red sparks drift downward." (its "Darkness." prefix stripped); new d5 "Fire burns." (0:15.3); "A figure leans forward." no longer voiced; d3 "The figure falls. The logo fades. Snow covers the motionless body." → "Snowy mountains. A figure walks, falls. Logo fades." (the edit was rejected this time, so "Snowy mountains." repeats d2); "Red-haired woman stares intently forward." dropped (465 ms over) |
| tears-of-steel-40-100 | 15 (3) → 15 (5) | 5 cues with the invented `[footsteps]` and `[Name] This is pretty freaky.` → **omitted** (degraded: no evidenced addition); captions 4 | "Darkness. in metallic silver, centered." is gone: the title is now its own cue "Words appear: TEARS OF STEEL." (0:27.904); the headline is **spoken** as an extended pause `Words appear: "Dr Amstelwijk ROBOTICIST CREATES KILLER ROBOTS"` (0:41.629, was dropped; "Dr Amstelwijk" not checked against the frame); no "Darkness." prefix anywhere (d10 is "Ship deck. Figure kneels beside prone bodies."; the airship cue starts "A dark, complex airship …"); new extended "Words appear: MEMORY PLAYBACK - GLOBAL" (0:07.514); d1 drops "Day. A bridge." for "… standing on a bridge over a canal." **New fault**: "SIMULATION READY... LOCKED." is split at the ellipsis — the pause says "Words appear: SIMULATION READY..." and the AD track voices "LOCKED. Two people at glowing tech tables." (`sentences()` in `textClause.ts` ends the bare text at "..."; not fixed) |

S3 clean-up: deleted `published/tears-of-steel-40-100/sdh.m3u8`, `sdh.vtt` and `sdh/1.vtt`–`sdh/6.vtt` (8 objects) after the new
master.m3u8 showed no `sdh` reference; CloudFront now answers 403 for them. The Sintel `sdh.vtt`, `sdh.m3u8` and `sdh/` listed as stale
below are live again (this run overwrote all 15 segments and the master names them), so they were not deleted. Still unreferenced
and left in S3: `published/tears-of-steel-40-100/descriptions/16.vtt` (the old run had one more segment) and the previous run's
`cues/cue_*.<hash>.mp3` clips whose hash changed (immutable keys, nothing points at them).

## Re-run after #41 and #42 (2026-10-14)

tears-of-steel-40-100 `--from fit` (its work dir was on this machine this time; voice Matthew, same source), so #41 (on-screen
text is not cut at an ellipsis) and #42 (no voice spans in published caption VTTs) reach the published title. Cost **$0.0119**
(edit $0.0002, voice $0.0117; no describe or Transcribe call).

- d5/d6 before → after: the pause "Words appear: SIMULATION READY..." (0:16.885) and the AD cue "LOCKED. Two people at glowing
  tech tables." (0:17.285) → the pause "Words appear: SIMULATION READY... LOCKED." (0:16.635, extended, 5 words) and the AD cue
  "Two people at tables." (0:17.035–0:18.379). fit now keeps the whole description as one cue and shortened its action clause
  to fit the slot ("glowing tech" dropped); 06-voice split the text clause off as before.
- No other cue changed: the edit pass revised 0 of 14 cues and rejected one edit (d2 "Words show: 40 YEARS LATER.": on-screen
  text clause changed), so descriptions.vtt differs from the previous run only in d5 and d6. The headline pause (d11, 0:41.629,
  extended) is unchanged.
- captions.vtt and captions/1.vtt–6.vtt carry no `<v ` tags (the previous captions.vtt had `<v spk_0>`, `<v spk_1>`, `<v spk_2>`);
  the caption text is otherwise unchanged, 4 cues.
- Rich captions: still omitted. This time not for lack of evidence: Nova Lite answered the SDH window c1–c4 with
  `ModelErrorException` ("Model produced invalid sequence as part of ToolUse") twice, so the window stayed plain and sdh.json is
  `{"degraded":true}`. No `sdh*` object in S3; CloudFront answers 403 for sdh.vtt and sdh.m3u8. The local sdh.vtt has no
  `[footsteps]` and no `[Name]`.
- Checks: `validate` reported no problems (2 audio + Captions, Description text); master.m3u8 names no sdh; descriptions.vtt and
  captions.vtt from CloudFront after the invalidation are byte-identical to the work dir; the new clips `cue_4.ecbc0d77bffd.mp3`,
  `cue_5.53740ac99339.mp3` and `audio_ad/5.m4s` answer 200; no description cue starts lowercase, none is a bare "LOCKED.", no
  "Darkness." prefix. DB: the title's 15 DescriptionCue rows and both TextTrack rows (captions 4 cues, descriptions 15) were
  replaced (new ids), status published, voice Matthew.

Pipeline-side notes from these runs (not fixed here):
- ~~Captions and Rich captions carry Transcribe's speaker labels as WebVTT voice spans (`<v spk_0>`), as before; valid VTT, and the
  speaker tag rule only adds a name when one is spoken, but a renderer that shows voice names would show "spk_0".~~ The app is such a
  renderer: the kit's parseVtt reads `<v spk_0>` as the cue's speaker and CueOverlay draws "[spk_0] " before the line (Fire OS and Vega
  both render text through CueOverlay). Fixed in 08-text (`textTrackVtt`): published VTTs carry no voice spans; a name the SDH rules
  accept stays the leading "[Name] " of the Rich captions text. Titles published before the fix are rewritten in place with
  `pnpm pipeline strip-voices <slug…> --run` (caption and Rich captions VTTs and their HLS segments only, then one
  `/published/<slug>/*` invalidation); on sintel-90-150-r2 its output is byte-identical to a local `--from text` re-run.
- Work dirs are not kept anywhere durable: a `--from fit` re-run needs the machine the title was run on. Uploading
  `described.json` (and `shots.json`) to `work/<slug>/` in S3 would make these re-runs restorable.

Fixed after review (2026-10-14, PR #33):
- Cue ends in film time (`packages/pipeline/src/cues.ts` `filmEnds`): an extended cue's end from 06-voice is start + clip
  length, but the film is paused while that clip plays, so it overlapped the next cue (Tears of Steel d7 26.004–28.116 over d8
  26.404–29.524: the text pause sits TEXT_LEAD_MS = 400 ms before its action cue by design; d1 over d2 the same way) and could end
  after the film (Tears of Steel d15 at 1:02.862, Elephants Dream d7 at 1:01.858, on 60.0 s titles). descriptions.vtt and the
  DescriptionCue rows now end an extended cue by the next cue's start and every cue by the title's end (probe.json). The kit's
  parseVtt already trimmed the overlap on the device; the end past the film was in the file and the rows. Elephants Dream and
  Tears of Steel re-run `--from text`.
- 10-publish uploads only the text tracks 09-package advertised: a degraded sdh.vtt has no TextTrack row and is no longer
  published. The ones uploaded before the fix stay in S3, unreferenced by any master (delete by hand:
  `published/{big-buck-bunny-0-60,elephants-dream-0-60,caminandes-35-95}/sdh.vtt`, `published/caminandes-35-95/captions.vtt`).
  Also left over: `published/sintel-90-150-r2/sdh.vtt`, `sdh.m3u8` and its 15 segments under `sdh/`, from the 2026-10-04 run
  (checked with `aws s3 ls` on 2026-10-14; the current master.m3u8 does not name them). Harmless: no master references them, so
  no player requests them; delete by hand with the others. *Update:* the Sintel re-run after #39 publishes Rich captions again, so its
  `sdh.vtt`, `sdh.m3u8` and `sdh/` are current and must stay.

Follow-ups from this batch (not fixed before the freeze):
- ~~08-text: a Nova Lite `ModelErrorException` (424) fails the SDH step; SDH is not repeatable~~ — fixed (claude/desc-010-sdh-fixes):
  the 424 is retried once, then the window stays plain and the title is marked degraded; replies are cached per window
  (`work/{slug}/cache/sdh/`) and decoded greedily (temperature 0 plus `topK` 1; temperature 0 alone gave two different replies to one
  request), so a `--from text` re-run gives the same SDH.
- 06-voice: when a text clause is split off, drop the clause's trailing modifier ("in metallic silver, centered") with it instead of voicing it alone. **Fixed** (0008): the modifier is part of the clause and goes into the text pause; re-run done (2026-10-14, see "Re-runs after #37 and #39").
- Describe prompt / textClause: on-screen text the model reports as `headline: "…"` or `sign reads …` is not recognised as a text clause, so it can be dropped rather than paused on. **Fixed** (0008): recognised (headline:, … reads, a quoted caption or title card), and the prompt asks for "Words appear:"; re-run done — the Tears of Steel headline is now spoken.
- Describe: "Darkness." should be the whole line or absent — a dark frame that still shows something is not darkness. **Fixed** (0008): a "Darkness." prefix is stripped in describe and fit, and the prompt says "Darkness." only when nothing is visible (Gate C to re-check); re-run done (Sintel, Tears of Steel).
- SDH degraded on all four titles with speech ("no window added anything"). Cause (claude/desc-010-sdh-fixes, 6 Nova Lite calls,
  $0.0009): Nova Lite sees only the captions and the visual descriptions, so it returned sights as sounds ("fire glows", "bearded man
  holds", zero length, no brackets) and voice labels or placeholders as names ("[spk_1]", "[Name]"); the merge rightly dropped all of
  it. The Tears of Steel re-run that "added" cues published an invented "[footsteps]" (the description there is "A man gestures") and a
  literal "[Name] This is pretty freaky.". Now every addition needs evidence: a sound needs a description within 2 s that names its
  source or action and audible audio over its span (ffmpeg ebur128 momentary loudness ≥ −55 LUFS on mezz.mp4); a speaker tag needs a
  name spoken in the dialogue, one name per voice. With that, Sintel gets "[broth pours]" (33.2 s, "Old man pours broth.") and Rich
  captions; Big Buck Bunny, Elephants Dream and Tears of Steel have no description of anything that makes a sound and stay without
  Rich captions — honest SDH for them needs audio-event data we do not have (feature-requests P1). Re-run `--from text` for
  sintel-90-150-r2 (gains Rich captions) and tears-of-steel-40-100 (its published Rich captions hold the invented cues and lose them).
  The "sdh" badge now follows the TextTrack row (#35).
  Review of #38 tightened the evidence: the agent ("man", "robot") is not evidence of a sound, and the sound word itself must be in the
  description, or be a sound that a described source or action always makes (`SOURCE_SOUNDS`: "A fire burns" → [fire crackling], "walks" →
  [footsteps]), so "[tent rustles]" beside "The tent glows" is dropped; a speaker name must be said in another caption by another voice
  (a name in the tagged line itself is usually the listener: "Sintel, run!").
  Known limits and clean-up:
  - `SOUND_WORDS` and `SOURCE_SOUNDS` are English only: a `de` title gets no sound cues until German sound words are added.
  - The SDH cache (`work/{slug}/cache/sdh/`) replays a valid-but-wrong reply for as long as the input is unchanged; delete that
    directory to sample Nova Lite again.
  - ~~After the Tears of Steel re-run, delete the stale Rich captions objects by hand: `published/tears-of-steel-40-100/sdh.vtt`,
    `sdh.m3u8` and the 6 segments under `sdh/` (checked with `aws s3 ls` on 2026-10-14; no master names them once 09-package omits
    the track).~~ Done 2026-10-14 (8 objects deleted; see "Re-runs after #37 and #39"). The Sintel re-run `--from text` is superseded by its `--from fit` re-run, which published Rich captions.
  - Follow-up idea, not built: an onset rule (momentary loudness jumping 6–10 LU above the short-term level) would be stronger evidence
    of a discrete sound than the −55 LUFS audibility floor, which a music bed also passes.
- The six `grid-test-*` filler rows from the 2026-10 device run are still published (poster-less, no stream, "Test row." in About).
  They come only from docs/device-checks/RUN-2026-10.md §17 (`POST /admin/titles`, then a manual `UPDATE … status='published'`); its §18
  clean-up was not run. A fresh seed cannot create them: prisma/titles.json has the five films only, and `TitleSeed` rejects a
  non-CC-BY licence and a source key outside `sources/*.mp4`. Remove them with §18:
  `psql -h /tmp -U postgres described -c "DELETE FROM \"Title\" WHERE slug LIKE 'grid-test-%';"` (list and progress rows cascade).
