import { Router } from 'express'
import { db } from '../lib/db'
import { env } from '../lib/env'
import { notFound, ok } from '../lib/http'

export const titles: Router = Router()
const cdn = (key: string) => `https://${env.CLOUDFRONT_DOMAIN ?? 'cdn.invalid'}/${key}`

titles.get('/:slug', async (req, res, next) => {
  try {
    const t = await db.title.findUnique({ where: { slug: req.params.slug }, include: { renditions: true, tracks: true, cues: { where: { extended: true }, take: 1, orderBy: { startMs: 'asc' } } } })
    if (!t || t.status !== 'published') throw notFound('Title')
    const sample = t.cues[0]
    ok(res, {
      slug: t.slug, name: t.name, year: t.year, durationS: t.durationS, posterUrl: t.posterKey ? cdn(t.posterKey) : null,
      badges: ['ad', 'sdh'], extendedCount: t.cues.length, resumeS: null, synopsis: t.synopsis, attribution: t.attribution, voice: t.voice,
      manifestUrl: cdn(`published/${t.slug}/master.m3u8`),
      tracks: {
        audio: t.renditions.map((r: (typeof t.renditions)[number]) => ({ id: r.kind, language: r.language, role: r.kind === 'audio_ad' ? 'description' : 'main', label: r.kind === 'audio_ad' ? `${r.language} – Audio description (${t.voice})` : `${r.language} – Original` })),
        text: t.tracks.map((x: (typeof t.tracks)[number]) => ({ id: `${x.kind}-${x.language}`, language: x.language, kind: x.kind, label: x.kind, url: cdn(x.s3Key) })),
      },
      sampleCue: sample && sample.pollyKey ? { startS: sample.startMs / 1000, audioUrl: cdn(sample.pollyKey), text: sample.text } : null,
    })
  } catch (e) { next(e) }
})

/** Descriptions as WebVTT with {extended=1} meta so the app can pause-speak-resume. */
titles.get('/:slug/descriptions.vtt', async (req, res, next) => {
  try {
    const t = await db.title.findUnique({ where: { slug: req.params.slug }, include: { cues: { orderBy: { startMs: 'asc' } } } })
    if (!t) throw notFound('Title')
    const ts = (ms: number) => new Date(ms).toISOString().slice(11, 23)
    const body = ['WEBVTT', '', ...t.cues.flatMap((c: (typeof t.cues)[number], i: number) => [`d${i + 1}`, `${ts(c.startMs)} --> ${ts(c.endMs)}`, `${c.text}${c.extended ? ' {extended=1;words=' + c.wordCount + '}' : ''}`, ''])].join('\n')
    res.type('text/vtt').send(body)
  } catch (e) { next(e) }
})

titles.get('/:slug/cues/:cueId/audio', async (req, res, next) => {
  try {
    const c = await db.descriptionCue.findUnique({ where: { id: req.params.cueId } })
    if (!c?.pollyKey) throw notFound('Cue audio')
    res.redirect(302, cdn(c.pollyKey))
  } catch (e) { next(e) }
})
