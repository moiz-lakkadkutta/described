import { Router } from 'express'
import type { About } from '@described/contracts'
import { db } from '../lib/db'
import { ok } from '../lib/http'

export const about: Router = Router()
/** Settings → About & licenses: the attribution sentence of every published title (CC-BY requires it in-app). */
about.get('/', async (_req, res, next) => {
  try {
    const titles = await db.title.findMany({ where: { status: 'published' }, orderBy: { name: 'asc' }, select: { name: true, attribution: true } })
    const data: About = { titles }
    ok(res, data)
  } catch (e) { next(e) }
})
