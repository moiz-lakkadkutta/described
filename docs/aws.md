# AWS usage — Described

Every call, why it is load-bearing, and its approximate cost. Kept current; judges read this for the AWS Builder mini-challenge.

| Service | Region | Used for | Approx. cost |
|---|---|---|---|
| Amazon Bedrock — Qwen3-VL 235B (`qwen.qwen3-vl-235b-a22b`, Converse via `bedrock:InvokeModel`) | us-east-1 | Per-shot visual descriptions from 3–6 key frames (JPEG bytes, no video upload); won the Gate C bake-off ([0003](decisions/0003-gate-c.md)) | measured ≈ $0.03 per 29 shots / 2 min (61,495 input tokens, sintel-90-210) and $0.017–0.022 per 60 s title (10–16 shots, the DESC-010 batch, [titles](titles.md)); 12-min title ≈ 6 × 2 min → 6 × $0.03 ≈ $0.18, i.e. ≈ $0.15–0.20 depending on shot count |
| Amazon Bedrock — Nova Lite | us-east-1 | Shorten descriptions to fit dialogue gaps; the scene-level edit pass ([0006](decisions/0006-scene-edit-pass.md)); SDH captions (structured output via a forced tool) | measured $0.0002–0.0004 per 60 s title (edit + SDH) |
| Amazon Polly (neural) | eu-central-1 | Narration voice per title (`Title.voice`: Joanna, Matthew en-US; Vicki, Daniel de-DE) and the app's own prompt clips (`pnpm pipeline prompts --run`: 16 clips, $0.02 once) | measured $0.008–0.015 per 60 s title |
| Amazon Transcribe | eu-central-1 | Word-level dialogue timing → gap map; captions | $0.024/min, billed per second with a 15 s minimum → $0.024 per 60 s title (also with no speech), ~$0.30 per 12-min title |

Measured end to end (2026-10-14, the pipeline's own meter): **$0.052–0.059 per 60 s title**, $0.24 for the four-title batch plus the
prompt clips ([titles.md](titles.md)). Transcribe is the floor at $0.024; descriptions are the next third.
| Amazon S3 + CloudFront | eu-central-1 | Sources, renditions, HLS delivery to Fire TV. CloudFront serves only `/published/*` (default behaviour 403s via a CloudFront Function; bucket policy denies OAC reads elsewhere), so `work/` mezzanines and transcripts are not public; CORS preflights cached with Origin / Access-Control-Request-* in the key ([doc](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/header-caching.html#header-caching-web-cors)). Takes effect only after the human runs `cdk deploy` (`infra/lib/media-stack.ts`) | cents |
| Amazon CloudFront — CreateInvalidation | global | Invalidate `/published/{title}/*` by hand (console or `aws cloudfront create-invalidation`, `CLOUDFRONT_DISTRIBUTION_ID`) after a re-run republishes a title; the pipeline calls it itself when `PUBLISH_INVALIDATE=1` (PR #16), and the pipeline role is granted it on this distribution only ([API](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_CreateInvalidation.html)) | cents (one wildcard path per re-run) |
| AWS CDK | — | Infra as code (`infra/`) | — |

Infra as code: `infra/` (AWS CDK, TypeScript). Dev tooling: Claude Code, Kiro Crew, Amazon Devices Builder Tools MCP.
