import { existsSync } from 'node:fs'
import { Annotations, CfnOutput, Duration, Fn, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib'
import * as budgets from 'aws-cdk-lib/aws-budgets'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as rds from 'aws-cdk-lib/aws-rds'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions'
import type { Construct } from 'constructs'

export interface ViewerStackProps extends StackProps {
  stage: string
  /** The media stack's CloudFront domain (CdnDomain output, in eu-central-1): the API builds media URLs from it. */
  cdnDomain: string
  /** Folder built by `pnpm --filter @described/api build:lambda` (apps/api/dist-lambda). */
  bundleDir: string
  /** Where the cost budget and the storage alarm send email (`-c alertEmail=…` or ALERT_EMAIL). Without it: no budget, alarm without action. */
  alertEmail?: string
}

/**
 * The hosted copy of the API for judges' sticks (DESC-034): one Lambda function behind a function URL (HTTPS, no API
 * Gateway), and PostgreSQL on RDS db.t4g.micro, both in isolated subnets of a VPC with no NAT gateway and no public IPv4
 * address. Read-mostly: the catalogue, plus per-device prefs, progress and My list. No queue, worker or admin routes.
 * Estimated USD 14.50 a month in us-east-1 (docs/aws.md, "Hosted API"), guarded by a USD 25 budget and a storage alarm.
 *
 * - Function URLs: https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html (auth type NONE:
 *   https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html)
 * - Lambda in a VPC: https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html
 * - RDS for PostgreSQL in a VPC: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html
 * - RDS pricing (db.t4g.micro, gp3): https://aws.amazon.com/rds/postgresql/pricing/
 * - Secrets Manager dynamic references: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/dynamic-references-secretsmanager.html
 */
export class ViewerStack extends Stack {
  constructor(scope: Construct, id: string, props: ViewerStackProps) {
    super(scope, id, props)
    if (!existsSync(props.bundleDir)) throw new Error(`${props.bundleDir} is missing: run \`pnpm --filter @described/api build:lambda\` first`)
    Tags.of(this).add('project', 'described')
    const prod = props.stage === 'prod'

    // Two AZs because an RDS subnet group needs them; isolated subnets only, so no NAT gateway or public address is billed.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2, natGateways: 0,
      subnetConfiguration: [{ name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 }],
    })
    const isolated = { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }
    const fnSg = new ec2.SecurityGroup(this, 'ApiSg', { vpc, description: 'Described hosted API function', allowAllOutbound: true })
    const dbSg = new ec2.SecurityGroup(this, 'DbSg', { vpc, description: 'Described hosted database', allowAllOutbound: false })
    dbSg.addIngressRule(fnSg, ec2.Port.tcp(5432), 'PostgreSQL from the API function only')

    // Letters and digits only, so the password sits in a connection URL without escaping. ExcludePunctuation, not an
    // ExcludeCharacters list of every punctuation mark: RequireEachIncludedType defaults to true, so excluding all of a
    // type by list fails at deploy ("All characters of the desired type have been excluded"). DatabaseInstance attaches
    // the secret (SecretTargetAttachment), so db.secret still carries host and port.
    // https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetRandomPassword.html (ExcludePunctuation, RequireEachIncludedType)
    // https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-secretsmanager-secret-generatesecretstring.html
    const dbSecret = new secretsmanager.Secret(this, 'DbSecret', {
      description: 'Described hosted database: master user',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'described' }), generateStringKey: 'password',
        excludePunctuation: true, includeSpace: false, passwordLength: 32,
      },
    })
    const credentials = rds.Credentials.fromSecret(dbSecret)
    const db = new rds.DatabaseInstance(this, 'Db', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc, vpcSubnets: isolated, securityGroups: [dbSg], publiclyAccessible: false, multiAz: false,
      credentials, databaseName: 'described',
      allocatedStorage: 20, storageType: rds.StorageType.GP3, storageEncrypted: true, // 20 GiB is the gp3 minimum
      backupRetention: Duration.days(1), deleteAutomatedBackups: true, enablePerformanceInsights: false,
      // The catalogue is re-seeded from the developer's database; only devices' prefs and lists would be lost.
      deletionProtection: prod, removalPolicy: prod ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
    })

    // The function reaches no AWS API at run time (media URLs are built, not fetched), so the isolated subnets need no
    // endpoints. The password reaches it as a CloudFormation dynamic reference, resolved at deploy, never in the template.
    const password = db.secret!.secretValueFromJson('password').unsafeUnwrap()
    const databaseUrl = Fn.join('', ['postgresql://described:', password, '@', db.dbInstanceEndpointAddress, ':', db.dbInstanceEndpointPort,
      '/described?connection_limit=1&sslmode=require&connect_timeout=10&pool_timeout=10'])
    const fn = new lambda.Function(this, 'Api', {
      description: 'Described API, viewer mode (DESC-034)',
      runtime: lambda.Runtime.NODEJS_22_X, architecture: lambda.Architecture.ARM_64,
      code: lambda.Code.fromAsset(props.bundleDir), handler: 'index.handler',
      memorySize: 512, timeout: Duration.seconds(20),
      vpc, vpcSubnets: isolated, securityGroups: [fnSg],
      environment: { DATABASE_URL: databaseUrl, API_MODE: 'viewer', CLOUDFRONT_DOMAIN: props.cdnDomain, NODE_ENV: 'production' },
      logGroup: new logs.LogGroup(this, 'ApiLogs', { retention: logs.RetentionDays.ONE_WEEK, removalPolicy: RemovalPolicy.DESTROY }),
    })
    fn.node.addDependency(db)
    const url = fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE })


    // Guards (DESC-034 review M1, M2). The storage alarm: device ids are bounded and reads insert nothing, but the API is
    // public, so a flood of writes is still possible; 2 GiB free of 20 is the point to look. CloudWatch alarm on
    // FreeStorageSpace (bytes): https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-metrics.html
    const alarm = new cloudwatch.Alarm(this, 'DbFreeStorageLow', {
      alarmDescription: 'Described hosted DB: less than 2 GiB free (of 20 GiB)',
      metric: db.metricFreeStorageSpace({ period: Duration.minutes(5), statistic: 'Minimum' }),
      threshold: 2 * 1024 ** 3, comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1, treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    if (props.alertEmail) {
      const topic = new sns.Topic(this, 'Alerts', { displayName: 'Described hosted API alerts' })
      topic.addSubscription(new subs.EmailSubscription(props.alertEmail))
      alarm.addAlarmAction(new cwActions.SnsAction(topic))
      // A monthly cost budget for the whole account (it also carries the pipeline's Bedrock, Polly and Transcribe runs):
      // email at 80 % of USD 25 actual and at 100 % forecast. https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-create.html
      new budgets.CfnBudget(this, 'MonthlyCost', {
        budget: { budgetName: `described-${props.stage}-monthly`, budgetType: 'COST', timeUnit: 'MONTHLY', budgetLimit: { amount: 25, unit: 'USD' } },
        notificationsWithSubscribers: [
          { notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 80, thresholdType: 'PERCENTAGE' }, subscribers: [{ subscriptionType: 'EMAIL', address: props.alertEmail }] },
          { notification: { notificationType: 'FORECASTED', comparisonOperator: 'GREATER_THAN', threshold: 100, thresholdType: 'PERCENTAGE' }, subscribers: [{ subscriptionType: 'EMAIL', address: props.alertEmail }] },
        ],
      })
    } else {
      Annotations.of(this).addWarningV2('described:no-alert-email', 'No alertEmail: no USD 25 cost budget, and the free-storage alarm has no action. Pass -c alertEmail=<address> or set ALERT_EMAIL.')
    }

    new CfnOutput(this, 'ViewerApiUrl', { value: url.url, description: 'EXPO_PUBLIC_API_URL for the judges\' APK (trailing slash is stripped by the build script)' })
    new CfnOutput(this, 'ApiFunctionName', { value: fn.functionName, description: 'aws lambda invoke target for the migrate and seed operations' })
    new CfnOutput(this, 'DbEndpoint', { value: db.dbInstanceEndpointAddress })
  }
}
