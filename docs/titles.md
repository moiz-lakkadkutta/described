# Catalogue titles (DESC-010)

Five Blender open-movie segments, ≈ 60 s each, described end to end by the pipeline with its defaults (Qwen3-VL 235B from key
frames, Nova Lite edit pass on, extended cues for dropped plot events) and published on 2026-10-14. The rows live in
`apps/api/prisma/titles.json` (`pnpm titles:seed` upserts them by slug; the pipeline fills duration, art, cues, tracks and
status). Every film is CC-BY, and its credit sentence (`attribution`) is shown on the Title screen and under Settings → About &
licenses (`GET /about`), as CC-BY requires in-app.

| Slug | Film | Source (official Blender download) | Segment | Licence | Credit |
|---|---|---|---|---|---|
| `sintel-90-150-r2` | Sintel (Durian, 2010) | https://download.blender.org/demo/movies/ (Sintel 1080p) | 1:30–2:30 | CC-BY 3.0 | Sintel © Blender Foundation, CC-BY 3.0. |
| `big-buck-bunny-0-60` | Big Buck Bunny (Peach, 2008; 2013 "sunflower" re-render) | https://download.blender.org/demo/movies/BBB/bbb_sunflower_1080p_30fps_normal.mp4.zip | 0:00–1:00 | CC-BY 3.0 | Big Buck Bunny © 2008 Blender Foundation, CC-BY 3.0. |
| `elephants-dream-0-60` | Elephants Dream (Orange, 2006) | https://download.blender.org/ED/elephantsdream-1024-h264-st-aac.mov | 0:00–1:00 | CC-BY 2.5 | Elephants Dream © 2006 Blender Foundation / Netherlands Media Art Institute, CC-BY 2.5. |
| `caminandes-35-95` | Caminandes 2: Gran Dillama (Blender Institute, 2013) | https://download.blender.org/demo/movies/caminandes_gran_dillama.mp4.zip | 0:35–1:35 | CC-BY 3.0 | Caminandes: Gran Dillama © 2013 Blender Institute, CC-BY 3.0. |
| `tears-of-steel-40-100` | Tears of Steel (Mango, 2012) | https://download.blender.org/demo/movies/ToS/tears_of_steel_1080p.mov.zip | 0:40–1:40 | CC-BY 3.0 | Tears of Steel © 2012 Blender Foundation, CC-BY 3.0. |

Why these segments: Big Buck Bunny opens on its title card, a slow landscape pan and the rabbit waking (on-screen text, no
dialogue); Elephants Dream opens on two title cards and the machine chase with shouted lines (text, dialogue gaps, action);
Caminandes is slapstick with no dialogue at all (the whole minute is one gap); Tears of Steel carries three on-screen text
cards ("40 YEARS LATER", "SIMULATION READY", the title), a dialogue scene and VFX shots; Sintel is the Gate C segment (0003).

Tears of Steel: `ToS/copyright.txt` on download.blender.org is the CC-BY-ND 3.0 notice for the **soundtrack files** in
`Tears-Of-Steel-OST/`; the film itself is CC-BY 3.0 (© Blender Foundation, mango.blender.org). The segment is a clip of the film,
not of the OST release. Elephants Dream is the one CC-BY 2.5 title (its release licence).

How a segment is cut (the same for every title): `ffmpeg -ss <start> -i <film> -t 60 -map 0:v:0 -map 0:a:0 -c:v libx264 -crf 18
-pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart sources/<slug>.mp4`, uploaded to `s3://$S3_BUCKET_MEDIA/sources/`, then
`pnpm pipeline describe --title <slug> --source s3://$S3_BUCKET_MEDIA/sources/<slug>.mp4 --voice <Title.voice>`. The CLI writes
the rows and marks the title published itself (`persistForCli`), so no SQL step remains.

## Measured cost per title (2026-10-14, the pipeline's own meter, `src/cost.ts` prices)

