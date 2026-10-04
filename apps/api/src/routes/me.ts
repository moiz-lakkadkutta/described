import { Router } from 'express'
import { Prefs, ProgressPut, type MyList } from '@described/contracts'
import { db } from '../lib/db'
import { notFound, ok, validate } from '../lib/http'

export const me: Router = Router()
const device = (h: unknown) => String(h ?? 'anon')
async function profile(deviceId: string) { return db.profile.upsert({ where: { deviceId }, create: { deviceId }, update: {} }) }

me.get('/prefs', async (req, res, next) => { try { ok(res, await profile(device(req.header('x-device-id')))) } catch (e) { next(e) } })
me.put('/prefs', validate(Prefs.partial(), (r) => r.body), async (req, res, next) => {
  try { const p = await profile(device(req.header('x-device-id'))); ok(res, await db.profile.update({ where: { id: p.id }, data: (req as never as { valid: object }).valid })) } catch (e) { next(e) }
})
me.put('/progress', validate(ProgressPut, (r) => r.body), async (req, res, next) => {
  try {
    const { titleSlug, positionS } = (req as never as { valid: { titleSlug: string; positionS: number } }).valid
    const p = await profile(device(req.header('x-device-id')))
    const t = await db.title.findUniqueOrThrow({ where: { slug: titleSlug } })
    ok(res, await db.progress.upsert({ where: { profileId_titleId: { profileId: p.id, titleId: t.id } }, create: { profileId: p.id, titleId: t.id, positionS }, update: { positionS } }))
  } catch (e) { next(e) }
})

// My list: per device, published titles only, newest first. PUT is idempotent (one row per title); DELETE of a title
// that is not in the list still answers the list. Every call answers the whole list, so the app can settle on it.
async function myList(profileId: string): Promise<MyList> {
  const rows = await db.listItem.findMany({ where: { profileId, title: { status: 'published' } }, orderBy: { createdAt: 'desc' }, select: { title: { select: { slug: true } } } })
  return { slugs: rows.map((r) => r.title.slug) }
}
me.get('/list', async (req, res, next) => { try { ok(res, await myList((await profile(device(req.header('x-device-id')))).id)) } catch (e) { next(e) } })
me.put('/list/:slug', async (req, res, next) => {
  try {
    const p = await profile(device(req.header('x-device-id')))
    const t = await db.title.findFirst({ where: { slug: req.params.slug, status: 'published' } })
    if (!t) throw notFound('Title')
    await db.listItem.upsert({ where: { profileId_titleId: { profileId: p.id, titleId: t.id } }, create: { profileId: p.id, titleId: t.id }, update: {} })
    ok(res, await myList(p.id))
  } catch (e) { next(e) }
})
me.delete('/list/:slug', async (req, res, next) => {
  try {
    const p = await profile(device(req.header('x-device-id')))
    await db.listItem.deleteMany({ where: { profileId: p.id, title: { slug: req.params.slug } } })
    ok(res, await myList(p.id))
  } catch (e) { next(e) }
})
