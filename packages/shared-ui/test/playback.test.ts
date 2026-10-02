import { readFileSync } from 'node:fs'
import path from 'node:path'
import { audioTracksFromHls, parseHlsMaster, textTracksFromHls, type TextTrack } from '@moizp/vega-media-kit/core'
import {
  audioTrackFor, captionTrackFor, characteristicsByUri, clampSeek, clock, crossfadeAudio, resumePoint, seekStep, statusLine, textSelection,
} from '../src/playback'
import { strings } from '../src/strings'
import { tokens } from '../src/theme/tokens'

const BASE = 'https://dco7qa0c4m1pw.cloudfront.net/published/sintel-90-210/master.m3u8'
const text = readFileSync(path.resolve(__dirname, 'fixtures/master.m3u8'), 'utf8')
const master = parseHlsMaster(text, BASE)
const audio = audioTracksFromHls(master)
const subs = textTracksFromHls(master)
const chars = characteristicsByUri(master.renditions)
const byName = (n: string) => subs.find((t) => t.label === n)!

describe('track choice from the parsed master playlist (by role and characteristics, never by id)', () => {
  it('AD on → the describes-video rendition; off → the main one', () => {
    expect(audioTrackFor(audio, true)?.label).toBe('Audio description')
    expect(audioTrackFor(audio, false)?.label).toBe('Original')
  })
  it('the same picks whatever order the playlist lists the renditions in', () => {
    const rev = [...audio].reverse().map((t, i) => ({ ...t, id: String(i) }))
    expect(audioTrackFor(rev, true)?.label).toBe('Audio description')
    expect(audioTrackFor(rev, false)?.label).toBe('Original')
  })
  it('Rich captions = describes-music-and-sound; Captions = the other caption track; Description text = descriptions', () => {
    expect(captionTrackFor(subs, 'sdh', chars)).toEqual({ track: byName('Rich captions'), kind: 'sdh' })
    expect(captionTrackFor(subs, 'captions', chars)).toEqual({ track: byName('Captions'), kind: 'captions' })
    expect(captionTrackFor(subs, 'descriptions', chars)).toEqual({ track: byName('Description text'), kind: 'descriptions' })
    expect(captionTrackFor(subs, 'off', chars)).toEqual({ kind: 'off' })
  })
  it('characteristics win over the name once the master is read', () => {
    const renamed = subs.map((t) => ({ ...t, label: t.label === 'Rich captions' ? 'English' : t.label === 'Captions' ? 'English (rich)' : t.label }))
    expect(captionTrackFor(renamed, 'sdh', chars).track?.url).toBe(byName('Rich captions').url)
  })
  it('before the master is read, the rendition name decides (as the kit reports it on Fire OS)', () => {
    expect(captionTrackFor(subs, 'sdh', null).track).toBe(byName('Rich captions'))
    expect(captionTrackFor(subs, 'captions', null).track).toBe(byName('Captions'))
  })
  it('a title without rich captions falls back to captions and says so', () => {
    const plainOnly = subs.filter((t) => t.label !== 'Rich captions')
    expect(captionTrackFor(plainOnly, 'sdh', chars)).toEqual({ track: byName('Captions'), kind: 'captions' })
    expect(captionTrackFor([], 'sdh', chars)).toEqual({ kind: 'off' })
  })
  it('description text is also selected while AD and Extended mode are on (DESC-007 reads its extended cues), but not shown', () => {
    const s = textSelection(subs, 'sdh', { adOn: true, extendedMode: true, chars })
    expect(s.ids).toEqual([byName('Rich captions').id, byName('Description text').id])
    expect(s.shown).toBe(byName('Rich captions').id)
    expect(textSelection(subs, 'off', { adOn: false, extendedMode: true, chars }).ids).toEqual([])
    expect(textSelection(subs, 'descriptions', { adOn: true, extendedMode: true, chars }).ids).toEqual([byName('Description text').id])
  })
  it('resolves subtitle URIs against the master URL, so they match the kit tracks', () => {
    expect([...chars.keys()]).toEqual(subs.map((t: TextTrack) => t.url))
  })
})

describe('seek', () => {
  it('10 s per press, faster the longer ◄► is held', () => {
    expect([0, 1999, 2000, 4999, 5000, 20000].map(seekStep)).toEqual([10, 10, 30, 30, 60, 60])
  })
  it('clamps to the start and to 1 s before the end when the duration is known', () => {
    expect(clampSeek(-4, 888)).toBe(0)
    expect(clampSeek(900, 888)).toBe(887)
    expect(clampSeek(900, null)).toBe(900)
  })
})

describe('resume', () => {
  it('starts at the saved position, at 0 without one, and over again in the last 30 s', () => {
    expect(resumePoint(321, 888)).toBe(321)
    expect(resumePoint(null, 888)).toBe(0)
    expect(resumePoint(870, 888)).toBe(0)
    expect(resumePoint(321, null)).toBe(321)
  })
})

describe('status line', () => {
  const base = { state: 'playing' as const, error: false, adOn: true, voice: 'Joanna', caption: 'sdh' as const }
  it.each([
    [base, 'Description on · Joanna · Rich captions'],
    [{ ...base, caption: 'captions' as const }, 'Description on · Joanna · Captions'],
    [{ ...base, caption: 'descriptions' as const }, 'Description on · Joanna · Description text'],
    [{ ...base, caption: 'off' as const }, 'Description on · Joanna · Captions off'],
    [{ ...base, adOn: false }, 'Description off · Rich captions'],
    [{ ...base, state: 'paused' as const }, 'Description on · Joanna · Rich captions'],
    [{ ...base, state: 'buffering' as const }, 'Loading…'],
    [{ ...base, state: 'loading' as const }, 'Loading…'],
    [{ ...base, error: true }, strings.player.error],
    [{ ...base, caption: null }, 'Description on · Joanna'],
    [{ ...base, adOn: false, caption: null }, 'Description off'],
    [{ ...base, state: 'ended' as const }, 'The end. Press Select to watch again, Back for the title.'],
    [{ ...base, state: 'error' as const }, 'Playback stopped. Press Select to try again, Back for the title.'],
  ])('%o → %s', (o, s) => expect(statusLine(o)).toBe(s))
  it('error copy never carries a code', () => expect(strings.player.error).not.toMatch(/\d|error|code/i))
  it('clock', () => expect([0, 75, 888, 3725].map(clock)).toEqual(['0:00', '1:15', '14:48', '1:02:05']))
})

describe('audio crossfade', () => {
  it('fades out, switches, fades in over tokens.motion.crossfadeMs when the player has a volume', async () => {
    const calls: string[] = []
    let waited = 0
    await crossfadeAudio({ selectAudio: (id) => calls.push(`select:${id}`), setVolume: (v) => calls.push(`v:${v}`) }, '1', async (ms) => { waited += ms })
    expect(calls).toEqual(['v:0.8', 'v:0.6', 'v:0.4', 'v:0.2', 'v:0', 'select:1', 'v:0.2', 'v:0.4', 'v:0.6', 'v:0.8', 'v:1'])
    expect(waited).toBeCloseTo(tokens.motion.crossfadeMs)
  })
  it('a kit player (no volume control yet) switches at once', async () => {
    const selectAudio = vi.fn()
    const wait = vi.fn(async () => {})
    await crossfadeAudio({ selectAudio }, '1', wait)
    expect(selectAudio).toHaveBeenCalledWith('1')
    expect(wait).not.toHaveBeenCalled()
  })
})
