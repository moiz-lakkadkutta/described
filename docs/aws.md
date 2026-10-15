# AWS usage — Described

Every call, why it is load-bearing, and its approximate cost. Kept current (main 788e973, 2026-10-14); judges read this for
the AWS Builder mini-challenge. Prices live in one table, `packages/pipeline/src/cost.ts`; each is marked `TODO(price): verify`
there until checked against the AWS pricing pages.

## Regions

- **eu-central-1 (Frankfurt):** S3, CloudFront origin, Transcribe, Polly — `AWS_REGION` (`.env.example`; default in
  `packages/pipeline/src/steps/03-speech.ts`, `06-voice.ts`, `src/s3.ts`).
- **us-east-1:** the hosted API for the release APK (stack `described-viewer-<stage>`, DESC-034; see "Hosted API" below).
  Bedrock — `BEDROCK_REGION` (`04-describe.ts`, `prompts.ts`). Qwen3-VL 235B is called in-Region there
  ([model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-vl-235b-a22b.html)). CloudFront's API (invalidations) is global and is called through us-east-1.

## Services

| Service | Region | Used for | Approx. cost |
|---|---|---|---|
| Amazon Bedrock — Qwen3-VL 235B (`qwen.qwen3-vl-235b-a22b`, Converse via `bedrock:InvokeModel`) | us-east-1 | Step 4, describe: one call per shot with 3–6 JPEG key frames (no video upload); per-shot cache so a retry or re-run does not pay twice ([0005](decisions/0005-describe-direct-bedrock.md)). Won the Gate C bake-off ([0003](decisions/0003-gate-c.md)) | measured $0.034 per 29 shots / 2 min of Sintel (0003 bake-off table; 61,495 input tokens on the confirmation run) → ≈ $0.017 per minute of film; measured $0.017–0.022 per 60 s title (10–16 shots, the five DESC-010 titles, [titles](titles.md)); **verify pass** (DESC-027, [0010](decisions/0010-verify-pass.md)): one more call per shot, same frames + draft (≈ 2,430 input / 40 output tokens, estimated) ≈ $0.0014 per shot → ≈ **+$0.020 per minute** of film (describe + verify ≈ $0.037 / min); cached per shot in `cache/verify/`, off with `DESCRIBE_VERIFY=0` |
| Amazon Bedrock — Nova Lite (`amazon.nova-lite-v1:0`, Converse) | us-east-1 | Step 5, fit: shorten a description to its dialogue gap (accepted only if it adds no content word and keeps the facts). Step 5b, edit: scene-level edit pass over the voiced cues, forced tool ([0006](decisions/0006-scene-edit-pass.md)). Step 8, text: rich captions (SDH) — sound cues and speaker tags, windows of ≤ 40 captions, forced tool, additions only (DESC-014) | ≈ $0.00016 per 30 cues for the edit pass (0006); fit and SDH calls are a few hundred tokens each: < $0.01 per title; measured $0.0002–0.0004 per 60 s title (edit + SDH, DESC-010) |
| Amazon Transcribe (`StartTranscriptionJob`, `GetTranscriptionJob`) | eu-central-1 | Step 3, speech map: word timings and speaker labels → dialogue spans → gaps where narration may speak; the plain captions track; known names for the describe prompt. A finished transcript is reused while the mezzanine is unchanged, and a started job is resumed on retry (`03-speech.ts`) | $0.024 / min (`cost.ts`, standard batch tier 1), billed per second with a 15 s minimum → $0.024 per 60 s title, also with no speech (Caminandes) |
| Amazon Polly (neural `SynthesizeSpeech`, MP3, SSML) | eu-central-1 | Step 6, voice: one clip per cue; the clip's measured length sets the cue end (DESC-013). App-voice prompt clips for first run and Settings "Hear it" (`pnpm pipeline prompts --run`, DESC-010). Description voice per title (default Joanna en-US, Vicki de-DE: `POLLY_VOICE_EN` / `POLLY_VOICE_DE`); app voices Joanna, Matthew, Vicki, Daniel | $16 per 1M characters (`cost.ts`); ≈ 400 characters per minute of film (estimate, `docs/device-checks/DESC-003.md`) → ≈ $0.006 / min; measured $0.008–0.015 per 60 s title (DESC-010). All 16 prompt clips $0.02 (1,232 characters, 2026-10-14) |
| Amazon S3 | eu-central-1 | Sources, `work/<slug>/` (mezzanine, transcript, key frames, caches) and `published/<slug>/` (HLS, VTTs, cue clips, art). Playlists, VTTs and art `max-age=60`; segments, init files and MP3s a year + immutable (`src/s3.ts` `cacheControl`) | cents |
| Amazon CloudFront | global (origin eu-central-1) | HLS delivery to the TV over HTTPS. Serves only `/published/*`: the default behaviour returns 403 from a CloudFront Function, and the bucket policy denies Origin Access Control reads outside `published/*`. CORS preflights cached with Origin / Access-Control-Request-* in the key ([doc](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/header-caching.html#header-caching-web-cors)) | cents |
| Amazon CloudFront — CreateInvalidation | global | Invalidate `/published/<slug>/*` after a re-run republishes a title: by hand (`aws cloudfront create-invalidation`, `CLOUDFRONT_DISTRIBUTION_ID`), or by the pipeline when `PUBLISH_INVALIDATE=1` (PR #16). The pipeline role may invalidate this distribution only ([API](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_CreateInvalidation.html)) | first 1,000 paths a month free, then $0.005 each; one wildcard path per re-run |
| AWS Lambda + function URL (Node.js 22, arm64, 512 MB) | us-east-1 | The hosted API (DESC-034): Express in viewer mode (`apps/api/src/lambda.ts`) behind an HTTPS function URL, so the release APK needs no cleartext and no developer machine; `migrate` / `seed` operations by direct `aws lambda invoke` only ([function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html), [VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)) | $0.20 per 1M requests + $0.0000133 per GB-s (arm64); judging traffic stays inside the monthly free allowance (1M requests, 400,000 GB-s): ≈ $0 |
| Amazon RDS for PostgreSQL 17 (db.t4g.micro, single-AZ, gp3 20 GiB) | us-east-1 | The hosted copy's database: catalogue rows (seeded from the developer's published titles) and per-device prefs, progress, My list. Isolated subnets, reachable only from the function's security group ([RDS in a VPC](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html)) | $0.016 / h → $11.68 / month; gp3 $0.115 / GiB-month → $2.30; 1-day backups within the free backup allowance |
| AWS Secrets Manager | us-east-1 | The database password, generated at deploy; reaches the function as a CloudFormation dynamic reference, so no endpoint is needed at run time ([doc](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/dynamic-references-secretsmanager.html)) | $0.40 / month |
| AWS CDK | eu-central-1, us-east-1 | Infra as code (`infra/`) | — |

## Stacks (`infra/`)

One stack, `described-media-<stage>` (`infra/bin/app.ts`, `infra/lib/media-stack.ts`), in eu-central-1:

- S3 bucket `described-media-<stage>-<account>` (block public access, S3-managed encryption; destroyed with the stack except in `prod`).
- CloudFront distribution: `/published/*` behaviour (OAC, CORS with preflight, `CORS-S3Origin` origin request policy,
  price class 100); default behaviour a CloudFront Function that returns 403.
- `PipelineRole`: read-write on the bucket; `transcribe:StartTranscriptionJob`, `transcribe:GetTranscriptionJob`,
  `polly:SynthesizeSpeech`; `bedrock:InvokeModel` on four models only (Nova Lite foundation model and its `us.` inference profile,
  Qwen3-VL 235B, and for the narrative pass of decision 0017 DeepSeek v3.2 and its fallback Nova Pro), all in us-east-1; CreateInvalidation on this distribution.
- Outputs: `MediaBucket`, `CdnDomain`, `CdnId`, `PipelineRoleArn` → copy into `.env`.

The `described-nova-<stage>` stack (us-east-1, Nova video ingest for the old Nova Pro describe path) was removed from the CDK
app in PR #9 (DESC-015) and deleted from the account on 2026-10-04, with the Nova Pro, `InvokeModelWithResponseStream` and
ingest-bucket permissions.

```sh
cd infra && pnpm synth
AWS_PROFILE=<profile> pnpm run deploy:stack described-media-dev -c stage=dev --outputs-file cdk-outputs.json
```

## Hosted API (DESC-034)

`described-viewer-<stage>` (`infra/lib/viewer-stack.ts`), us-east-1, synthesised only with `-c viewer=1`:

- VPC with two isolated subnets: no NAT gateway, no internet gateway, no public IPv4 address (none of them billed).
- Lambda function `Api` (Node.js 22, arm64, 512 MB, 20 s), code `apps/api/dist-lambda` (`pnpm --filter @described/api build:lambda`: `prisma generate`, then
  esbuild bundle + Prisma's `linux-arm64-openssl-3.0.x` engine + `prisma/migrations`). `API_MODE=viewer`: `/admin` is not mounted.
  Function URL, auth type `NONE`: HTTPS, CORS from Express. Logs kept one week.
- RDS PostgreSQL 17 db.t4g.micro, single-AZ, 20 GiB gp3, encrypted, not public; ingress 5432 from the function's security group
  only. `DESTROY` on stack deletion outside `prod` (the catalogue is re-seeded; device prefs and lists are lost).
- Guards (review of PR #66): `x-device-id` must match `^[A-Za-z0-9_-]{1,64}$` (else 400, in both modes) and only writes create
  a Profile row (GET `/me/prefs` answers the defaults, GET `/me/list` an empty list), so a public URL cannot be made to
  store arbitrary strings; CloudWatch alarm `DbFreeStorageLow` below 2 GiB free; viewer mode logs only 4xx (warn) and 5xx
  (error) requests. With `alertEmail` (`-c alertEmail=…` or `ALERT_EMAIL`): an SNS topic emails the alarm, and an AWS
  Budgets cost budget of USD 25 a month for the **whole account** (pipeline runs included) emails at 80 % actual and 100 %
  forecast ([doc](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-create.html)). Without it, synth warns
  and neither the budget nor the topic is made. Confirm the two subscription emails AWS sends after the deploy.
- The database password is in the function's environment (resolved from Secrets Manager at deploy, shown in the Lambda
  console to anyone allowed `lambda:GetFunctionConfiguration`). Acceptable here: the database answers only the function's
  security group inside isolated subnets with no route from outside, so the password alone opens nothing; reading it at
  run time instead would need a Secrets Manager VPC endpoint (≈ $7.30 a month per AZ) or a NAT gateway (≈ $33), double the
  stack's cost. Environment variables are encrypted at rest with the Lambda service key.
- Outputs: `ViewerApiUrl` (the APK's API), `ApiFunctionName` (for `aws lambda invoke`), `DbEndpoint`.

No pg-boss, worker, Socket.IO, Bedrock, Polly or Transcribe in the hosted copy: it serves what the TV app reads, and
media stays on CloudFront. Seeding: `pnpm --filter @described/api export:catalogue` writes `{ "op": "seed", "catalogue": … }`
(Title, Asset, Rendition, TextTrack, DescriptionCue of published titles; no Profile, Progress, ListItem, Job, Shot, Gap);
`aws lambda invoke --payload fileb://…` runs the migrations and imports it in one transaction (titles matched by slug; a
hosted title missing from the export goes back to draft). Commands: README, "Try it".

| Hosted API, monthly (us-east-1, list prices from the AWS Price List API, 2026-10-15) | USD |
|---|---|
| RDS db.t4g.micro single-AZ PostgreSQL, $0.016 / h × 730 h | 11.68 |
| RDS gp3 storage, 20 GiB (the minimum) × $0.115 | 2.30 |
| Secrets Manager, one secret | 0.40 |
| CloudWatch alarm on FreeStorageSpace (one standard metric alarm) | 0.10 |
| Lambda requests and compute, function URL, CloudWatch Logs (4xx / 5xx only), data out | < 0.05 |
| SNS email alerts, AWS Budgets budget | 0 |
| VPC, subnets, security groups, backups (1 day, ≤ 20 GiB) | 0 |
| **Total** | **≈ 14.50** |

Why this shape (cheapest that answers the first request in time):

- Frankfurt, same setup: db.t4g.micro $0.019 / h and gp3 $0.137 / GiB → ≈ $16.60 a month. us-east-1 is cheaper and close to most
  judges; the API only returns JSON and redirects, so the media region does not matter.
- Aurora Serverless v2 with automatic pause (0 ACU): ≈ $0 idle, but a paused instance takes about 15 s to resume
  ([doc](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html)), longer than the
  app's 10 s `FETCH_TIMEOUT_MS`: a judge's first launch would show "Can't reach the library". Kept warm at 0.5 ACU it is
  $0.07 / h → ≈ $51 a month.
- App Runner instead of Lambda: still needs the same database, and bills provisioned memory around the clock.
- Aurora DSQL: no foreign keys or enum types, which the Prisma schema uses.
- The account's AWS Free Tier credits, if any are left, apply to these charges too; the figures above ignore them.

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
| Per minute, measured mean (DESC-025: `estimateUsd` in `cost.ts`, from the five titles' rows; measured before the verify pass — describe figures measured after DESC-027 include the verify call) | Transcribe $0.024 + Qwen3-VL $0.0191 + Polly $0.0112 + Nova Lite $0.0003 = **$0.0546** ($0.0514–0.0586) |
| Per minute with the verify pass (DESC-027, estimate) and the narrative pass (decision 0017, DeepSeek v3.2, measured on full-length Sintel); both in `estimateUsd` | $0.0546 + ≈ $0.020 + $0.0013 ≈ **$0.076** (generative voice: + $0.0098) |
| 12-minute short | ≈ $0.91 |
| One hour of film | ≈ $4.55 ($4.36–4.79); derivation in the README, "Cost per hour of film" |
| 90-minute feature | ≈ $6.83 |

Extended cues add one Polly clip each (decision 0007: at most one added event cue per 30 s). Re-runs from a later step
(`--from`) reuse the transcript and the describe cache, so they pay only for the steps they re-run.
Measured end to end (2026-10-14, CLI meter): **$0.051–0.059 per 60 s title** across the five titles; Transcribe is the floor at
$0.024, descriptions the next third. That agrees with the ≈ $0.05 per minute estimate above.

Cost rule ([0005](decisions/0005-describe-direct-bedrock.md)): no paid Bedrock, Transcribe or Polly run without the human's
go-ahead; tests use recorded fixtures and mocks.

Dev tooling: Claude Code.
