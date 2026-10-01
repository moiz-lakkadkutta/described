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
    // Range GETs pass through to S3 unaided (https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RangeGETs.html);
    // CORS-With-Preflight answers browser OPTIONS preflights (Vega's Shaka runs in a web runtime) — SimpleCORS only sets Allow-Origin
    // (https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-response-headers-policies.html).
    // Without an origin request policy CloudFront strips Origin / Access-Control-Request-* before S3, so S3 refuses the
    // OPTIONS preflight with 403. CORS-S3Origin forwards Origin, Access-Control-Request-Headers and Access-Control-Request-Method
    // (https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html);
    // OPTIONS is cached alongside GET/HEAD so preflights don't hit S3 every time.
    const dist = new cloudfront.Distribution(this, 'Cdn', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(media),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    })
    // Pipeline / API role: S3 read-write on media, Transcribe, Polly, Translate here; Bedrock in us-east-1 (see NovaIngestStack).
    const pipelineRole = new iam.Role(this, 'PipelineRole', { assumedBy: new iam.AccountRootPrincipal(), description: 'described pipeline: media bucket + speech/translate services' })
    media.grantReadWrite(pipelineRole)
    pipelineRole.addToPolicy(new iam.PolicyStatement({ actions: ['transcribe:StartTranscriptionJob', 'transcribe:GetTranscriptionJob', 'polly:SynthesizeSpeech', 'translate:TranslateText'], resources: ['*'] }))
    // Converse is authorised by bedrock:InvokeModel — https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
    // Nova Lite still shortens / writes SDH; shot description is Qwen3-VL 235B, InvokeModel only (Converse, no streaming), in-Region us-east-1 —
    // https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-vl-235b-a22b.html
    pipelineRole.addToPolicy(new iam.PolicyStatement({ actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'], resources: ['arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-*', `arn:aws:bedrock:us-east-1:${this.account}:inference-profile/*`] }))
    pipelineRole.addToPolicy(new iam.PolicyStatement({ actions: ['bedrock:InvokeModel'], resources: ['arn:aws:bedrock:us-east-1::foundation-model/qwen.qwen3-vl-235b-a22b'] }))
    // Nova reads shot clips by S3 URI with the caller's credentials — https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html
    pipelineRole.addToPolicy(new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [`arn:aws:s3:::described-nova-ingest-${props.stage}-${this.account}/*`] }))
    new CfnOutput(this, 'MediaBucket', { value: media.bucketName })
    new CfnOutput(this, 'CdnDomain', { value: dist.distributionDomainName })
    new CfnOutput(this, 'CdnId', { value: dist.distributionId }) // CLOUDFRONT_DISTRIBUTION_ID, for invalidations on re-runs
    new CfnOutput(this, 'PipelineRoleArn', { value: pipelineRole.roleArn })
    void Duration
  }
}
