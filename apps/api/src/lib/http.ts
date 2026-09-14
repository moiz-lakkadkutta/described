import type { NextFunction, Request, Response } from 'express'
import { ZodError, type ZodTypeAny } from 'zod'
/** `{ success, data }` envelope + Zod validation, matching the Socials API conventions. */
export const ok = <T>(res: Response, data: T, status = 200) => res.status(status).json({ success: true, data })
export class AppError extends Error { constructor(public status: number, public code: string, message: string) { super(message) } }
export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`)
export function validate<T extends ZodTypeAny>(schema: T, pick: (req: Request) => unknown) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const r = schema.safeParse(pick(req))
    if (!r.success) return next(new AppError(400, 'VALIDATION', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')))
    ;(req as Request & { valid: unknown }).valid = r.data
    next()
  }
}
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) return res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } })
  if (err instanceof ZodError) return res.status(400).json({ success: false, error: { code: 'VALIDATION', message: err.message } })
  console.error(err)
  return res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Something went wrong' } })
}
