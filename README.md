# Described

**Audio description and rich captions for video that has none — on Fire TV.**

- **Why:** most video has no audio description, so blind and low-vision viewers miss what is on screen between the lines.
- **What:** press Play and narration is already on; Menu → Audio: Original to hear the difference; Extended mode pauses the film when there's more to say.
- **For whom:** blind and low-vision viewers, and (with rich captions) deaf and hard-of-hearing viewers. Video: TODO(DESC-012) link · screenshots: [docs/screens](docs/screens/README.md).

Qwen3-VL on Amazon Bedrock describes each shot, Nova Lite fits the words into the gaps between dialogue, Polly speaks them,
ffmpeg ducks the soundtrack, and the narration arrives through the player's own audio-track selection as a second audio
rendition. Extended mode pauses the film when there's more to say than the gap allows (WCAG 1.2.7). Description is **on by default**.

Built for the [Build, Ship, Shape: Amazon Developer Hackathon](https://amazonappdev2026.devpost.com/) — Fire TV track,
AWS Builder and Open Source mini-challenges. Shares [`@moizp/vega-media-kit`](https://github.com/moiz-lakkadkutta/vega-media-kit)
with [Lingo](https://github.com/moiz-lakkadkutta/lingo). MIT.

> Described is machine-drafted description for the long tail that has none. It follows the Netflix, Prime Video and DCMP
> description style rules. Human-authored description remains the gold standard.

## Try it

The release APK talks to a hosted copy of the API (AWS Lambda + Amazon RDS in us-east-1, [docs/aws.md](docs/aws.md#hosted-api-desc-034))
and streams from CloudFront, so it needs nothing on your network. Fire TV Stick, Fire OS 7 or later; a computer with
Android platform tools (`adb`) on the same Wi-Fi.

1. On the Fire TV: **Settings → My Fire TV → About**, select the device name seven times to show Developer options; then
   **Developer options → ADB debugging: On** (and **Apps from Unknown Sources: On** on older Fire OS). Note the IP address
   under **Settings → My Fire TV → About → Network**.
2. Download `described-0.1.0.apk` from the [latest GitHub release](https://github.com/moiz-lakkadkutta/described/releases/latest).
3. Install and open it:
   ```sh
   adb connect <fire-tv-ip>:5555          # accept the "Allow USB debugging?" prompt on the TV
   adb install -r described-0.1.0.apk
   adb shell monkey -p dev.moizp.described 1   # or open Described from Your Apps & Channels
   ```

Five CC-BY titles are in the library; description is on by default. Prefs and My list are kept per device (Android ID), no sign-in.

<details><summary>Maintainers: host the API and publish the APK (DESC-034)</summary>

Each step below is paid or public: run it only with the owner's go-ahead.

```sh
set -a; source .env; set +a                      # CLOUDFRONT_DOMAIN: the media stack's CdnDomain
export ALERT_EMAIL=<you@example.com>             # USD 25/month budget + low-storage alarm emails (confirm both subscriptions)
cd infra && AWS_PROFILE=described-dev pnpm deploy:viewer && cd ..   # builds apps/api/dist-lambda, deploys described-viewer-dev, writes infra/cdk-outputs-viewer.json
pnpm --filter @described/api export:catalogue    # published titles from your DATABASE_URL → apps/api/.hosted/seed-event.json (no device data)
FN=$(node -p "require('./infra/cdk-outputs-viewer.json')['described-viewer-dev'].ApiFunctionName")
AWS_PROFILE=described-dev aws lambda invoke --region us-east-1 --function-name "$FN" \
  --payload fileb://apps/api/.hosted/seed-event.json /dev/stdout   # migrates, then imports; re-run after any re-publish
API=$(node -p "require('./infra/cdk-outputs-viewer.json')['described-viewer-dev'].ViewerApiUrl.replace(/\/$/, '')")
curl -s "$API/catalog" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).data.all.map(t=>t.slug)))"
pnpm --filter @described/expo build:apk -- --hosted   # → apps/expo/dist/described-0.1.0.apk (no device needed)
gh release create v0.1.0 apps/expo/dist/described-0.1.0.apk --title "Described 0.1.0 — Fire TV APK" \
  --notes "Sideload with adb (README, Try it). Uses the hosted API; media from CloudFront."
```

Remove it with `cd infra && AWS_PROFILE=described-dev npx cdk destroy described-viewer-dev -c viewer=1 -c stage=dev`
(the database goes with it; the catalogue can be re-seeded, device prefs and lists cannot).
</details>

## What you get on the TV

- **Home, Title, Described, My list, Settings** — the whole app works with the D-pad, **Select**, **Back** and **Menu**; every
  control has a VoiceView label; focus is an outline plus a 1.04 scale, never colour alone.
- **Player** with a persistent status line ("Description on · Joanna · Rich captions") and a track sheet on **Menu**:
  Audio — Original / Audio description; Captions — Off / Captions / Rich captions / Description text; Extended mode.
- **Audio switch** fades down, switches, holds silent for 150 ms across ExoPlayer's decoder reset, and fades up (≈ 450 ms,
  `crossfadeAudio` in `packages/shared-ui/src/playback.ts`).
- **Extended mode**: at an extended cue the film pauses, an ochre bar reads "Describing…", the cue's clip plays, the film resumes.
- **Fire TV bindings**: deep links `described://title/{slug}` and `described://play/{slug}?t=…`; remote media keys and Alexa
  transport ("Alexa, pause / resume / fast forward / rewind / restart"; the voice re-check of fast forward, rewind and restart
  is pending, TASKS.md DESC-008) through an Android MediaSession module; a draft Fire TV
  catalog feed at `GET /catalog/fire-tv.xml` (catalog integration is partner-only, [fire-os-bindings](docs/platform/fire-os-bindings.md)).

## How it works

```
                 packages/pipeline (pg-boss jobs, or the CLI in-process)
source mp4 (S3) ─▶ probe ─▶ shots ─▶ speech ─▶ describe ─▶ fit ─▶ edit ─▶ voice ─▶ mix ─▶ text ─▶ package ─▶ validate ─▶ publish
                                     Transcribe  Qwen3-VL    Nova Lite      Polly    ffmpeg  Nova Lite  Shaka     kit parsers   S3
                                                 (Bedrock)   (Bedrock)                       (SDH)      Packager
                                                                                                                    │
apps/expo (Fire OS) ─▶ packages/shared-ui ─▶ @moizp/vega-media-kit (KitPlayer, CueOverlay) ◀── HLS over CloudFront ┘
        │                                                                   /published/{slug}/master.m3u8
        └── apps/api (Express, Prisma, pg-boss, Postgres): catalog, title detail, prefs, progress, My list, cue audio
```

| # | Step | File | What it does |
|---|---|---|---|
| 1 | probe | `steps/01-probe.ts` | Download the source, normalise to H.264 ≤ 1920×1080 + stereo AAC with a keyframe every 4 s; poster and hero stills |
| 2 | shots | `steps/02-shots.ts` | ffmpeg scene cuts; merge < 1.5 s, split > 8 s (a split shot's later parts are asked only for what is new) |
| 3 | speech | `steps/03-speech.ts` | **Amazon Transcribe** word timings + speaker labels → dialogue spans → gaps ≥ 1.2 s; gaps split around speech Transcribe missed (local ffmpeg check, `gaps.vad.json`, off with `SPEECH_VAD=0`, [0014](docs/decisions/0014-unlabelled-speech.md)) |
| 4 | describe | `steps/04-describe.ts` | **Qwen3-VL 235B on Bedrock** (Converse), one call per shot with 3–6 key frames; per-shot cache ([0003](docs/decisions/0003-gate-c.md), [0005](docs/decisions/0005-describe-direct-bedrock.md)) |
| 5 | fit | `steps/05-fit.ts` | Place each description in a gap; **Nova Lite** shortens it, accepted only if it adds no content word; on-screen text is never shortened away; a dropped shot with a new plot event becomes an extended cue ([0007](docs/decisions/0007-dropped-events.md)) |
| 5b | edit | `steps/05b-edit.ts` | **Nova Lite** scene-level edit pass: fold dropped facts into the next cue, remove repetition, no new facts ([0006](docs/decisions/0006-scene-edit-pass.md)) |
| 6 | voice | `steps/06-voice.ts` | **Amazon Polly** neural, one MP3 per cue; the measured clip length sets the cue end; an overrun is shortened once, then becomes extended or is dropped |
| 7 | mix | `steps/07-mix.ts` | ffmpeg: duck the original −9 dB under narration (attack 10 ms, release 300 ms), loudness −24 LUFS / −2 dBTP → AD audio |
| 8 | text | `steps/08-text.ts` | `captions.vtt` (Transcribe), `sdh.vtt` (**Nova Lite** adds [sounds] and speaker tags, forced tool), `descriptions.vtt` (extended cues carry `{extended=1}`) |
| 9 | package | `steps/09-package.ts` | Shaka Packager → HLS master: two audio renditions (Original; Audio description with `CHARACTERISTICS="public.accessibility.describes-video"`) and up to three WebVTT tracks, aligned 4 s segments |
| 10 | validate | `src/validate.ts` | The master and every VTT parsed with vega-media-kit's `parseHlsMaster` / `parseVtt` ([0004](docs/decisions/0004-vega-deferred.md)) |
| 11 | publish | `steps/10-publish.ts` | Upload to S3 `published/{slug}/` (served by CloudFront); cue clips for Extended mode; optional CloudFront invalidation |

Steps 1–5 each run as their own pg-boss job (`pipeline-probe` … `pipeline-fit`); `pipeline-finish` runs edit → publish in one job
(`packages/pipeline/src/jobs.ts`). Each job records its cost (`Job.costUsd`). Services, Regions and cost per title: [docs/aws.md](docs/aws.md)
(≈ $0.05 per minute of film, estimate).

**On the TV**, the Player plays the HLS master through vega-media-kit's `KitPlayer` (react-native-video / ExoPlayer on Fire OS)
and draws captions with its `CueOverlay`. The AD rendition is just another audio track; extended cues come from
`GET /titles/:slug/descriptions.vtt`, and their clips from `GET /titles/:slug/cues/d{n}/audio` (a redirect to CloudFront).

**Platform:** Fire OS (Expo SDK 54, React Native 0.81, old architecture). Vega OS is deferred ([decision 0004](docs/decisions/0004-vega-deferred.md)):
`apps/vega` is a template that is not yet built; `packages/shared-ui` keeps to Vega-supported imports so the path stays open.

## Titles

| Title | Year | Published excerpt | Licence | Slug | Description cues |
|---|---|---|---|---|---|
| Sintel (© Blender Foundation) | 2010 | 1:30–2:30 (60 s) | CC-BY 3.0 | `sintel-90-150-r2` | 11, 2 extended |
| Big Buck Bunny (© Blender Foundation) | 2008 | 0:00–1:00 (60 s) | CC-BY 3.0 | `big-buck-bunny-0-60` | 9, 0 extended |
| Elephants Dream (© Blender Foundation / Netherlands Media Art Institute) | 2006 | 0:00–1:00 (60 s) | CC-BY 2.5 | `elephants-dream-0-60` | 7, 1 extended |
| Caminandes: Gran Dillama (© Blender Foundation) | 2013 | 0:35–1:35 (60 s) | CC-BY 3.0 | `caminandes-35-95` | 13, 0 extended |
| Tears of Steel (© Blender Foundation) | 2012 | 0:40–1:40 (60 s) | CC-BY 3.0 | `tears-of-steel-40-100` | 15, 3 extended |

All five described end to end by the pipeline on 2026-10-14, ≈ $0.05–0.06 each; sources, segments, costs and the faults found
in the descriptions: [docs/titles.md](docs/titles.md). Rows: `apps/api/prisma/titles.json` (`pnpm titles:seed`). The Gate C
evaluation also used Sintel 1:30–3:30 (`sintel-90-210`, 29 shots).

## Describe your own video

One command takes a video you own (a local file or an `https://` URL) to an audio-described HLS stream with captions, listed
in the app's catalogue. It prints an estimate and asks before it spends anything (`packages/pipeline/src/own.ts`).

1. Do steps 1, 2 and 6 of [Run it locally](#run-it-locally-7-steps) (install, Postgres, infra outputs in `.env`), then
   `set -a; source .env; set +a`. It needs `S3_BUCKET_MEDIA`, `CLOUDFRONT_DOMAIN`, `DATABASE_URL` and AWS credentials.
2. Check the estimate, with nothing spent: `pnpm describe ./film.mp4 --title "My Film" --dry-run`.
3. Optional: describe one part with `--start 1:30 --end 11:30`. Set the narration language and voice with
   `--language de --voice Daniel` (default `en`, Joanna). Set the licence and the credit sentence shown in the app with `--license "CC-BY 4.0" --credit "My Film © 2026 Me, CC-BY 4.0."`
   (defaults: "All rights reserved", "My Film. Described by Described.").
4. Run it: `pnpm describe ./film.mp4 --title "My Film"`, then answer `y` (or add `--yes`). It uploads the file (cut first when
   you give a span) to `sources/<slug>.mp4`, creates the Title row, runs every step from probe to publish, and writes the cue,
   rendition and text-track rows with status published.
5. It prints the measured cost and the stream: `https://$CLOUDFRONT_DOMAIN/published/<slug>/master.m3u8`. The title is on the
   app's Home row at the next `GET /catalog`.
6. If a step fails, the title is a draft (out of the catalogue) until a run finishes. The error prints what was spent and the
   `pnpm pipeline describe … --from <step>` line that resumes it. If only the database write fails, the line is `--from validate`,
   which makes no paid call.

Three rules protect titles that already exist:
- **Slug in use.** The slug comes from the title (`--slug` overrides it). A slug is refused if any of these is true:
  - a Title row already has it;
  - another title's source is `sources/<slug>.mp4`;
  - files are in S3 under that name with no Title row.

  `--replace` describes an existing title again. It sets the title back to draft while its files are rewritten, and keeps its
  licence and credit unless you pass `--license`/`--credit`. It needs `CLOUDFRONT_DISTRIBUTION_ID`, because segments are cached
  for a year and the old ones must be invalidated.
- **Longer than 15 minutes.** Describing more than 15 minutes of film needs `--long` until DESC-024 re-checks the describe
  prompt on a full-length title (TASKS.md).
- **Inputs.** An `https://` input must be the video file itself; playlists (`.m3u8`, `.mpd`) are refused.

### Cost per hour of film

**≈ $3.28 per hour of film ($3.08–3.52)**, list prices, from the CLI meter. This is not an AWS bill.

- Source: the five 60 s DESC-010 titles cost $0.0514–0.0586 each, $0.2731 for all five, so $0.0546 per minute on average
  ([docs/titles.md](docs/titles.md), "Measured cost per title"; the same rows are in `MEASURED_TITLES` in `packages/pipeline/src/cost.ts`).
- Transcribe: $0.024 per minute × 60 = **$1.44** per hour. This is exact. It is billed per second (15 s minimum) and does not
  depend on how much speech the film has.
- Everything else (Qwen3-VL, Nova Lite, Polly): ($0.2731 − 5 × $0.024) / 5 = $0.0306 per minute × 60 = **$1.84** per hour.
  The range is $0.0274 (Sintel) to $0.0346 (Caminandes) per minute, so $1.64–2.08 per hour.
- Total: $1.44 + $1.84 = **$3.28** per hour. A 90-minute feature comes to ≈ $4.92. `pnpm describe --dry-run` prints the same
  sum for your file.

Not everything scales with length:
- **Transcribe** is linear in seconds.
- **Qwen3-VL** is paid per shot (10–16 shots per minute measured), so a fast-cut film costs more per minute than a film of long takes.
- **Polly** is paid per character spoken, so it grows with the silence there is to describe. A dialogue-heavy film costs less, and every extended cue adds a clip.
- **Nova Lite** costs under $0.001 per minute.
- **Not in the figure:** S3 storage, CloudFront delivery, and the machine that runs ffmpeg and Shaka Packager.
- **Untested:** it is measured on 60 s open-movie segments only. No full-length film has been described yet, and the prices in `cost.ts` are still marked `TODO(price): verify`.

## Run it locally (7 steps)

Needs Node ≥ 22, pnpm 9, ffmpeg, Shaka Packager (`packager`) for the pipeline, Android platform tools (`adb`) for the stick,
and AWS credentials only for pipeline runs (they are paid; see [docs/aws.md](docs/aws.md)).
vega-media-kit is linked from a sibling checkout (`link:../vega-media-kit` in `package.json`), so clone it next to this repo.

1. **Install and configure**
   ```sh
   git clone https://github.com/moiz-lakkadkutta/vega-media-kit ../vega-media-kit
   pnpm i
   cp .env.example .env        # set ADMIN_TOKEN (the /admin routes answer 401 without it) and the infra outputs (S3_BUCKET_MEDIA, CLOUDFRONT_DOMAIN, …)
   ```
   Nothing loads `.env` by itself: run `set -a; source .env; set +a` in every terminal you use.
2. **Postgres.** `pnpm db:up` (Docker, Postgres 16, `docker-compose.yml`), or a local cluster when Docker is not available:
   ```sh
   PG=/opt/homebrew/opt/postgresql@14/bin
   $PG/initdb -U postgres --auth=trust ~/described-pg
   $PG/pg_ctl -D ~/described-pg -l ~/described-pg/log.txt -o "-p 5432 -k /tmp" start
   $PG/createdb -h /tmp -U postgres described
   ```
   Then `pnpm db:migrate`. When it creates or resets the database it also runs the title seed (`apps/api/package.json`
   `prisma.seed`), as `prisma migrate reset` always does: the five catalogue titles, drafts until the pipeline publishes them.
3. **API** — `pnpm api` (Express + Prisma + pg-boss; `GET /health`). It listens on port 4000 (`PORT` in `.env`). If 4000 is taken,
   set PORT and use the same port in EXPO_PUBLIC_API_URL. The stick must reach this port over the LAN.
4. **Pipeline worker** (optional) — `pnpm --filter @described/pipeline worker`. Create a title with `POST /admin/titles`
   (header `x-admin-token: $ADMIN_TOKEN`), then `POST /admin/titles/<id>/describe`; the worker marks it published when publish finishes.
   Or run it in-process: `pnpm pipeline describe --title <slug> --source s3://$S3_BUCKET_MEDIA/sources/<file>.mp4 [--lang de] [--from <step>]`
   (the CLI writes cue and track rows, durationS, voice and language, and marks the title published, in one transaction). No paid run without the owner's go-ahead (decision 0005).
5. **Release build on the stick** (the JS bundle is inside, so no Metro):
   ```sh
   adb connect <stick-ip>:5555 && adb shell input keyevent KEYCODE_WAKEUP
   cd apps/expo
   export EXPO_PUBLIC_API_URL=http://<mac-ip>:4000     # BEFORE prebuild: plugins/withLocalApi.js allows cleartext HTTP to this host only
   npx expo prebuild --clean --platform android
   git checkout package.json                            # if prebuild rewrote the scripts
   CI=1 npx expo run:android --variant release --no-bundler
   ```
   Without `EXPO_PUBLIC_API_URL` at prebuild, Android blocks the HTTP API and the app shows "Can't reach the library".
   Without a stick connected: `pnpm --filter @described/expo build:apk -- --url http://<mac-ip>:4000` does the same prebuild
   and writes `apps/expo/dist/described-<version>.apk` for `adb install -r` (`-- --hosted` builds against the hosted API, "Try it").
   A new IP needs both commands again. After dependency changes, run `pnpm install` and
   `rm -rf android/app/build/generated/assets android/app/build/intermediates/assets` (Gradle can reuse a stale JS bundle).
   `pnpm --filter @described/expo build:tv` (EAS) does not work while the kit is linked: EAS uploads only this repo.
   Full setup and checks: [docs/device-checks/RUN-2026-10.md](docs/device-checks/RUN-2026-10.md).
6. **Infra** — `cd infra && pnpm synth`, then `pnpm run deploy:stack described-media-dev -c stage=dev --outputs-file cdk-outputs.json`
   (one stack in eu-central-1: S3 + CloudFront + the pipeline role; Bedrock is called in us-east-1 with no stack there). Copy the outputs into `.env`.
7. **Checks** — `pnpm typecheck`, `pnpm test` (the API tests need `DATABASE_URL` exported), `pnpm lint:words`.

## Repo map

| Path | What |
|---|---|
| `apps/api` | Express 4 + Zod + Prisma + pg-boss + Socket.IO. Routes: `/catalog`, `/titles`, `/me` (prefs, progress, list), `/admin`, `/about`, `/prompts`. `API_MODE=viewer` (the hosted copy, `src/lambda.ts`) leaves out `/admin` |
| `apps/expo` | Fire OS app (Expo SDK 54): fonts, remote keys (`plugins/withKeyEvent.js`), cleartext plugin, `modules/described-media-session` (Kotlin) |
| `apps/vega` | Vega OS entry template (deferred, decision 0004) |
| `packages/shared-ui` | Every screen, focus, tokens (`src/theme/tokens.ts`), strings; Vega-supported imports only |
| `packages/contracts` | Zod schemas shared by api and ui (voices, prompt keys, prefs) |
| `packages/pipeline` | The media and description pipeline (machine-drafted description): steps, jobs, prompts, cost table, CLI and worker |
| `infra` | AWS CDK: `described-media-<stage>` (eu-central-1); `described-viewer-<stage>` (us-east-1, the hosted API for the release APK, `-c viewer=1`) |
| `docs` | [PLAN](docs/PLAN.md) · [decisions](docs/decisions) · [device checks](docs/device-checks) · [friction logs](docs/friction/README.md) · [AWS](docs/aws.md) · [feedback](docs/feedback.md) · [feature requests](docs/feature-requests.md) · [screens](docs/screens/README.md) · [platform](docs/platform/fire-os-bindings.md) |
| `TASKS.md` | Tickets and their state |

## Screens

TODO(DESC-011): screenshots from the stick — list and capture recipe in [docs/screens/README.md](docs/screens/README.md).

## Licences and credits

- Code: MIT ([LICENSE](LICENSE)).
- Font: Atkinson Hyperlegible (Braille Institute), SIL Open Font License 1.1, in `apps/expo/assets/fonts`.
- Films (one attribution sentence per published title, as the app's About & licenses screen shows them, `GET /about`):
  - Sintel © Blender Foundation, CC-BY 3.0. Described by Described.
  - Big Buck Bunny © 2008 Blender Foundation, CC-BY 3.0. Described by Described.
  - Elephants Dream © 2006 Blender Foundation / Netherlands Media Art Institute, CC-BY 2.5. Described by Described.
  - Caminandes: Gran Dillama © 2013 Blender Foundation (a Blender Institute production, www.caminandes.org), CC-BY 3.0. Described by Described.
  - Tears of Steel © 2012 Blender Foundation, CC-BY 3.0. Described by Described.

## What's new since Aug 31, 2026

Everything — the project started with the hackathon.
