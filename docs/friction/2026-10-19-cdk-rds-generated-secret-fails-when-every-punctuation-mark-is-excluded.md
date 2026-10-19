# CDK RDS generated secret fails when every punctuation mark is excluded

Task attempted: create the viewer stack's PostgreSQL (RDS db.t4g.micro) with a generated password that can sit in a
`DATABASE_URL` without URL escaping (DESC-034).
Steps:
  1. `rds.Credentials.fromGeneratedSecret('described', { excludeCharacters: <every ASCII punctuation mark> })` in
     `infra/lib/viewer-stack.ts`.
  2. `cdk synth` and the unit tests passed.
  3. `cdk deploy described-viewer-dev -c viewer=1 -c stage=dev`.
Expected: a letters-and-digits password, or a synth-time error.
Actual: CloudFormation failed `Db/Secret` (AWS::SecretsManager::Secret) with CREATE_FAILED "All characters of the desired type
  have been excluded." `RequireEachIncludedType` defaults to true, so listing every punctuation mark in `ExcludeCharacters`
  leaves the punctuation type empty and no password can be made. `fromGeneratedSecret` does not expose `excludePunctuation`,
  and the error names neither the property nor the fix. `cdk synth` and the stack's unit tests accept it, so the failure
  appears only at deploy time.
Severity: Medium — one failed deploy and a fix-and-redeploy round (time not recorded); it blocked the hosted API (PR #74).
Workaround: a separate `secretsmanager.Secret` with `generateSecretString { excludePunctuation: true, includeSpace: false,
  passwordLength: 32, secretStringTemplate: {"username":"described"}, generateStringKey: "password" }`, passed through
  `rds.Credentials.fromSecret`. A unit test asserts `ExcludePunctuation: true` and no `ExcludeCharacters`.
Suggestion: have `Credentials.fromGeneratedSecret` accept `excludePunctuation`; have CDK (or cfn-lint) warn when
  `excludeCharacters` covers a whole character class while `requireEachIncludedType` is true; and say in the Secrets Manager
  error which type is empty and that `ExcludePunctuation` or `RequireEachIncludedType: false` resolves it.
Environment: macOS, aws-cdk-lib 2.269.0, account 1284…526, us-east-1, 2026-10-15.
Links: https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-secretsmanager-secret-generatesecretstring.html ·
  https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetRandomPassword.html ·
  https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_rds.Credentials.html · PR #74
