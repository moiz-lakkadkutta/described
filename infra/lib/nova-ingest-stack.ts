import { Duration, RemovalPolicy, Stack, type StackProps, CfnOutput } from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import type { Construct } from 'constructs'
/** Short-lived bucket in us-east-1 for the clips Nova reads by S3 URI. Lifecycle: delete after 7 days. */
export class NovaIngestStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { stage: string }) {
    super(scope, id, props)
    const b = new s3.Bucket(this, 'NovaIngest', {
      bucketName: `described-nova-ingest-${props.stage}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY, autoDeleteObjects: true,
      lifecycleRules: [{ expiration: Duration.days(7) }],
    })
    new CfnOutput(this, 'NovaIngestBucket', { value: b.bucketName })
  }
}
