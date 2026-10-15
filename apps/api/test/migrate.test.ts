import { fileURLToPath } from 'node:url'
import { applyMigrations, loadMigrations, type SqlClient } from '../src/hosted/migrate'
import { pgConfig } from '../src/lambda'

// DESC-034: the hosted function applies prisma/migrations itself (the database has no route from outside).
const client = (applied: string[] = [], fail?: string) => {
  const log: string[] = []
  const c: SqlClient = { query: vi.fn(async (sql: string, params?: unknown[]) => {
    log.push(params ? `${sql} ${JSON.stringify(params)}` : sql)
    if (fail && sql === fail) throw new Error('boom')
    return { rows: sql.startsWith('SELECT name') ? applied.map((name) => ({ name })) : [] }
  }) }
  return { c, log }
}
const m = (name: string) => ({ name, sql: `-- ${name}` })

describe('applyMigrations', () => {
  it('applies only new migrations, in name order, each in its own transaction with its record', async () => {
    const { c, log } = client(['001_init'])
    expect(await applyMigrations(c, [m('003_b'), m('001_init'), m('002_a')])).toEqual(['002_a', '003_b'])
    expect(log.slice(2)).toEqual([
      'BEGIN', '-- 002_a', 'INSERT INTO "_described_migrations" (name) VALUES ($1) ["002_a"]', 'COMMIT',
      'BEGIN', '-- 003_b', 'INSERT INTO "_described_migrations" (name) VALUES ($1) ["003_b"]', 'COMMIT',
    ])
  })
  it('rolls back and stops at a failing migration', async () => {
    const { c, log } = client([], '-- 002_a')
    await expect(applyMigrations(c, [m('001'), m('002_a'), m('003')])).rejects.toThrow(/002_a failed: boom/)
    expect(log.at(-1)).toBe('ROLLBACK')
    expect(log.join('\n')).not.toContain('-- 003')
  })
  it('loads the repo\'s prisma/migrations in order', async () => {
    const ms = await loadMigrations(fileURLToPath(new URL('../prisma/migrations', import.meta.url)))
    expect(ms[0]!.name).toBe('20260915092437_init')
    expect(ms.map((x) => x.name)).toEqual([...ms.map((x) => x.name)].sort())
    expect(ms.every((x) => x.sql.includes(';'))).toBe(true)
  })
})

describe('pgConfig', () => {
  it('drops Prisma\'s parameters and keeps TLS (without the CA check) only when sslmode asks for it', () => {
    expect(pgConfig('postgresql://u:p@db.example:5432/described?connection_limit=1&sslmode=require')).toEqual({ connectionString: 'postgresql://u:p@db.example:5432/described', ssl: { rejectUnauthorized: false } })
    expect(pgConfig('postgresql://u@localhost:5432/described')).toEqual({ connectionString: 'postgresql://u@localhost:5432/described' })
  })
})
