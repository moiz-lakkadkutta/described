# AWS usage — Described

        Every call, why it is load-bearing, and its approximate cost. Kept current; judges read this for the AWS Builder mini-challenge.

        | Service | Region | Used for | Approx. cost |
        |---|---|---|---|
        | Amazon Bedrock — Nova Pro | us-east-1 | Per-shot visual descriptions from video (S3 URI) | ~$0.5–1 per 12-min title |
| Amazon Bedrock — Nova Lite | us-east-1 | Fit descriptions into dialogue gaps, shorten, SDH captions | cents per title |
| Amazon Polly (neural) | eu-central-1 | Narration voice (Vicki de-DE, Joanna en-US) | cents per title |
| Amazon Transcribe | eu-central-1 | Word-level dialogue timing → gap map; captions | ~$0.024/min → ~$0.30 per title |
| Amazon S3 + CloudFront | eu-central-1 (+ us-east-1 ingest) | Sources, renditions, HLS delivery to Fire TV | cents |
| Strands Agents (TypeScript) | — | Orchestrates the describe → fit → voice steps | — |
| AWS CDK | — | Infra as code (`infra/`) | — |

        Infra as code: `infra/` (AWS CDK, TypeScript). Dev tooling: Claude Code, Kiro Crew, Amazon Devices Builder Tools MCP.
