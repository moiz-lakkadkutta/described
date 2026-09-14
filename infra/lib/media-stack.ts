import { Duration, RemovalPolicy, Stack, type StackProps, CfnOutput } from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as iam from 'aws-cdk-lib/aws-iam'
import type { Construct } from 'constructs'

export class MediaStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { stage: string }) {
    super(scope, id, props)
    const media = new s3.Bucket(this, 'Media', {
      bucketName: `described-media-${props.stage}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: props.stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY, autoDeleteObjects: props.stage !== 'prod',
      cors: [{ allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD], allowedOrigins: ['*'], allowedHeaders: ['*'] }],
    })
    // HLS needs Range requests and CORS; Vega/Fire TV fetch manifests and segments over HTTPS only.
    const dist = new cloudfront.Distribution(this, 'Cdn', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(media),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    })
    // Pipeline / API role: S3 read-write on media, Transcribe, Polly, Translate here; Bedrock in us-east-1 (see NovaIngestStack).
    const pipelineRole = new iam.Role(this, 'PipelineRole', { assumedBy: new iam.AccountRootPrincipal(), description: 'described pipeline: media bucket + speech/translate services' })
    media.grantReadWrite(pipelineRole)
    pipelineRole.addToPolicy(new iam.PolicyStatement({ actions: ['transcribe:StartTranscriptionJob', 'transcribe:GetTranscriptionJob', 'polly:SynthesizeSpeech', 'translate:TranslateText'], resources: ['*'] }))
    pipelineRole.addToPolicy(new iam.PolicyStatement({ actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream', 'bedrock:Converse', 'bedrock:ConverseStream'], resources: ['arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-*', `arn:aws:bedrock:us-east-1:${this.account}:inference-profile/*`] }))
    new CfnOutput(this, 'MediaBucket', { value: media.bucketName })
    new CfnOutput(this, 'CdnDomain', { value: dist.distributionDomainName })
    new CfnOutput(this, 'PipelineRoleArn', { value: pipelineRole.roleArn })
    void Duration
  }
}
