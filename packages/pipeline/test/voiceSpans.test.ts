import { parseVtt } from '@moiz0309/vega-media-kit/core'
import { stripPublishedVoiceSpans, stripVoiceSpans, type RepublishDeps } from '../src/voiceSpans'

// Copied from the bucket on 2026-10-14: published/elephants-dream-0-60/captions.vtt (head) and sintel-90-150-r2/sdh/9.vtt.
const WHOLE = 'WEBVTT\n\nc3\n00:00:25.069 --> 00:00:26.069\n<v spk_0>Emo,\n\nc4\n00:00:26.389 --> 00:00:27.389\n<v spk_1>Emo.\n'
const SEGMENT = "WEBVTT\n\nc4\n00:00:31.329 --> 00:00:32.970 align:center\n<v spk_0>You're lucky your blood's still flowing.\n\ns1\n00:00:33.170 --> 00:00:34.826 align:center\n[broth pours]\n\nc5\n00:00:35.020 --> 00:00:36.020 align:center\n<v spk_0>Thank you.\n\n"

describe('stripVoiceSpans', () => {
  it('removes the Transcribe voice spans and changes nothing else', () => {
    expect(stripVoiceSpans(WHOLE)).toBe('WEBVTT\n\nc3\n00:00:25.069 --> 00:00:26.069\nEmo,\n\nc4\n00:00:26.389 --> 00:00:27.389\nEmo.\n')
    expect(stripVoiceSpans(SEGMENT)).toBe(SEGMENT.replaceAll('<v spk_0>', ''))
  })
  it('the kit then reads no speaker, so CueOverlay draws no "[spk_0] "', () => {
    expect(parseVtt(WHOLE, { trackId: 'captions' })[0]!.speaker).toBe('spk_0') // the fault
    expect(parseVtt(stripVoiceSpans(WHOLE), { trackId: 'captions' }).map((c) => c.speaker)).toEqual([undefined, undefined])
  })
  it('keeps an SDH "[Name] " tag, which the kit reads as the speaker', () => {
    const fixed = stripVoiceSpans('WEBVTT\n\nc2\n00:00:03.000 --> 00:00:06.000\n<v spk_1>[Proog] I am here.\n')
    expect(fixed).toBe('WEBVTT\n\nc2\n00:00:03.000 --> 00:00:06.000\n[Proog] I am here.\n')
    expect(parseVtt(fixed, { trackId: 'sdh' })[0]).toMatchObject({ speaker: 'Proog', text: 'I am here.' })
  })
  it('leaves an unclosed span with no ">" (malformed) and the cues after it unchanged', () => {
    const v = 'WEBVTT\n\nc1\n00:00:01.000 --> 00:00:02.000\n<v spk_0 oops\n\nc2\n00:00:03.000 --> 00:00:04.000\nNext <i>line</i>\n'
    expect(stripVoiceSpans(v)).toBe(v)
  })
  it('removes class-annotated and closed spans, keeps <i>, and is idempotent', () => {
    const v = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v.loud spk_2>Run</v> <i>now</i>\n'
    expect(stripVoiceSpans(v)).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nRun <i>now</i>\n')
    expect(stripVoiceSpans(stripVoiceSpans(v))).toBe(stripVoiceSpans(v))
  })
})

