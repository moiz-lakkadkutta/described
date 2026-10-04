import { App } from 'aws-cdk-lib'
import { MediaStack } from '../lib/media-stack'
const app = new App()
const stage = app.node.tryGetContext('stage') ?? 'dev'
// Media, delivery, Transcribe and Polly live in Frankfurt; the pipeline calls Bedrock in us-east-1 (BEDROCK_REGION), no stack there.
new MediaStack(app, `described-media-${stage}`, { env: { region: 'eu-central-1' }, stage })
