# DESC-003 — first paid run (needs the human's go-ahead)

Nothing in DESC-003 has called AWS: tests use stubs and the recorded `sintel-90-150` fixtures. This is the smallest real run
that exercises the new code paths: concurrent describe, the per-shot cache, known names, the fact-checked shortener and cost per step.

## Expected cost (Sintel 1:30–2:30, 60 s, ≈ 10 shots)

| Step | Service | Estimate |
|---|---|---|
| speech | Transcribe, 60 s at $0.024/min | $0.024 |
| describe | Qwen3-VL 235B, ≈ 2,100 input + 20 output tokens per shot (Gate C average) | ≈ $0.012 |
| fit | Nova Lite shortening, a few calls of ≈ 100 tokens | < $0.001 |
| finish | Nova Lite SDH (< $0.001) + Polly neural, ≈ 400 characters | ≈ $0.007 |
| **Total** | | **≈ $0.05** |
| Re-run from describe | cache hits: no Bedrock call for unchanged shots | $0 for describe |

Prices are in `packages/pipeline/src/cost.ts`; each is marked `TODO(price): verify` until checked against the AWS pricing pages.

## A. CLI, in-process (no Postgres, no pg-boss)

```sh
pnpm install && pnpm typecheck && pnpm test
# .env: AWS credentials for the dev account, S3_BUCKET_MEDIA, CLOUDFRONT_DOMAIN; DESCRIBE_CONCURRENCY=4
pnpm pipeline describe --title sintel-90-150-d3 --source s3://$S3_BUCKET_MEDIA/sources/sintel-90-150.mp4
```

Check:
- each paid step prints its cost (`speech: $0.0240`, `describe: $0.01…`, …) and a `total:` line ≈ $0.05;
- `describe: N shots, 0 from cache`, and `work/sintel-90-150-d3/cache/describe/` holds N `*.json` files;
- `work/sintel-90-150-d3/described.json` matches the Gate C confirmation run in style (no `SAME` voiced);
- any `fit: shortener changed a fact` warning in the log shows the deterministic text was used instead.

Then the cache:

```sh
pnpm pipeline describe --title sintel-90-150-d3 --source s3://$S3_BUCKET_MEDIA/sources/sintel-90-150.mp4 --from describe
```

Expect `describe: N shots, N from cache` and no `describe:` cost line (≈ $0.007 for the rest: Nova Lite + Polly).
`--from speech` instead prints `Transcribe skipped` (same mezzanine bytes and language) and costs nothing for speech; an
interrupted speech step resumes the Transcribe job named in `work/<slug>/transcribe.job.json` instead of starting another.

## B. Worker, one pg-boss job per step (Postgres needed)

```sh
pnpm db:up && pnpm db:migrate
pnpm --filter @described/pipeline worker          # creates the pipeline-* queues, then waits
pnpm api                                          # second terminal
curl -X POST localhost:4000/admin/titles -H "x-admin-token: $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"slug":"sintel-90-150-d3w","name":"Sintel (1:30–2:30)","license":"CC-BY 3.0","attribution":"Sintel © Blender Foundation, CC-BY 3.0.","sourceS3Key":"sources/sintel-90-150.mp4"}'
curl -X POST localhost:4000/admin/titles/<id>/describe -H "x-admin-token: $ADMIN_TOKEN"   # 202 { jobId }
```

Check in Postgres:

```sql
select step, status, "costUsd", "finishedAt" - "startedAt" as took, error from "Job" where "titleId" = '<id>' order by "startedAt";
select count(*) from "Shot" where "titleId" = '<id>';  select count(*) from "Gap" where "titleId" = '<id>';
select status from "Title" where id = '<id>';           -- published after the finish job
```

Six rows (probe, shots, speech, describe, fit, finish), all `done`; costs sum to ≈ $0.05 (a new slug, so a new
`work/` dir and no cache). A second POST while the title is processing answers 409 (`?force=1` overrides).
To see the dead-letter path without spending: stop the worker mid-step; after the queue's expiry and retries, the Job row
and the title read `failed` (`pipeline-failed` queue).
