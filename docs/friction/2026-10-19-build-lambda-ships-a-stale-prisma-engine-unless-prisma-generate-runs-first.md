# build:lambda ships a stale Prisma engine unless prisma generate runs first

Task attempted: deploy the hosted API for judges (DESC-034) to Lambda on arm64 with `pnpm --filter @described/infra deploy:viewer`.
Steps:
  1. `deploy:viewer` runs `pnpm build:api`, which runs `pnpm --filter @described/api build:lambda` (esbuild bundle of
     `src/lambda.ts` plus Prisma's query engine copied beside it).
  2. `schema.prisma` had gained `binaryTargets = ["native", "linux-arm64-openssl-3.0.x"]`, but the generated client on the
     machine came from an older `prisma generate` with only the native (darwin-arm64) engine.
  3. The bundle step threw: `libquery_engine-linux-arm64-openssl-3.0.x.so.node missing in …/.prisma/client`.
Expected: a deploy script that builds what it ships from the current schema, or a Lambda doc that names the generate step.
Actual: the build depends on whoever last ran `prisma generate`. Nothing in the deploy path regenerates the client, and no
  doc in the repo said to run `pnpm db:generate` before a deploy. Without our guard in `scripts/build-lambda.mjs`, the
  function would have deployed and failed only at the first query, on the Lambda host, with a missing-engine error.
Severity: Low — minutes, not hours (the guard named the missing engine); it blocked the first viewer-stack deploy until the cause was found (PR #73).
Workaround: `build:lambda` is now `prisma generate && node scripts/build-lambda.mjs`; the engine guard stays as a second check.
Suggestion: Prisma Client could warn when the generated client is older than `schema.prisma` (here, a new `binaryTargets` entry);
  the AWS Lambda Node.js packaging page could note that native add-ons must be built for the function's architecture
  (arm64 here) and give Prisma as the common example.
Environment: macOS (Apple silicon), Prisma 6, Node.js 22, Lambda arm64 (Graviton), us-east-1, 2026-10-15.
Links: https://docs.aws.amazon.com/lambda/latest/dg/foundation-arch.html ·
  https://docs.aws.amazon.com/lambda/latest/dg/nodejs-package.html ·
  https://www.prisma.io/docs/orm/prisma-client/deployment/serverless/deploy-to-aws-lambda ·
  https://www.prisma.io/docs/orm/reference/prisma-schema-reference#binarytargets-options · PR #73
