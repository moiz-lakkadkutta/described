# Described

**Audio description and rich captions for video that has none — on Fire TV.**
Qwen3-VL on Amazon Bedrock describes each shot, Nova Lite fits the words into the gaps between dialogue, Polly speaks them,
ffmpeg ducks the soundtrack, and the narration arrives through the player's own audio-track selection as a second audio
rendition. Extended mode pauses the film when there's more to say than the gap allows (WCAG 1.2.7). Description is **on by default**.

Built for the [Build, Ship, Shape: Amazon Developer Hackathon](https://amazonappdev2026.devpost.com/) — Fire TV track,
AWS Builder and Open Source mini-challenges. Shares [`@moizp/vega-media-kit`](https://github.com/moiz-lakkadkutta/vega-media-kit)
with [Lingo](https://github.com/moiz-lakkadkutta/lingo). MIT.

> Described is machine-drafted description for the long tail that has none. It follows the Netflix, Prime Video and DCMP
> description style rules. Human-authored description remains the gold standard.

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
| 3 | speech | `steps/03-speech.ts` | **Amazon Transcribe** word timings + speaker labels → dialogue spans → gaps ≥ 1.2 s |
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

TODO(DESC-010): the five published titles, filled in when the batch on `claude/desc-010` is merged.

| Title | Year | Length | Licence | Source | Extended cues |
|---|---|---|---|---|---|
| TODO(DESC-010) | | | | | |

Development and the device run used Sintel 1:30–2:30 (`sintel-90-150-r2`) and 1:30–3:30 (`sintel-90-210`).
Sintel © Blender Foundation, CC-BY 3.0.

## Run it locally

Needs Node ≥ 22, pnpm 9, ffmpeg, Shaka Packager (`packager`) for the pipeline, Android platform tools (`adb`) for the stick,
and AWS credentials only for pipeline runs (they are paid; see [docs/aws.md](docs/aws.md)).
vega-media-kit is linked from a sibling checkout (`link:../vega-media-kit` in `package.json`), so clone it next to this repo.

1. **Install and configure**
   ```sh
   git clone https://github.com/moiz-lakkadkutta/vega-media-kit ../vega-media-kit
   pnpm i
   cp .env.example .env        # set PORT=4100, ADMIN_TOKEN, and the infra outputs (S3_BUCKET_MEDIA, CLOUDFRONT_DOMAIN, …)
   ```
   Nothing loads `.env` by itself: run `set -a; source .env; set +a` in every terminal you use.
2. **Postgres.** `pnpm db:up` (Docker, Postgres 16, `docker-compose.yml`), or a local cluster when Docker is not available:
   ```sh
   PG=/opt/homebrew/opt/postgresql@14/bin
   $PG/initdb -U postgres --auth=trust ~/described-pg
   $PG/pg_ctl -D ~/described-pg -l ~/described-pg/log.txt -o "-p 5432 -k /tmp" start
   $PG/createdb -h /tmp -U postgres described
   ```
   Then `pnpm db:migrate`.
3. **API** — `pnpm api` (Express + Prisma + pg-boss; `GET /health`). The default port is 4000; the device runs used
   `PORT=4100`, because another project held 4000. The stick must reach this port over the LAN.
4. **Pipeline worker** (optional) — `pnpm --filter @described/pipeline worker`. Create a title with `POST /admin/titles`
   (header `x-admin-token: $ADMIN_TOKEN`), then `POST /admin/titles/<id>/describe`; the worker marks it published when publish finishes.
   Or run it in-process: `pnpm pipeline describe --title <slug> --source s3://$S3_BUCKET_MEDIA/sources/<file>.mp4 [--lang de] [--from <step>]`
   (the CLI writes cue and track rows but does not change the title's status). No paid run without the owner's go-ahead (decision 0005).
5. **Release build on the stick** (the JS bundle is inside, so no Metro):
   ```sh
   adb connect <stick-ip>:5555 && adb shell input keyevent KEYCODE_WAKEUP
   cd apps/expo
   export EXPO_PUBLIC_API_URL=http://<mac-ip>:4100     # BEFORE prebuild: plugins/withLocalApi.js allows cleartext HTTP to this host only
   npx expo prebuild --clean --platform android
   git checkout package.json                            # if prebuild rewrote the scripts
   CI=1 npx expo run:android --variant release --no-bundler
   ```
   Without `EXPO_PUBLIC_API_URL` at prebuild, Android blocks the HTTP API and the app shows "Can't reach the library".
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
| `apps/api` | Express 4 + Zod + Prisma + pg-boss + Socket.IO. Routes: `/catalog`, `/titles`, `/me` (prefs, progress, list), `/admin`, `/about`, `/prompts` |
| `apps/expo` | Fire OS app (Expo SDK 54): fonts, remote keys (`plugins/withKeyEvent.js`), cleartext plugin, `modules/described-media-session` (Kotlin) |
| `apps/vega` | Vega OS entry template (deferred, decision 0004) |
| `packages/shared-ui` | Every screen, focus, tokens (`src/theme/tokens.ts`), strings; Vega-supported imports only |
| `packages/contracts` | Zod schemas shared by api and ui (voices, prompt keys, prefs) |
| `packages/pipeline` | The media + AI pipeline: steps, jobs, prompts, cost table, CLI and worker |
| `infra` | AWS CDK: `described-media-<stage>` |
| `docs` | [PLAN](docs/PLAN.md) · [decisions](docs/decisions) · [device checks](docs/device-checks) · [friction logs](docs/friction/README.md) · [AWS](docs/aws.md) · [feedback](docs/feedback.md) · [feature requests](docs/feature-requests.md) · [screens](docs/screens/README.md) · [platform](docs/platform/fire-os-bindings.md) |
| `TASKS.md` | Tickets and their state |

## Screens

TODO(DESC-011): screenshots from the stick — list and capture recipe in [docs/screens/README.md](docs/screens/README.md).

## Licences and credits

- Code: MIT ([LICENSE](LICENSE)).
- Font: Atkinson Hyperlegible (Braille Institute), SIL Open Font License 1.1, in `apps/expo/assets/fonts`.
- Films: TODO(DESC-010) — one attribution sentence per published title, as the app's About & licenses screen shows them
  (`GET /about`). Development used Sintel © Blender Foundation, CC-BY 3.0.

## What's new since Aug 31, 2026

Everything — the project started with the hackathon.
