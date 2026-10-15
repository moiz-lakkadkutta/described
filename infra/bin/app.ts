import { fileURLToPath } from 'node:url'
import { App } from 'aws-cdk-lib'
import { MediaStack } from '../lib/media-stack'
import { ViewerStack } from '../lib/viewer-stack'
const app = new App()
const stage = app.node.tryGetContext('stage') ?? 'dev'
// Media, delivery, Transcribe and Polly live in Frankfurt; the pipeline calls Bedrock in us-east-1 (BEDROCK_REGION), no stack there.
new MediaStack(app, `described-media-${stage}`, { env: { region: 'eu-central-1' }, stage })

// The hosted API for judges (DESC-034), only with `-c viewer=1` (pnpm synth:viewer / deploy:viewer), so the media stack's
// commands need neither the Lambda bundle nor the CDN domain. us-east-1: RDS db.t4g.micro costs less there than in
// Frankfurt (docs/aws.md, "Hosted API"); media still comes from CloudFront.
if (app.node.tryGetContext('viewer')) {
  const cdnDomain = app.node.tryGetContext('cdnDomain') ?? process.env.CLOUDFRONT_DOMAIN
  if (!cdnDomain) throw new Error('viewer stack: pass -c cdnDomain=<CdnDomain output of described-media-' + stage + '> or set CLOUDFRONT_DOMAIN')
  new ViewerStack(app, `described-viewer-${stage}`, {
    env: { region: 'us-east-1' }, stage, cdnDomain,
    alertEmail: app.node.tryGetContext('alertEmail') ?? process.env.ALERT_EMAIL,
    bundleDir: fileURLToPath(new URL('../../apps/api/dist-lambda', import.meta.url)),
  })
}
