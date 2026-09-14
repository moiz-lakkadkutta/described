import PgBoss from 'pg-boss'
import { PrismaClient } from '@prisma/client'
import { runDescribe } from './steps'
const db = new PrismaClient()
const boss = new PgBoss({ connectionString: process.env.DATABASE_URL! })
await boss.start()
await boss.work<{ titleId: string }>('describe', async ([job]) => {
  const t = await db.title.findUniqueOrThrow({ where: { id: job!.data.titleId }, include: { assets: { where: { kind: 'source' } } } })
  await runDescribe({ slug: t.slug, source: `s3://${process.env.S3_BUCKET_MEDIA}/${t.assets[0]!.s3Key}`, language: t.language as 'en' | 'de', voice: t.voice })
})
console.log('describe worker running')
