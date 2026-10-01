# bedrock account verification after upgrade

Task attempted: Continue the pipeline run right after upgrading the account from the Free plan to the Paid plan: the
describe step calls Amazon Bedrock Converse with Nova Pro (`amazon.nova-pro-v1:0`) in us-east-1.
Steps:
  1. Upgraded the account with `aws freetier upgrade-account-plan --account-plan-type PAID` (root user).
  2. Re-ran the pipeline; the Transcribe step (eu-central-1) now succeeded.
  3. The next step called Bedrock Converse with Nova Pro in us-east-1.
  4. Retried after ~10 min.
Expected: Once the upgrade returns, every service the Paid plan includes is usable, or the upgrade response says a
verification step is still pending.
Actual: 403 `AccessDeniedException: Your account is currently being verified. Verification normally takes less than 2
hours…` (request id a2e0be7d-0628-472e-8e41-fc07cb9cfed9), while Transcribe already worked on the same account. The
upgrade response and `aws freetier get-account-plan-state` gave no sign that verification was pending. The retry
~10 min later succeeded.
Cause: Account verification after the plan upgrade runs asynchronously, and Bedrock checks it while Transcribe did not.
Severity: Low — cleared within one ~10 min retry window, but a half-working account (one service up, one 403) looks
like an IAM or model-access misconfiguration and invites the wrong debugging.
Workaround: Wait and retry; the 403 cleared within ~10 min.
Suggestion: Surface verification state in `aws freetier get-account-plan-state` and in the console, and include it in
the `upgrade-account-plan` response ("verification pending; some services, e.g. Amazon Bedrock, are unavailable until
it completes").
Environment: Apple Silicon Mac, Darwin 25.2 (macOS 26); AWS CLI 2.x; @aws-sdk v3 (core 3.978.0); Node 22.19; AWS account on the
Free plan, upgraded to the Paid plan on 2026-10-01. Pipeline run on Sintel 1:30–2:30. Observed 2026-10-01.
Links: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
