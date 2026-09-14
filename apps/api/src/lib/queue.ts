import PgBoss from 'pg-boss'
import { env } from './env'
import { logger } from './logger'
export const boss = new PgBoss({ connectionString: env.DATABASE_URL })
boss.on('error', (e) => logger.error(e))
export async function startQueue() { await boss.start(); return boss }
