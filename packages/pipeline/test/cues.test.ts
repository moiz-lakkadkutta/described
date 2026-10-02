import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseVtt } from '@moizp/vega-media-kit/core'
import { fit } from '../src/steps/05-fit'
import type { Described } from '../src/steps/04-describe'
import type { FitCue } from '../src/steps/05-fit'
import { cueAudioKey, descriptionCueRows, descriptionsVtt } from '../src/cues'
import { publish, type CueDb } from '../src/steps/10-publish'
// The Player's own scheduler (pure, no React): the last hop of fit → VTT → kit parseVtt → app.
import { ExtendedScheduler, extendedCues } from '../../shared-ui/src/extended'

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/sintel-90-150.${n}.json`, import.meta.url), 'utf8'))
const shorten = (t: string, n: number) => t.split(' ').slice(0, n).join(' ')
const cue = (startMs: number, endMs: number, extended = false, text = 'A dragon lands.'): FitCue => ({ startMs, endMs, text, extended, wordCount: 3, shotIndex: 0 })

describe('extended cue, end to end (sintel-90-150: a shot with no gap)', () => {
  it('fit → descriptions.vtt → kit parseVtt → the Player scheduler, with the clip and row the API serves', async () => {
    const cues = await fit(fx('described') as Described[], fx('gaps'), shorten)
    const i = cues.findIndex((c) => c.extended)
    expect(i).toBeGreaterThanOrEqual(0) // shot 7 ("Words appear: …") has no gap long enough
    const vtt = descriptionsVtt(cues)
    expect(vtt).toContain(`d${i + 1}\n`)
    expect(vtt).toMatch(new RegExp(`\\{extended=1;words=${cues[i]!.wordCount}\\}`))

    const parsed = parseVtt(vtt, { trackId: 'descriptions' })
    const ext = extendedCues(parsed)
    expect(ext).toEqual(cues.flatMap((c, k) => (c.extended ? [expect.objectContaining({ id: `d${k + 1}`, start: c.startMs / 1000 })] : [])))
    // The VTT identifier and the app's count agree.
    for (const e of ext) expect(parsed[Number(e.id.slice(1)) - 1]!.id).toBe(e.id)

    // Playback at 4 Hz from 0:00 to the end: each extended cue starts exactly once.
    const s = new ExtendedScheduler(ext); s.begin(0)
    const fired: string[] = []
    for (let t = 0; t <= 61; t += 0.25) { const r = s.tick(t); if (r.trigger) fired.push(r.trigger.id) }
    expect(fired).toEqual(ext.map((e) => e.id))

    // d{n}'s row (n-th by start, end) carries its own clip, which publish uploads under that key.
    const rows = descriptionCueRows('t1', 'sintel-90-150', cues, new Set(cues.map((_, k) => `cue_${k}.mp3`)))
    const n = Number(ext[0]!.id.slice(1))
    expect(rows[n - 1]).toMatchObject({ extended: true, pollyKey: cueAudioKey('sintel-90-150', i), text: cues[i]!.text })
  })
})

describe('cue ids', () => {
  it('two cues on the same millisecond: d{n} follows start then end everywhere; each row keeps its own clip', () => {
    const cues = [cue(1000, 4000), cue(1000, 1100, true, 'Words appear: Berlin.')] // cues.json order: placed, then extended
    const parsed = parseVtt(descriptionsVtt(cues), { trackId: 'd' })
    expect(parsed.map((c) => [c.id, c.text])).toEqual([['d1', 'Words appear: Berlin.'], ['d2', 'A dragon lands.']])
    expect(extendedCues(parsed).map((c) => c.id)).toEqual(['d1'])
    expect(descriptionCueRows('t', 's', cues, new Set(['cue_0.mp3', 'cue_1.mp3'])).map((r) => r.pollyKey)).toEqual(['published/s/cues/cue_1.mp3', 'published/s/cues/cue_0.mp3'])
  })
  it('pollyKey is null for a cue whose clip was not published', () => {
    expect(descriptionCueRows('t', 's', [cue(0, 2000), cue(5000, 5100, true)], new Set(['cue_0.mp3'])).map((r) => r.pollyKey)).toEqual(['published/s/cues/cue_0.mp3', null])
  })
})

describe('publish (no AWS: upload and database are injected)', () => {
  function work() {
    const dir = mkdtempSync(join(tmpdir(), 'publish-'))
    mkdirSync(join(dir, 'hls')); writeFileSync(join(dir, 'hls/master.m3u8'), '#EXTM3U\n')
    for (const v of ['captions.vtt', 'sdh.vtt', 'descriptions.vtt']) writeFileSync(join(dir, v), 'WEBVTT\n')
    writeFileSync(join(dir, 'cues.json'), JSON.stringify([cue(0, 2000), cue(5000, 5100, true)]))
    writeFileSync(join(dir, 'cue_0.mp3'), ''); writeFileSync(join(dir, 'cue_1.mp3'), '')
    return dir
  }
  const fakeDb = (title: { id: string } | null) => {
    const ops: unknown[] = []
    const db: CueDb = {
      title: { findUnique: vi.fn(async () => title) },
      descriptionCue: { deleteMany: vi.fn((a) => ({ deleteMany: a })), createMany: vi.fn((a) => ({ createMany: a })) },
      $transaction: vi.fn(async (o: unknown[]) => { ops.push(...o) }),
    }
    return { db, ops }
  }
  beforeEach(() => { vi.stubEnv('S3_BUCKET_MEDIA', 'media') })
  afterEach(() => vi.unstubAllEnvs())

  it('uploads every clip (extended ones too) under published/{slug}/cues/ and replaces the title\'s DescriptionCue rows', async () => {
    const upload = vi.fn(async () => {})
    const { db, ops } = fakeDb({ id: 't1' })
    await publish({ slug: 'x', source: '', language: 'en', voice: 'Joanna', work: work() }, { upload, db })
    const keys = upload.mock.calls.map((c) => (c as unknown as [string, string])[1])
    expect(keys).toEqual(expect.arrayContaining(['s3://media/published/x/cues/cue_0.mp3', 's3://media/published/x/cues/cue_1.mp3', 's3://media/published/x/descriptions.vtt']))
    expect(db.title.findUnique).toHaveBeenCalledWith({ where: { slug: 'x' }, select: { id: true } })
    expect(ops).toEqual([
      { deleteMany: { where: { titleId: 't1' } } },
      { createMany: { data: [
        { titleId: 't1', startMs: 0, endMs: 2000, text: 'A dragon lands.', extended: false, wordCount: 3, pollyKey: 'published/x/cues/cue_0.mp3' },
        { titleId: 't1', startMs: 5000, endMs: 5100, text: 'A dragon lands.', extended: true, wordCount: 3, pollyKey: 'published/x/cues/cue_1.mp3' },
      ] } },
    ])
  })
  it('without a Title row the clips still go up and no rows are written', async () => {
    const upload = vi.fn(async () => {})
    const { db } = fakeDb(null)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await publish({ slug: 'x', source: '', language: 'en', voice: 'Joanna', work: work() }, { upload, db })
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(upload).toHaveBeenCalled()
    warn.mockRestore()
  })
})
