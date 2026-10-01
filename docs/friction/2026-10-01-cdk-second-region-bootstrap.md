# cdk second region bootstrap

Task attempted: Deploy the CDK stack's us-east-1 resources (Bedrock-side ingest) after the eu-central-1 environment
was already bootstrapped and deployed.
Steps:
  1. `cdk bootstrap` had been run for eu-central-1 only.
  2. `cdk diff` for the stack targeting us-east-1.
  3. `cdk deploy` for the same stack.
Expected: `cdk diff` reports that us-east-1 is not bootstrapped and prints the `cdk bootstrap aws://<account>/us-east-1`
command.
Actual: `cdk diff` only warned "could not assume lookup role … Proceeding anyway" and printed a diff. The deploy then
needed a separate `cdk bootstrap` for us-east-1 before it succeeded.
Cause: CDK bootstrapping is per account and region; the warning describes the missing role, not the missing bootstrap.
Severity: Low — a few minutes lost; the fix is known once the cause is recognised.
Workaround: `cdk bootstrap aws://<account>/us-east-1`, then `cdk deploy`.
Suggestion: When the lookup role cannot be assumed because the target environment has no bootstrap stack, `cdk diff`
should say "environment aws://…/us-east-1 is not bootstrapped" and print the bootstrap command.
Environment: Apple Silicon Mac, Darwin 25.2 (macOS 26); AWS CLI 2.x; @aws-sdk v3 (core 3.978.0); Node 22.19; AWS account on the
Free plan, upgraded to the Paid plan on 2026-10-01. Pipeline run on Sintel 1:30–2:30. Observed 2026-10-01.
Links: https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html
