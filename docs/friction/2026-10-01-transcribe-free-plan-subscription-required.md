# transcribe free plan subscription required

Task attempted: Run the pipeline's transcription step (Amazon Transcribe `StartTranscriptionJob`, eu-central-1) on a
freshly created AWS account, as the first real AWS run of the describe pipeline.
Steps:
  1. Created the account and an admin IAM user; configured the AWS CLI and SDK credentials.
  2. Ran the pipeline; the transcription step called `StartTranscriptionJob` in eu-central-1 via @aws-sdk v3.
  3. Retried with the CLI to rule out the SDK: same error.
  4. Checked IAM policies, region, and the Transcribe console: nothing pointed at a cause.
  5. Ran `aws freetier get-account-plan-state` → `accountPlanType: FREE` with $140 in credits.
Expected: The job starts (the account has admin rights and credits), or the error says the account plan excludes
Transcribe and how to change it.
Actual: `SubscriptionRequiredException: The AWS Access Key Id needs a subscription for the service`
(request id 08e0e036-079e-49ed-8dac-af237d987ec4). The message names neither the Free plan nor the fix; it reads like a
credentials or IAM problem.
Cause: The account was on the AWS Free plan, which does not include Amazon Transcribe.
Severity: Medium — blocks the whole pipeline (every later step needs the transcript for the gap map); ~30 min to
diagnose, because the error points at the access key rather than at the account plan.
Workaround:
  1. As the root user: `aws freetier upgrade-account-plan --account-plan-type PAID`.
  2. Remaining credits carry over to the Paid plan.
  3. Re-run the job (see the separate log on the short account-verification window that follows).
Suggestion: When a Free-plan account calls a service the plan excludes, the error should say so ("Your account is on
the AWS Free plan, which does not include Amazon Transcribe") and link to the upgrade page / CLI command. The Transcribe
console and getting-started docs should note which services the Free plan excludes.
Environment: Apple Silicon Mac, Darwin 25.2 (macOS 26); AWS CLI 2.x; @aws-sdk v3 (core 3.978.0); Node 22.19; AWS account on the
Free plan, upgraded to the Paid plan on 2026-10-01. Pipeline run on Sintel 1:30–2:30. Observed 2026-10-01.
Links: https://docs.aws.amazon.com/transcribe/latest/APIReference/API_StartTranscriptionJob.html
