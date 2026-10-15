import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_SEED_BYTES, exportCatalogue, seedEvent, type ExportDb } from '../src/hosted/catalogue'

/**
 * `pnpm --filter @described/api export:catalogue [--out <file>]` (DESC-034) — reads the published titles from DATABASE_URL
 * (your local database) and writes the seed payload for the hosted copy: `{ "op": "seed", "catalogue": … }`.
 * Catalogue tables only (Title, Asset, Rendition, TextTrack, DescriptionCue); no device data. No AWS call: sending it is
 * `aws lambda invoke … --payload fileb://<file>` (README, "Try it"; docs/aws.md).
 */
export const DEFAULT_OUT = '.hosted/seed-event.json'

export async function writeSeedEvent(db: ExportDb, out: string, now = new Date()) {
  const catalogue = await exportCatalogue(db, now)
  const body = JSON.stringify(seedEvent(catalogue))
  if (Buffer.byteLength(body) > MAX_SEED_BYTES) throw new Error(`seed payload is ${Buffer.byteLength(body)} bytes; one invoke takes at most ${MAX_SEED_BYTES}`)
  await mkdir(path.dirname(out), { recursive: true })
  await writeFile(out, body)
  return { slugs: catalogue.titles.map((t) => t.slug), cues: catalogue.titles.reduce((n, t) => n + t.cues.length, 0), bytes: Buffer.byteLength(body) }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf('--out')
  const out = i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : DEFAULT_OUT
  const { PrismaClient } = await import('@prisma/client')
  const db = new PrismaClient()
  try {
    const r = await writeSeedEvent(db as unknown as ExportDb, out)
    console.log(`wrote ${out}: ${r.slugs.length} published titles (${r.slugs.join(', ')}), ${r.cues} cues, ${r.bytes} bytes`)
  } finally { await db.$disconnect() }
}
