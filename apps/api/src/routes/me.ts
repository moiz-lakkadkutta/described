import { Router, type Request } from 'express'
import { Prisma } from '@prisma/client'
import { Prefs, ProgressPut, type MyList } from '@described/contracts'
import { db } from '../lib/db'
import { AppError, notFound, ok, validate } from '../lib/http'

export const me: Router = Router()
/**
 * The device id names a Profile row, so it is bounded (DESC-034 review M1): letters, digits, _ and -, at most 64 — what the
 * apps send (`fireos-<Android ID>`, `dev-device`). No header is the shared `anon` profile, as before; anything else is a 400
 * before any query, so a public API cannot be made to store arbitrary strings.
 */
export const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/
const deviceOf = (req: Request) => (req.res!.locals as { deviceId: string }).deviceId
me.use((req, res, next) => {
  const raw = req.header('x-device-id')
  const id = raw === undefined ? 'anon' : raw
  if (!DEVICE_ID.test(id)) return next(new AppError(400, 'VALIDATION', 'x-device-id: letters, digits, _ or -, at most 64'))
  res.locals.deviceId = id
  next()
})
// Writes create the Profile; reads never do (a device that only looks around leaves no row). A new device's app fires
// GET /me/prefs and GET /me/list together and its first write can race another: two upserts can both miss and both insert;
// the loser fails the unique constraint on deviceId (P2002). The row now exists, so read it. Prisma documents this race:
// https://www.prisma.io/docs/orm/reference/prisma-client-reference#upsert
async function profile(deviceId: string) {
  try {
    return await db.profile.upsert({ where: { deviceId }, create: { deviceId }, update: {} })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return db.profile.findUniqueOrThrow({ where: { deviceId } })
    throw e
  }
}
/** What a new Profile row would hold (schema.prisma defaults), answered for a device with no row yet. */
export const defaultPrefs = (deviceId: string) => ({ deviceId, adDefault: true, extendedMode: true, voice: 'Joanna', captionKind: 'sdh', captionScale: 100, captionStyle: 'system', firstRunDone: false })

me.get('/prefs', async (req, res, next) => {
  try { const id = deviceOf(req); ok(res, (await db.profile.findUnique({ where: { deviceId: id } })) ?? defaultPrefs(id)) } catch (e) { next(e) }
})
me.put('/prefs', validate(Prefs.partial(), (r) => r.body), async (req, res, next) => {
  try { const p = await profile(deviceOf(req)); ok(res, await db.profile.update({ where: { id: p.id }, data: (req as never as { valid: object }).valid })) } catch (e) { next(e) }
})
me.put('/progress', validate(ProgressPut, (r) => r.body), async (req, res, next) => {
  try {
    const { titleSlug, positionS } = (req as never as { valid: { titleSlug: string; positionS: number } }).valid
    const t = await db.title.findUnique({ where: { slug: titleSlug } })
    if (!t) throw notFound('Title')
    const p = await profile(deviceOf(req))
    ok(res, await db.progress.upsert({ where: { profileId_titleId: { profileId: p.id, titleId: t.id } }, create: { profileId: p.id, titleId: t.id, positionS }, update: { positionS } }))
  } catch (e) { next(e) }
})

// My list: per device, published titles only, newest first. PUT is idempotent (one row per title); DELETE of a title
// that is not in the list still answers the list. Every call answers the whole list, so the app can settle on it.
async function myList(profileId: string): Promise<MyList> {
  const rows = await db.listItem.findMany({ where: { profileId, title: { status: 'published' } }, orderBy: { createdAt: 'desc' }, select: { title: { select: { slug: true } } } })
  return { slugs: rows.map((r) => r.title.slug) }
}
me.get('/list', async (req, res, next) => {
  try { const p = await db.profile.findUnique({ where: { deviceId: deviceOf(req) } }); ok(res, p ? await myList(p.id) : { slugs: [] }) } catch (e) { next(e) }
})
me.put('/list/:slug', async (req, res, next) => {
  try {
    const p = await profile(deviceOf(req))
    const t = await db.title.findFirst({ where: { slug: req.params.slug, status: 'published' } })
    if (!t) throw notFound('Title')
    await db.listItem.upsert({ where: { profileId_titleId: { profileId: p.id, titleId: t.id } }, create: { profileId: p.id, titleId: t.id }, update: {} })
    ok(res, await myList(p.id))
  } catch (e) { next(e) }
})
me.delete('/list/:slug', async (req, res, next) => {
  try {
    const p = await profile(deviceOf(req))
    await db.listItem.deleteMany({ where: { profileId: p.id, title: { slug: req.params.slug } } })
    ok(res, await myList(p.id))
  } catch (e) { next(e) }
})