describe('stripPublishedVoiceSpans', () => {
  const objects = (): Map<string, string> => new Map([
    ['published/ed/captions.vtt', WHOLE], ['published/ed/captions/1.vtt', 'WEBVTT\n\n'], ['published/ed/captions/6.vtt', SEGMENT],
    ['published/ed/sdh.vtt', WHOLE], ['published/ed/sdh/6.vtt', SEGMENT], ['published/ed/captions.m3u8', '#EXTM3U\n<v spk_0>'],
    ['published/ed/descriptions.vtt', 'WEBVTT\n\nd1\n00:00:01.000 --> 00:00:02.000\n<v x>not a caption track\n'],
    ['published/ed-2/captions.vtt', WHOLE],
  ])
  const deps = (store: Map<string, string>) => {
    const puts: Array<{ key: string; body: string; meta: object }> = [], invalidations: Array<{ id: string; paths: string[] }> = []
    const d: RepublishDeps = {
      list: async (bucket, prefix) => { expect(bucket).toBe('b'); return [...store.keys()].filter((k) => k.startsWith(prefix)) },
      get: async (_b, key) => store.get(key)!,
      put: async (_b, key, body, meta) => { puts.push({ key, body, meta }); store.set(key, body) },
      invalidate: async (id, paths) => { invalidations.push({ id, paths }) },
    }
    return { d, puts, invalidations }
  }

  it('a dry run reports the caption VTTs that would change and writes nothing', async () => {
    const { d, puts, invalidations } = deps(objects())
    const r = await stripPublishedVoiceSpans('ed', { bucket: 'b', run: false, distributionId: 'E1' }, d)
    expect(r.checked).toEqual(['published/ed/captions.vtt', 'published/ed/captions/1.vtt', 'published/ed/captions/6.vtt', 'published/ed/sdh.vtt', 'published/ed/sdh/6.vtt'])
    expect(r.changed).toEqual(['published/ed/captions.vtt', 'published/ed/captions/6.vtt', 'published/ed/sdh.vtt', 'published/ed/sdh/6.vtt'])
    expect(puts).toEqual([])
    expect(invalidations).toEqual([])
    expect(r.invalidated).toBe(false)
  })
  it('a run rewrites only changed caption objects with 60 s text/vtt, leaves playlists, descriptions and other slugs, invalidates once', async () => {
    const store = objects()
    const { d, puts, invalidations } = deps(store)
    const written: string[] = []
    const r = await stripPublishedVoiceSpans('ed', { bucket: 'b', run: true, distributionId: 'E1', onWrite: (k) => written.push(k) }, d)
    expect(puts.map((p) => p.key)).toEqual(r.changed)
    expect(written).toEqual(r.changed)
    for (const p of puts) { expect(p.meta).toEqual({ ContentType: 'text/vtt', CacheControl: 'public,max-age=60' }); expect(p.body).not.toContain('<v') }
    expect(store.get('published/ed/captions.m3u8')).toContain('<v spk_0>')
    expect(store.get('published/ed/descriptions.vtt')).toContain('<v x>')
    expect(store.get('published/ed-2/captions.vtt')).toBe(WHOLE)
    expect(invalidations).toEqual([{ id: 'E1', paths: ['/published/ed/*'] }])
    expect(r.invalidated).toBe(true)
    // a second run finds nothing to do and does not invalidate again
    const again = await stripPublishedVoiceSpans('ed', { bucket: 'b', run: true, distributionId: 'E1' }, d)
    expect(again.changed).toEqual([])
    expect(invalidations).toHaveLength(1)
  })
  it('a run without a distribution id writes but does not invalidate', async () => {
    const { d, invalidations } = deps(objects())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await stripPublishedVoiceSpans('ed', { bucket: 'b', run: true }, d)
    expect(r.changed).toHaveLength(4)
    expect(invalidations).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
  it('a title with no captions (Caminandes) is a no-op', async () => {
    const { d, puts } = deps(new Map([['published/cam/captions.vtt', 'WEBVTT\n'], ['published/cam/sdh.vtt', 'WEBVTT\n']]))
    expect((await stripPublishedVoiceSpans('cam', { bucket: 'b', run: true, distributionId: 'E1' }, d)).changed).toEqual([])
    expect(puts).toEqual([])
  })
  it('refuses a slug that is not one (an empty or path-like prefix would reach other titles)', async () => {
    const { d } = deps(objects())
    for (const bad of ['', '../x', 'ed/', '*']) await expect(stripPublishedVoiceSpans(bad, { bucket: 'b', run: true }, d)).rejects.toThrow('not a title slug')
  })
})
