import { Router } from 'express'
import { PromptKey, Voice, promptAudioKey } from '@described/contracts'
import { env } from '../lib/env'
import { notFound } from '../lib/http'

export const prompts: Router = Router()
/**
 * App-voice prompt clips (first run, Settings voice preview): a redirect to CloudFront published/prompts/<voice>/<key>.mp3,
 * so the app needs no CDN address. The clips come from `pnpm pipeline prompts --run` (see PromptKey in contracts); until
 * that has run, CloudFront answers 404, the app's speak() settles, and the text is still announced.
 */
prompts.get('/:voice/:file', (req, res, next) => {
  const voice = Voice.safeParse(req.params.voice)
  const key = PromptKey.safeParse(/^(\w+)\.mp3$/.exec(req.params.file)?.[1])
  if (!voice.success || !key.success || !env.CLOUDFRONT_DOMAIN) return next(notFound('Prompt audio'))
  res.redirect(302, `https://${env.CLOUDFRONT_DOMAIN}/${promptAudioKey(voice.data, key.data)}`)
})
