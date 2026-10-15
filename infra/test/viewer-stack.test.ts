import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { App } from 'aws-cdk-lib'
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions'
import { ViewerStack } from '../lib/viewer-stack'

// DESC-034 review L4: pins the money and exposure decisions of the hosted API stack.
const bundleDir = mkdtempSync(path.join(tmpdir(), 'desc034-bundle-'))
writeFileSync(path.join(bundleDir, 'index.js'), 'exports.handler = async () => ({})')
const synth = (alertEmail?: string) => {
  const stack = new ViewerStack(new App(), 'described-viewer-test', { env: { region: 'us-east-1' }, stage: 'test', cdnDomain: 'cdn.test', bundleDir, alertEmail })
  return { stack, t: Template.fromStack(stack) }
}

describe('ViewerStack', () => {
  const { t, stack } = synth('alerts@example.com')

  it('database: db.t4g.micro, 20 GiB gp3, never public, no storage autoscaling', () => {
    t.resourceCountIs('AWS::RDS::DBInstance', 1)
    t.hasResourceProperties('AWS::RDS::DBInstance', { DBInstanceClass: 'db.t4g.micro', AllocatedStorage: '20', StorageType: 'gp3', MultiAZ: false, PubliclyAccessible: false, StorageEncrypted: true })
    const [db] = Object.values(t.findResources('AWS::RDS::DBInstance'))
    expect(db!.Properties).not.toHaveProperty('MaxAllocatedStorage')
  })

  it('network: isolated subnets only, no NAT gateway or internet gateway', () => {
    t.resourceCountIs('AWS::EC2::NatGateway', 0)
    t.resourceCountIs('AWS::EC2::InternetGateway', 0)
    t.resourceCountIs('AWS::EC2::EIP', 0)
  })

  it('function URL: auth NONE, and the public InvokeFunction grant only via the function URL', () => {
    t.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'NONE' })
    t.hasResourceProperties('AWS::Lambda::Permission', { Action: 'lambda:InvokeFunctionUrl', Principal: '*', FunctionUrlAuthType: 'NONE' })
    t.hasResourceProperties('AWS::Lambda::Permission', { Action: 'lambda:InvokeFunction', Principal: '*', InvokedViaFunctionUrl: true })
    for (const p of Object.values(t.findResources('AWS::Lambda::Permission', { Properties: { Action: 'lambda:InvokeFunction' } }))) {
      expect(p.Properties.InvokedViaFunctionUrl).toBe(true) // a bare public InvokeFunction would expose the seed op
    }
  })

  it('function: viewer mode, arm64, password as a dynamic reference (never a literal)', () => {
    t.hasResourceProperties('AWS::Lambda::Function', { Architectures: ['arm64'], Runtime: 'nodejs22.x', Environment: { Variables: Match.objectLike({ API_MODE: 'viewer', CLOUDFRONT_DOMAIN: 'cdn.test' }) } })
    expect(JSON.stringify(t.toJSON())).toContain('{{resolve:secretsmanager:')
  })

  it('guards: free-storage alarm below 2 GiB with an email action, and a USD 25 monthly budget', () => {
    t.hasResourceProperties('AWS::CloudWatch::Alarm', { MetricName: 'FreeStorageSpace', Threshold: 2 * 1024 ** 3, ComparisonOperator: 'LessThanThreshold', AlarmActions: Match.anyValue() })
    t.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: 'alerts@example.com' })
    t.hasResourceProperties('AWS::Budgets::Budget', { Budget: Match.objectLike({ BudgetLimit: { Amount: 25, Unit: 'USD' }, TimeUnit: 'MONTHLY', BudgetType: 'COST' }) })
    Annotations.fromStack(stack).hasNoWarning('*', Match.stringLikeRegexp('alertEmail'))
  })

  it('without alertEmail: no budget, alarm without action, and a synth warning', () => {
    const { t: bare, stack: s } = synth()
    bare.resourceCountIs('AWS::Budgets::Budget', 0)
    bare.resourceCountIs('AWS::SNS::Topic', 0)
    bare.resourceCountIs('AWS::CloudWatch::Alarm', 1)
    Annotations.fromStack(s).hasWarning('*', Match.stringLikeRegexp('No alertEmail'))
  })
})
