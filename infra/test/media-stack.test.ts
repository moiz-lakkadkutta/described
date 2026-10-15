import { App } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { MediaStack } from '../lib/media-stack'

// The pipeline role may call exactly the Bedrock models the pipeline uses (decision 0017 adds the narrative pass's two).
describe('MediaStack PipelineRole', () => {
  const t = Template.fromStack(new MediaStack(new App(), 'described-media-test', { env: { region: 'eu-central-1', account: '123456789012' }, stage: 'test' }))
  it('bedrock:InvokeModel on Nova Lite (and its us. profile), Qwen3-VL, DeepSeek v3.2 and Nova Pro in us-east-1, nothing else', () => {
    const statements = Object.values(t.findResources('AWS::IAM::Policy')).flatMap((p) => (p.Properties.PolicyDocument.Statement as { Action: string | string[]; Resource: unknown }[]))
    const bedrock = statements.filter((s) => [s.Action].flat().some((a) => a.startsWith('bedrock:')))
    expect(bedrock).toHaveLength(1)
    expect([bedrock[0]!.Action].flat()).toEqual(['bedrock:InvokeModel'])
    expect(JSON.stringify(bedrock[0]!.Resource)).toBe(JSON.stringify([
      'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0',
      'arn:aws:bedrock:us-east-1::foundation-model/qwen.qwen3-vl-235b-a22b',
      'arn:aws:bedrock:us-east-1::foundation-model/deepseek.v3.2',
      'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-pro-v1:0',
      'arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.amazon.nova-lite-v1:0',
    ]))
  })
})
