import path from 'node:path'
import type { Context } from 'aws-lambda'
import pg from 'pg'
import serverless from 'serverless-http'
import { createApp } from './app'
import { db } from './lib/db'
import { env } from './lib/env'
import { logger } from './lib/logger'
import { MAX_SEED_BYTES, importCatalogue, type ImportDb } from './hosted/catalogue'
import { applyMigrations, loadMigrations } from './hosted/migrate'

/**
 * The hosted copy of the API (DESC-034, infra/lib/viewer-stack.ts): Express behind a Lambda function URL, in viewer
 * mode. Function URL events use the API Gateway payload format 2.0, which serverless-http translates
 * (https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html#urls-payloads).
 *
 * Two operations come only from a direct `aws lambda invoke` (IAM-signed; a function URL request always carries
 * requestContext, so it can never reach them): `migrate` applies prisma/migrations, and `seed` migrates and then
 * imports a catalogue export (`pnpm --filter @described/api export:catalogue`).
 */
export type Op = { op: 'migrate' } | { op: 'seed'; catalogue: unknown }
export const isOp = (e: unknown): e is Op =>
  typeof e === 'object' && e !== null && !('requestContext' in e) && ((e as { op?: unknown }).op === 'migrate' || (e as { op?: unknown }).op === 'seed')

// Always viewer: the hosted copy never serves /admin, whatever API_MODE says (the stack sets it too, for /health).
const http = serverless(createApp({ mode: 'viewer' }))

/**
 * DATABASE_URL carries Prisma's parameters (connection_limit, sslmode, …), dropped here. With sslmode=require, node-postgres
 * would check the server's certificate against Node's CA store, which lacks RDS's CA: TLS is kept, the CA check is not
 * (the database is reachable only from this function's security group, in isolated subnets).
 */
export function pgConfig(url: string): pg.ClientConfig {
  const u = new URL(url)
  const tls = (u.searchParams.get('sslmode') ?? 'disable') !== 'disable'
  u.search = ''
  return { connectionString: u.toString(), ...(tls ? { ssl: { rejectUnauthorized: false } } : {}) }
}

async function migrate() {
  const client = new pg.Client(pgConfig(env.DATABASE_URL))
  await client.connect()
  try { return await applyMigrations(client, await loadMigrations(path.join(__dirname, 'migrations'))) } finally { await client.end() }
}

export async function runOp(e: Op) {
  const migrated = await migrate()
  if (e.op === 'migrate') return { migrated }
  if (JSON.stringify(e.catalogue).length > MAX_SEED_BYTES) throw new Error('catalogue too large for one invoke')
  return { migrated, ...(await importCatalogue(db as unknown as ImportDb, e.catalogue)) }
}

export async function handler(event: unknown, context: Context) {
  if (isOp(event)) {
    const out = await runOp(event)
    logger.info(out, `hosted op ${event.op}`)
    return out
  }
  return http(event as Parameters<typeof http>[0], context)
}
