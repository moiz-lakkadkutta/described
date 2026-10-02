import PgBoss from 'pg-boss'
import { PrismaClient } from '@prisma/client'
import { registerPipeline, stopOnSignals } from './jobs'
const db = new PrismaClient()
const boss = new PgBoss({ connectionString: process.env.DATABASE_URL! })
boss.on('error', (e) => console.error(e))
await boss.start()
await registerPipeline({ boss, db })
console.log('pipeline workers running: probe → shots → speech → describe → fit → finish')
stopOnSignals(boss, () => db.$disconnect())
