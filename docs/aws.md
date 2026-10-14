# AWS usage — Described

Every call, why it is load-bearing, and its approximate cost. Kept current (main 788e973, 2026-10-14); judges read this for
the AWS Builder mini-challenge. Prices live in one table, `packages/pipeline/src/cost.ts`; each is marked `TODO(price): verify`
there until checked against the AWS pricing pages.

## Regions

- **eu-central-1 (Frankfurt):** S3, CloudFront origin, Transcribe, Polly — `AWS_REGION` (`.env.example`; default in
  `packages/pipeline/src/steps/03-speech.ts`, `06-voice.ts`, `src/s3.ts`).
- **us-east-1:** Bedrock — `BEDROCK_REGION` (`04-describe.ts`, `prompts.ts`). Qwen3-VL 235B is called in-Region there
  ([model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-vl-235b-a22b.html)). No stack is
  deployed in us-east-1. CloudFront's API (invalidations) is global and is called through us-east-1.

## Services

| Service | Region | Used for | Approx. cost |
|---|---|---|---|
| Amazon Bedrock — Qwen3-VL 235B (`qwen.qwen3-vl-235b-a22b`, Converse via `bedrock:InvokeModel`) | us-east-1 | Step 4, describe: one call per shot with 3–6 JPEG key frames (no video upload); per-shot cache so a retry or re-run does not pay twice ([0005](decisions/0005-describe-direct-bedrock.md)). Won the Gate C bake-off ([0003](decisions/0003-gate-c.md)) | measured $0.034 per 29 shots / 2 min of Sintel (0003 bake-off table; 61,495 input tokens on the confirmation run) → ≈ $0.017 per minute of film; measured $0.017–0.022 per 60 s title (10–16 shots, the five DESC-010 titles, [titles](titles.md)) |
| Amazon Bedrock — Nova Lite (`amazon.nova-lite-v1:0`, Converse) | us-east-1 | Step 5, fit: shorten a description to its dialogue gap (accepted only if it adds no content word and keeps the facts). Step 5b, edit: scene-level edit pass over the voiced cues, forced tool ([0006](decisions/0006-scene-edit-pass.md)). Step 8, text: rich captions (SDH) — sound cues and speaker tags, windows of ≤ 40 captions, forced tool, additions only (DESC-014) | ≈ $0.00016 per 30 cues for the edit pass (0006); fit and SDH calls are a few hundred tokens each: < $0.01 per title; measured $0.0002–0.0004 per 60 s title (edit + SDH, DESC-010) |
| Amazon Transcribe (`StartTranscriptionJob`, `GetTranscriptionJob`) | eu-central-1 | Step 3, speech map: word timings and speaker labels → dialogue spans → gaps where narration may speak; the plain captions track; known names for the describe prompt. A finished transcript is reused while the mezzanine is unchanged, and a started job is resumed on retry (`03-speech.ts`) | $0.024 / min (`cost.ts`, standard batch tier 1), billed per second with a 15 s minimum → $0.024 per 60 s title, also with no speech (Caminandes) |
| Amazon Polly (neural `SynthesizeSpeech`, MP3, SSML) | eu-central-1 | Step 6, voice: one clip per cue; the clip's measured length sets the cue end (DESC-013). App-voice prompt clips for first run and Settings "Hear it" (`pnpm pipeline prompts --run`, DESC-010). Description voice per title (default Joanna en-US, Vicki de-DE: `POLLY_VOICE_EN` / `POLLY_VOICE_DE`); app voices Joanna, Matthew, Vicki, Daniel | $16 per 1M characters (`cost.ts`); ≈ 400 characters per minute of film (estimate, `docs/device-checks/DESC-003.md`) → ≈ $0.006 / min; measured $0.008–0.015 per 60 s title (DESC-010). All 16 prompt clips $0.02 (1,232 characters, 2026-10-14) |
| Amazon S3 | eu-central-1 | Sources, `work/<slug>/` (mezzanine, transcript, key frames, caches) and `published/<slug>/` (HLS, VTTs, cue clips, art). Playlists, VTTs and art `max-age=60`; segments, init files and MP3s a year + immutable (`src/s3.ts` `cacheControl`) | cents |
| Amazon CloudFront | global (origin eu-central-1) | HLS delivery to the TV over HTTPS. Serves only `/published/*`: the default behaviour returns 403 from a CloudFront Function, and the bucket policy denies Origin Access Control reads outside `published/*`. CORS preflights cached with Origin / Access-Control-Request-* in the key ([doc](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/header-caching.html#header-caching-web-cors)) | cents |
| Amazon CloudFront — CreateInvalidation | global | Invalidate `/published/<slug>/*` after a re-run republishes a title: by hand (`aws cloudfront create-invalidation`, `CLOUDFRONT_DISTRIBUTION_ID`), or by the pipeline when `PUBLISH_INVALIDATE=1` (PR #16). The pipeline role may invalidate this distribution only ([API](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_CreateInvalidation.html)) | first 1,000 paths a month free, then $0.005 each; one wildcard path per re-run |
| AWS CDK | eu-central-1 | Infra as code (`infra/`) | — |

## Stacks (`infra/`)

One stack, `described-media-<stage>` (`infra/bin/app.ts`, `infra/lib/media-stack.ts`), in eu-central-1:

- S3 bucket `described-media-<stage>-<account>` (block public access, S3-managed encryption; destroyed with the stack except in `prod`).
- CloudFront distribution: `/published/*` behaviour (OAC, CORS with preflight, `CORS-S3Origin` origin request policy,
  price class 100); default behaviour a CloudFront Function that returns 403.
- `PipelineRole`: read-write on the bucket; `transcribe:StartTranscriptionJob`, `transcribe:GetTranscriptionJob`,
  `polly:SynthesizeSpeech`; `bedrock:InvokeModel` on two models only (Nova Lite foundation model and its `us.` inference profile,
  Qwen3-VL 235B), all in us-east-1; CreateInvalidation on this distribution.
- Outputs: `MediaBucket`, `CdnDomain`, `CdnId`, `PipelineRoleArn` → copy into `.env`.

The `described-nova-<stage>` stack (us-east-1, Nova video ingest for the old Nova Pro describe path) was removed from the CDK
app in PR #9 (DESC-015) and deleted from the account on 2026-10-04, with the Nova Pro, `InvokeModelWithResponseStream` and
ingest-bucket permissions.

```sh
cd infra && pnpm synth
AWS_PROFILE=<profile> pnpm run deploy:stack described-media-dev -c stage=dev --outputs-file cdk-outputs.json
```

## Cost per title

Cost is metered per pg-boss job (`Job.costUsd`, `packages/pipeline/src/cost.ts` `metered`) and printed per step by the CLI.
Every figure marked measured below is that meter: `src/cost.ts` list prices, unverified (each `TODO(price): verify`), times
the run's own usage — not an AWS bill. `Job.costUsd` stays empty on the CLI path (only the worker writes Job rows), so the CLI
figures come from its printed totals.

| Source | Figure |
|---|---|
| Measured (CLI meter): the five DESC-010 titles, 60 s each, 2026-10-14 | $0.0514 (Sintel re-run) – $0.0586 (Caminandes) per title; $0.293 for the five first runs and the prompt clips, plus $0.0003 for the `--from text` re-runs ([titles.md](titles.md)) |
| Measured (CLI meter): sintel-90-150-r2, CLI run 2026-10-04 (before DESC-017/018/020) | $0.0499 total |
| Measured: describe on 29 shots / 2 min (0003) | $0.034 Qwen3-VL |
| Per minute of film, from the prices in `cost.ts` | Transcribe $0.024 + describe ≈ $0.017 + Polly ≈ $0.006 + Nova Lite < $0.002 ≈ **$0.05** |
| Per minute, measured mean (DESC-025: `estimateUsd` in `cost.ts`, from the five titles' rows) | Transcribe $0.024 + Qwen3-VL $0.0191 + Polly $0.0112 + Nova Lite $0.0003 = **$0.0546** ($0.0514–0.0586) |
| 12-minute short | ≈ $0.66 |
| One hour of film | ≈ $3.28 ($3.08–3.52); derivation in the README, "Cost per hour of film" |
| 90-minute feature | ≈ $4.92 |

Extended cues add one Polly clip each (decision 0007: at most one added event cue per 30 s). Re-runs from a later step
(`--from`) reuse the transcript and the describe cache, so they pay only for the steps they re-run.
Measured end to end (2026-10-14, CLI meter): **$0.051–0.059 per 60 s title** across the five titles; Transcribe is the floor at
$0.024, descriptions the next third. That agrees with the ≈ $0.05 per minute estimate above.

Cost rule ([0005](decisions/0005-describe-direct-bedrock.md)): no paid Bedrock, Transcribe or Polly run without the human's
go-ahead; tests use recorded fixtures and mocks.

Dev tooling: Claude Code.
