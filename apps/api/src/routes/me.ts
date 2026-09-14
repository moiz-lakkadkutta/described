import { Router } from 'express'
import { Prefs, ProgressPut } from '@described/contracts'
import { db } from '../lib/db'
import { ok, validate } from '../lib/http'

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
