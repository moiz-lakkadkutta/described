import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Applies prisma/migrations to the hosted database from inside the Lambda function (DESC-034): the database sits in
 * isolated subnets with no route from outside, so `prisma migrate deploy` cannot reach it from a laptop. Each migration's
 * SQL runs in its own transaction with a row in `_described_migrations`, so a re-run applies only what is new.
 * The SQL is Prisma's own migration files (several statements each), sent over node-postgres's simple query protocol.
 */
export interface Migration { name: string; sql: string }
export interface SqlClient { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }

export async function loadMigrations(dir: string): Promise<Migration[]> {
  const names = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  return Promise.all(names.map(async (name) => ({ name, sql: await readFile(path.join(dir, name, 'migration.sql'), 'utf8') })))
}

export async function applyMigrations(client: SqlClient, migrations: Migration[]): Promise<string[]> {
  await client.query('CREATE TABLE IF NOT EXISTS "_described_migrations" (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  const done = new Set((await client.query('SELECT name FROM "_described_migrations"')).rows.map((r) => String(r.name)))
  const applied: string[] = []
  for (const m of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    if (done.has(m.name)) continue
    await client.query('BEGIN')
    try {
      await client.query(m.sql)
      await client.query('INSERT INTO "_described_migrations" (name) VALUES ($1)', [m.name])
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw new Error(`migration ${m.name} failed: ${(e as Error).message}`)
    }
    applied.push(m.name)
  }
  return applied
}
