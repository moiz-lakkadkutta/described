import { App } from 'aws-cdk-lib'
import { MediaStack } from '../lib/media-stack'
import { NovaIngestStack } from '../lib/nova-ingest-stack'
const app = new App()
const stage = app.node.tryGetContext('stage') ?? 'dev'
// Media, delivery, Transcribe/Polly/Translate live in Frankfurt. Nova (video understanding) lives in us-east-1.
new MediaStack(app, `described-media-${stage}`, { env: { region: 'eu-central-1' }, stage })
new NovaIngestStack(app, `described-nova-${stage}`, { env: { region: 'us-east-1' }, stage })
