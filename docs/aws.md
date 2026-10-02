# AWS usage — Described

Every call, why it is load-bearing, and its approximate cost. Kept current; judges read this for the AWS Builder mini-challenge.

| Service | Region | Used for | Approx. cost |
|---|---|---|---|
| Amazon Bedrock — Qwen3-VL 235B (`qwen.qwen3-vl-235b-a22b`, Converse via `bedrock:InvokeModel`) | us-east-1 | Per-shot visual descriptions from 3–6 key frames (JPEG bytes, no video upload); won the Gate C bake-off ([0003](decisions/0003-gate-c.md)) | measured ≈ $0.03 per 29 shots / 2 min (61,495 input tokens, sintel-90-210); 12-min title ≈ 6 × 2 min → 6 × $0.03 ≈ $0.18, i.e. ≈ $0.15–0.20 depending on shot count |
| Amazon Bedrock — Nova Lite | us-east-1 | Shorten descriptions to fit dialogue gaps; SDH captions (structured output via a forced tool) | cents per title |
| Amazon Polly (neural) | eu-central-1 | Narration voice (Vicki de-DE, Joanna en-US) | cents per title |
| Amazon Transcribe | eu-central-1 | Word-level dialogue timing → gap map; captions | ~$0.024/min → ~$0.30 per title |
| Amazon S3 + CloudFront | eu-central-1 | Sources, renditions, HLS delivery to Fire TV. CloudFront serves only `/published/*` (default behaviour 403s via a CloudFront Function; bucket policy denies OAC reads elsewhere), so `work/` mezzanines and transcripts are not public; CORS preflights cached with Origin / Access-Control-Request-* in the key ([doc](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/header-caching.html#header-caching-web-cors)). Takes effect only after the human runs `cdk deploy` (`infra/lib/media-stack.ts`) | cents |
| Amazon CloudFront — CreateInvalidation | global | Invalidate `/published/{title}/*` by hand (console or `aws cloudfront create-invalidation`, `CLOUDFRONT_DISTRIBUTION_ID`) after a re-run republishes a title; the pipeline does not call it ([API](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_CreateInvalidation.html)) | cents (one wildcard path per re-run) |
| Amazon S3 — Nova ingest bucket (`described-nova-${stage}` stack) | us-east-1 | Unused since 2026-10-02 (Nova Pro read shot clips by S3 URI); removal pending (DESC-015) | — |
| AWS CDK | — | Infra as code (`infra/`) | — |

Infra as code: `infra/` (AWS CDK, TypeScript). Dev tooling: Claude Code, Kiro Crew, Amazon Devices Builder Tools MCP.
