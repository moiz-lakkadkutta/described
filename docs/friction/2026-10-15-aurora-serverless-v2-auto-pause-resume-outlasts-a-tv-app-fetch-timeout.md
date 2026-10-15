# Aurora Serverless v2 auto-pause resume outlasts a TV app's fetch timeout

Task attempted: host the API for judges (DESC-034) on the cheapest AWS database that costs nothing while idle.
Steps:
  1. Compared Aurora Serverless v2 with a 0 ACU minimum (automatic pause) against RDS db.t4g.micro.
  2. Read the auto-pause page: resuming "might be approximately 15 seconds", and AWS recommends client timeouts longer than 15 s.
  3. Checked the app: `FETCH_TIMEOUT_MS` is 10 s (`packages/shared-ui/src/index.tsx`), so the first launch after a pause shows
     "Can't reach the library".
Expected: a scale-to-zero PostgreSQL that answers a first request within a TV app's usual 10 s budget.
Actual: ≈ 15 s resume (longer after more than 24 h paused); kept warm at 0.5 ACU it is $0.07 / h ≈ $51 a month in Frankfurt.
  Also: this new account's Lambda concurrency quota is 10, so `reservedConcurrentExecutions` (to cap cost) cannot be set at all
  (AWS keeps 100 unreserved), and Frankfurt's db.t4g.micro + 20 GiB gp3 is ≈ $16.60 against ≈ $14.00 in us-east-1.
Severity: Low — about 30 minutes of comparison; it decided the region and the database (RDS db.t4g.micro, us-east-1).
Workaround: RDS db.t4g.micro single-AZ in us-east-1, Lambda function URL, isolated subnets, no NAT (docs/aws.md "Hosted API").
Suggestion: a documented resume-time bound below 10 s, or a "warm while used today" option between pause and always-on.
Environment: macOS, aws-cdk-lib 2.269.0, account 1284…526, eu-central-1 / us-east-1, 2026-10-15.
Links: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html ·
  https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html
