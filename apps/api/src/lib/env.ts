import { z } from 'zod'
/**
 * API_MODE: `full` (default) is the developer's API with the admin routes the pipeline uses; `viewer` is the hosted copy
 * judges' sticks reach (DESC-034, infra/lib/viewer-stack.ts): catalogue, titles, prompts, about and per-device /me only.
 */
export const ApiMode = z.enum(['full', 'viewer'])
export type ApiMode = z.infer<typeof ApiMode>
const Env = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(4000),
  API_MODE: ApiMode.default('full'),
  AWS_REGION: z.string().default('eu-central-1'),
  BEDROCK_REGION: z.string().default('us-east-1'),
  S3_BUCKET_MEDIA: z.string().optional(),
  CLOUDFRONT_DOMAIN: z.string().optional(),
})
export const env = Env.parse(process.env)
