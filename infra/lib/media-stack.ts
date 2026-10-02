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
    // Only `published/` is public. The pipeline also keeps `work/<slug>/` (mezzanine, transcripts, key frames) and sources in this
    // bucket, so CloudFront serves `/published/*` and refuses every other path twice over: at the edge (default behaviour runs a
    // CloudFront Function that returns 403 without touching S3) and at the origin (bucket policy denies CloudFront's OAC any
    // GetObject outside `published/*`). Viewer URLs keep the `/published/` prefix, so the pipeline, API and the URLs already
    // tested on the stick are unchanged. Posters (`Title.posterKey`) must live under `published/` too.
    // https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
    // https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/writing-function-code.html
    // Takes effect only after the human runs `cdk deploy` for described-media-<stage>.
    const origin = origins.S3BucketOrigin.withOriginAccessControl(media)
    media.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'DenyCloudFrontOutsidePublished', effect: iam.Effect.DENY,
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')], actions: ['s3:GetObject'], notResources: [media.arnForObjects('published/*')],
    }))
    const denyAll = new cloudfront.Function(this, 'DenyUnpublished', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'described: 403 for every path outside /published/*',
      code: cloudfront.FunctionCode.fromInline("function handler(event) { return { statusCode: 403, statusDescription: 'Forbidden' }; }"),
    })
    // HLS needs Range requests and CORS; Vega/Fire TV fetch manifests and segments over HTTPS only.
    // Range GETs pass through to S3 unaided (https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RangeGETs.html);
    // CORS-With-Preflight answers browser OPTIONS preflights (Vega's Shaka runs in a web runtime) — SimpleCORS only sets Allow-Origin
    // (https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-response-headers-policies.html).
    // Without an origin request policy CloudFront strips Origin / Access-Control-Request-* before S3, so S3 refuses the
    // OPTIONS preflight with 403. CORS-S3Origin forwards Origin, Access-Control-Request-Headers and Access-Control-Request-Method
    // (https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html).
    // OPTIONS responses are cached, so those three headers are part of the cache key: otherwise one viewer's preflight answer
    // would be served to a request with a different Origin or requested method/headers
    // (https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/header-caching.html#header-caching-web-cors).
    // TTLs match the managed CachingOptimized policy (playlists still get 60 s from the origin Cache-Control).
    const mediaCache = new cloudfront.CachePolicy(this, 'MediaCorsCache', {
      comment: 'described: CachingOptimized + CORS request headers in the key (OPTIONS cached)',
      minTtl: Duration.seconds(1), defaultTtl: Duration.days(1), maxTtl: Duration.days(365),
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList('Origin', 'Access-Control-Request-Headers', 'Access-Control-Request-Method'),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(), cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      enableAcceptEncodingGzip: true, enableAcceptEncodingBrotli: true,
    })
    const dist = new cloudfront.Distribution(this, 'Cdn', {
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        functionAssociations: [{ function: denyAll, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/published/*': {
          origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
          cachePolicy: mediaCache,
          originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT,
        },
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
    // Nova ingest bucket read: unused since Gate C (describe sends key-frame bytes, no S3 URIs); removal is DESC-015.
    pipelineRole.addToPolicy(new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [`arn:aws:s3:::described-nova-ingest-${props.stage}-${this.account}/*`] }))
    new CfnOutput(this, 'MediaBucket', { value: media.bucketName })
    new CfnOutput(this, 'CdnDomain', { value: dist.distributionDomainName })
    new CfnOutput(this, 'CdnId', { value: dist.distributionId }) // CLOUDFRONT_DISTRIBUTION_ID, for invalidations on re-runs
    new CfnOutput(this, 'PipelineRoleArn', { value: pipelineRole.roleArn })
  }
}
