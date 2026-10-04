# Described

**Audio description and rich captions for video that has none — on Fire TV.**
Qwen3-VL on Amazon Bedrock describes each shot, Nova Lite fits the words into the gaps between dialogue, Polly speaks them, ffmpeg ducks the
soundtrack, and the narration arrives through Fire TV's own audio-track selector as a second audio rendition. Extended mode
pauses the film when there's more to say than the gap allows (WCAG 1.2.7). Description is **on by default**.

Built for the [Build, Ship, Shape: Amazon Developer Hackathon](https://amazonappdev2026.devpost.com/) — Fire TV track,
AWS Builder and Open Source mini-challenges. Shares [`@moizp/vega-media-kit`](https://github.com/moiz-lakkadkutta/vega-media-kit)
with [Lingo](https://github.com/moiz-lakkadkutta/lingo). MIT. All demo content is CC-BY (Blender open movies, Internet Archive).

> Described is AI-drafted description for the long tail that has none. It follows the Netflix, Prime Video and DCMP
> description style rules. Human-authored description remains the gold standard.

## Run it (≤ 10 steps)
1. `pnpm i` · `cp .env.example .env` · `pnpm db:up` · `pnpm db:migrate`
2. `pnpm api` — Express + Prisma + pg-boss on :4000 (`GET /health`)
3. `pnpm expo` — Fire OS app (Expo SDK 54). Connect the stick: `adb connect <ip>`, press `a`.
4. Vega: experimental and deferred ([decision 0004](docs/decisions/0004-vega-deferred.md)). `apps/vega` is a template, not
   yet built or run; the shipping app is Fire OS.
5. Process a title: `pnpm pipeline describe --title sintel --source s3://…/sintel.mp4` (needs AWS creds; see `docs/aws.md`).
6. Infra: `cd infra && pnpm synth` / `cd infra && pnpm run deploy:stack --all -c stage=dev --outputs-file cdk-outputs.json` (one stack: S3 + CloudFront in eu-central-1; Bedrock is called in us-east-1 without a stack there; copy the outputs into `.env`).

## Architecture
```
apps/vega · apps/expo ─▶ packages/shared-ui ─▶ @moizp/vega-media-kit (KitPlayer, CueOverlay, platform)
                                │                            │ HLS over CloudFront
                                ▼                            ▼
                  apps/api (Express, Prisma, pg-boss)   S3 /published/{title}/master.m3u8
                                │ 'describe' job                  audio: main + AD · text: captions, sdh, descriptions
                                ▼
                  packages/pipeline: probe → shots → speech map → describe (Qwen3-VL, Bedrock) → fit (Nova Lite)
                                    → voice (Polly) → mix (ffmpeg duck) → text (SDH) → package (Shaka Packager) → publish
```
Full plan: [docs/PLAN.md](docs/PLAN.md). Tickets: [TASKS.md](TASKS.md). AWS usage: [docs/aws.md](docs/aws.md). Friction logs: [docs/friction](docs/friction).

## What's new since Aug 31, 2026
Everything — the project started with the hackathon.
