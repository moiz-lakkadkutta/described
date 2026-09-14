import { Router } from 'express'
import { db } from '../lib/db'
import { env } from '../lib/env'
import { ok } from '../lib/http'
import type { CatalogItem } from '@described/contracts'

export const catalog: Router = Router()
const cdn = (key: string | null) => (key && env.CLOUDFRONT_DOMAIN ? `https://${env.CLOUDFRONT_DOMAIN}/${key}` : null)

/** Rows for Home. Profile comes from the x-device-id header (no login on TV). */
catalog.get('/', async (req, res, next) => {
  try {
    const deviceId = String(req.header('x-device-id') ?? 'anon')
    const titles = await db.title.findMany({ where: { status: 'published' }, orderBy: { createdAt: 'desc' }, include: { cues: { where: { extended: true }, select: { id: true } }, progress: { where: { profile: { deviceId } } } } })
    const items: CatalogItem[] = titles.map((t: (typeof titles)[number]) => ({
      slug: t.slug, name: t.name, year: t.year, durationS: t.durationS, posterUrl: cdn(t.posterKey),
      badges: ['ad', 'sdh', ...(t.cues.length ? (['extended'] as const) : [])], extendedCount: t.cues.length,
      resumeS: t.progress[0]?.positionS ?? null,
    }))
    ok(res, { continue: items.filter((i) => i.resumeS && i.resumeS > 30), newlyDescribed: items.slice(0, 6), all: items })
  } catch (e) { next(e) }
})
