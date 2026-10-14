import { cacheControl, contentType } from './s3'
import { SLUG_RE } from './steps'

/**
 * WebVTT voice spans: `<v Name>`, `<v.class Name>`, `</v>` (https://www.w3.org/TR/webvtt1/#webvtt-cue-voice-span). The pipeline wrote
 * Transcribe's anonymous labels this way (`<v spk_0>`) until 08-text's textTrackVtt; the kit's parseVtt reads one as the cue's speaker
 * and CueOverlay draws it as "[spk_0] ". A tag can never be in a header, an id or a timing line, so only cue text changes. Every voice
 * span goes, a real `<v Name>` too: the pipeline never wrote one (mergeSdh puts an accepted name in the text as "[Name] ", which stays).
 * The annotation stops at a line end, so a malformed `<v spk_0` with no `>` is left alone rather than eating the next cue's timing.
 */
const VOICE_SPAN = /<v(?:\.[^\s>]*)?(?:[ \t][^>\r\n]*)?>|<\/v>/g

/** The VTT without voice spans; the rest, a "[Name] " SDH tag included, byte for byte. Idempotent. */
export const stripVoiceSpans = (vtt: string) => vtt.replace(VOICE_SPAN, '')

/** The published caption objects of a title: the whole-file VTTs and the HLS WebVTT segments of the Captions and Rich captions tracks. */
const CAPTION_KEY = /^(?:captions|sdh)(?:\.vtt|\/\d+\.vtt)$/

export interface RepublishDeps {
  /** Every key under the prefix (paginated). */
  list: (bucket: string, prefix: string) => Promise<string[]>
  get: (bucket: string, key: string) => Promise<string>
  put: (bucket: string, key: string, body: string, meta: { ContentType: string; CacheControl: string }) => Promise<void>
  invalidate: (distributionId: string, paths: string[]) => Promise<void>
}
export interface RepublishOpts { bucket: string; run: boolean; distributionId?: string; /** called after each object is written, so a partial run is visible */ onWrite?: (key: string) => void }
export interface RepublishReport { slug: string; checked: string[]; changed: string[]; invalidated: boolean }

/**
 * Rewrites `published/<slug>/{captions,sdh}.vtt` and `published/<slug>/{captions,sdh}/<n>.vtt` without voice spans, in place, for titles
 * published before textTrackVtt that have no work dir to re-run. Only objects whose text changes are written, with the publish step's
 * ContentType and CacheControl (60 s for VTTs, ./s3); playlists and timings are untouched, so the HLS tracks stay valid. A dry run
 * (run: false) reads only. After a run that changed something, one `/published/<slug>/*` invalidation (one path: free within 1,000 a
 * month) when distributionId is given; without it the VTTs' 60 s max-age still turns the edge copies over within a minute.
 */
export async function stripPublishedVoiceSpans(slug: string, opts: RepublishOpts, deps: RepublishDeps): Promise<RepublishReport> {
  if (!SLUG_RE.test(slug)) throw new Error(`not a title slug: ${JSON.stringify(slug)}`)
  const prefix = `published/${slug}/`
  const checked = (await deps.list(opts.bucket, prefix)).filter((k) => CAPTION_KEY.test(k.slice(prefix.length))).sort()
  const changed: string[] = []
  for (const key of checked) {
    const before = await deps.get(opts.bucket, key)
    const after = stripVoiceSpans(before)
    if (after === before) continue
    changed.push(key)
    if (opts.run) { await deps.put(opts.bucket, key, after, { ContentType: contentType(key), CacheControl: cacheControl(key) }); opts.onWrite?.(key) }
  }
  let invalidated = false
  if (opts.run && changed.length) {
    if (opts.distributionId) { await deps.invalidate(opts.distributionId, [`/${prefix}*`]); invalidated = true }
    else console.warn(`CLOUDFRONT_DISTRIBUTION_ID is not set: nothing invalidated (the edge copies expire within 60 s)`)
  }
  return { slug, checked, changed, invalidated }
}