| Title | Shots | Transcribe | Describe (Qwen3-VL) | Edit + SDH (Nova Lite) | Polly | **Total** |
|---|---|---|---|---|---|---|
| big-buck-bunny-0-60 | 11 | $0.0240 | $0.0198 | $0.0002 | $0.0112 | **$0.0553** |
| elephants-dream-0-60 | 10 | $0.0240 | $0.0197 | $0.0004 | $0.0080 | **$0.0521** |
| caminandes-35-95 | 14 | $0.0240 | $0.0218 | $0.0002 | $0.0125 | **$0.0586** |
| tears-of-steel-40-100 | 16 | $0.0240 | $0.0166 | $0.0004 | $0.0148 | **$0.0557** |
| app-voice prompt clips (`pnpm pipeline prompts --run`, 16 clips, 1,232 characters) | — | — | — | — | $0.0197 | **$0.0197** |
| **Batch** | | | | | | **≈ $0.24** (approved ≈ $5, cap $10) |

Transcribe is the floor: $0.024 for 60 s (billed per second, 15 s minimum) even when the clip has no speech (Caminandes). Every
title took 4–5 minutes wall clock, four in parallel with `DESCRIBE_CONCURRENCY=2`; no throttling.

## Validation (2026-10-14)

Per title: `validate` reported no problems; the manifest parsed with the kit's HLS and VTT parsers (two audio renditions,
Original and Audio description; text tracks as listed below); `master.m3u8`, `audio_ad.m3u8`, `captions.vtt`, `descriptions.vtt`,
`art/poster.jpg` and `art/hero.jpg` all answer 200 from CloudFront; `GET /catalog` lists all five with poster art and
`GET /about` lists the five credit sentences.

| Title | Description cues (extended) | Captions / Rich captions | Notes from reading descriptions.vtt |
|---|---|---|---|
| big-buck-bunny-0-60 | 9 (0) | 1 cue / omitted (SDH degraded: no additions) | clean; title card read as "Words appear: Big Buck Bunny."; "Darkness." at 0 ms dropped by voice (381 ms over its limit); the rabbit is "a large, dark figure" until it leaves the burrow, then "a large gray rabbit" |
| elephants-dream-0-60 | 7 (1) | 12 / omitted (degraded) | both title cards read ("the orange open movie project presents", "elephants dream"); 0:11–0:33 (the machine chase, shouted dialogue) has no cue — the gaps were too short; the last cue (19 words) is an extended pause |
| caminandes-35-95 | 13 (0) | none (no speech) / none | **invented details**: "a tan llama with sunglasses" (d2 — the llama has dark brow markings, no sunglasses), "an orange fox tumbles from a bridge" (d10 — it is the llama falling off the fence tower); the same animal is "tan llama", "brown llama", "orange fox" across cues (no stable descriptor); the electric flash becomes "Sun flares, then dims." |
| tears-of-steel-40-100 | 15 (3) | 4 / omitted (degraded) | all three text cards read ("40 YEARS LATER", "SIMULATION READY…", the title as an extended cue); **faults**: d8 "Darkness. in metallic silver, centered." is the fragment left after the title clause was split off (06-voice split, DESC-017); the newspaper headline cue ("Hand holds crumpled newspaper headline: ROBOTICIST CREATES KILLER ROBOTS") was **dropped** by voice (741 ms over) because it is not phrased as "Words appear:" and so was not split into a text pause; "Darkness." prefixes on d10 and d12 contradict the rest of the line ("Darkness. A mechanical airship … hovers"); d10 "a figure kneels beside a prone body, candles flicker" is unverified against the frame (a dark hideout interior) |

Follow-ups from this batch (not fixed before the freeze):
- 06-voice: when a text clause is split off, drop the clause's trailing modifier ("in metallic silver, centered") with it instead of voicing it alone.
- Describe prompt / textClause: on-screen text the model reports as `headline: "…"` or `sign reads …` is not recognised as a text clause, so it can be dropped rather than paused on.
- Describe: "Darkness." should be the whole line or absent — a dark frame that still shows something is not darkness.
- SDH degraded on three of four titles ("no window added anything"), so the Rich captions track is omitted; Caminandes has no speech, so it has no caption tracks at all. The "sdh" badge in `/catalog` is static (every title shows it).
- The six `grid-test-*` filler rows from the 2026-10 device run are still published (poster-less, no stream, "Test row." in About):
  `UPDATE "Title" SET status='draft' WHERE slug LIKE 'grid-test-%';` removes them from the catalogue once the grid no longer needs them.
