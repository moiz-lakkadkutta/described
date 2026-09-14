import { z } from 'zod'
const Env = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(4000),
  AWS_REGION: z.string().default('eu-central-1'),
  BEDROCK_REGION: z.string().default('us-east-1'),
  S3_BUCKET_MEDIA: z.string().optional(),
  CLOUDFRONT_DOMAIN: z.string().optional(),
})
export const env = Env.parse(process.env)
