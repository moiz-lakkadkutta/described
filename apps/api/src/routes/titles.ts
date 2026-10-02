import { Router } from 'express'
import { serializeVtt } from '@moizp/vega-media-kit/core'
import { db } from '../lib/db'
import { env } from '../lib/env'
import { notFound, ok } from '../lib/http'

export const titles: Router = Router()
const cdn = (key: string) => `https://${env.CLOUDFRONT_DOMAIN ?? 'cdn.invalid'}/${key}`

titles.get('/:slug', async (req, res, next) => {
  try {
    const deviceId = String(req.header('x-device-id') ?? 'anon')
    const t = await db.title.findUnique({ where: { slug: req.params.slug }, include: { renditions: true, tracks: true, cues: { where: { extended: true }, take: 1, orderBy: { startMs: 'asc' } }, _count: { select: { cues: { where: { extended: true } } } }, progress: { where: { profile: { deviceId } } } } })
    if (!t || t.status !== 'published') throw notFound('Title')
    const sample = t.cues[0]
    ok(res, {
      slug: t.slug, name: t.name, year: t.year, durationS: t.durationS, posterUrl: t.posterKey ? cdn(t.posterKey) : null,
      badges: ['ad', 'sdh', ...(t._count.cues ? (['extended'] as const) : [])], extendedCount: t._count.cues, // cues above is the first extended cue only (the sample)
      resumeS: t.progress[0]?.positionS ?? null, // this device's saved position (PUT /me/progress); the Player resumes from it
      synopsis: t.synopsis, attribution: t.attribution, voice: t.voice,
      manifestUrl: cdn(`published/${t.slug}/master.m3u8`),
      tracks: {
        audio: t.renditions.map((r: (typeof t.renditions)[number]) => ({ id: r.kind, language: r.language, role: r.kind === 'audio_ad' ? 'description' : 'main', label: r.kind === 'audio_ad' ? `${r.language} – Audio description (${t.voice})` : `${r.language} – Original` })),
        text: t.tracks.map((x: (typeof t.tracks)[number]) => ({ id: `${x.kind}-${x.language}`, language: x.language, kind: x.kind, label: x.kind, url: cdn(x.s3Key) })),
      },
      sampleCue: sample && sample.pollyKey ? { startS: sample.startMs / 1000, audioUrl: cdn(sample.pollyKey), text: sample.text } : null,
    })
  } catch (e) { next(e) }
})

/** Description cues in canonical order — start, then end — so `d{n}` is the n-th (packages/pipeline/src/cues.ts). */
const cueOrder = [{ startMs: 'asc' as const }, { endMs: 'asc' as const }]

/** One line of cue text: whitespace (blank lines too) collapsed, no `-->` or `{…}` that a parser would read as timing or meta. */
export const vttText = (t: string) => t.replace(/-->/g, '→').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()

/**
 * Descriptions as WebVTT with {extended=1} meta: the app's source for Extended mode (DESC-007). Cue ids are `d{n}` by
 * position in cueOrder — the same n the audio route takes — and the app uses the parsed id, so a cue the parser drops
 * (text that cleans to nothing) cannot shift the others. Serialised by the kit, like the pipeline's descriptions.vtt.
 */
titles.get('/:slug/descriptions.vtt', async (req, res, next) => {
  try {
    const t = await db.title.findUnique({ where: { slug: req.params.slug }, include: { cues: { orderBy: cueOrder } } })
    if (!t || t.status !== 'published') throw notFound('Title')
    const body = serializeVtt(t.cues.map((c: (typeof t.cues)[number], i: number) => ({
      trackId: 'descriptions', id: `d${i + 1}`, start: c.startMs / 1000, end: c.endMs / 1000, text: vttText(c.text),
      ...(c.extended ? { meta: { extended: '1', words: String(c.wordCount) } } : {}),
    })))
    res.type('text/vtt').send(body)
  } catch (e) { next(e) }
})

/**
 * The Polly clip of description cue `d{n}` (the n-th of the title, see cueOrder), for Extended mode (DESC-007): a 302 to
 * the clip the pipeline published (10-publish sets pollyKey). Never synthesises at request time — no clip, 404.
 * Clip keys carry a content hash (published/{slug}/cues/cue_{i}.{hash}.mp3), so the CDN object is immutable and a re-run
 * moves the row to a new key; only this redirect is short-lived (5 min), so a re-run is heard within minutes.
 */
titles.get('/:slug/cues/:cueId/audio', async (req, res, next) => {
  try {
    const n = /^d([1-9]\d{0,5})$/.exec(req.params.cueId)
    if (!n) throw notFound('Cue audio')
    const t = await db.title.findUnique({ where: { slug: req.params.slug }, select: { status: true, cues: { orderBy: cueOrder, skip: Number(n[1]) - 1, take: 1, select: { pollyKey: true } } } })
    const key = t?.status === 'published' ? t.cues[0]?.pollyKey : null
    if (!key) throw notFound('Cue audio')
    res.set('Cache-Control', 'public, max-age=300').redirect(302, cdn(key))
  } catch (e) { next(e) }
})
