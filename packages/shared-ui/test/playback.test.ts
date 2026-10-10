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
    expect(waited).toBeCloseTo(tokens.motion.crossfadeMs + tokens.motion.audioSwitchHoldMs)
  })
  it('holds silence across the decoder reset before fading up', async () => {
    // Fire OS: ExoPlayer flushes the audio decoder and AudioTrack 70–110 ms after a switch. The volume stays at 0 from
    // selectAudio until audioSwitchHoldMs has passed, so that gap falls in silence, never mid-fade.
    vi.useFakeTimers()
    try {
      const vols: { t: number; v: number }[] = []
      let selectedAt = -1
      const p = { selectAudio: () => { selectedAt = Date.now() }, setVolume: (v: number) => { vols.push({ t: Date.now(), v }) } }
      const t0 = Date.now()
      const done = crossfadeAudio(p, 'a')
      await vi.advanceTimersByTimeAsync(tokens.motion.crossfadeMs + tokens.motion.audioSwitchHoldMs + 50)
      await done
      expect(selectedAt - t0).toBe(tokens.motion.crossfadeMs / 2)
      const before = vols.filter((x) => x.t <= selectedAt)
      expect(before.at(-1)!.v).toBe(0) // fully silent when the track changes
      const firstUp = vols.find((x) => x.t > selectedAt && x.v > 0)!
      expect(firstUp.t - selectedAt).toBeGreaterThanOrEqual(tokens.motion.audioSwitchHoldMs)
      expect(vols.filter((x) => x.t > selectedAt && x.t < selectedAt + tokens.motion.audioSwitchHoldMs).every((x) => x.v === 0)).toBe(true)
      expect(vols.at(-1)!.v).toBe(1)
      expect(tokens.motion.audioSwitchHoldMs).toBeGreaterThanOrEqual(110) // the slowest reset seen in logcat (DESC-006 device run)
    } finally { vi.useRealTimers() }
  })
  it('a newer switch during the hold takes over: it selects at once (already silent) and holds the full hold before rising', async () => {
    vi.useFakeTimers()
    try {
      const half = tokens.motion.crossfadeMs / 2, hold = tokens.motion.audioSwitchHoldMs
      const calls: { t: number; c: string }[] = []
      const p = { selectAudio: (id: string) => calls.push({ t: Date.now(), c: `select:${id}` }), setVolume: (v: number) => calls.push({ t: Date.now(), c: `v:${v}` }) }
      const first = crossfadeAudio(p, 'a')
      await vi.advanceTimersByTimeAsync(half + 20) // 'a' selected, holding at 0: two switches within ~0.2 s
      expect(calls.at(-1)!.c).toBe('select:a')
      const at = calls.length, t1 = Date.now()
      const second = crossfadeAudio(p, 'b')
      await vi.advanceTimersByTimeAsync((tokens.motion.crossfadeMs + hold) * 2)
      await Promise.all([first, second])
      const selB = calls.find((x) => x.c === 'select:b')!
      expect(selB.t - t1).toBeLessThan(half) // no wasted fade from 0 to 0
      expect(calls.slice(at).filter((x) => x.t < selB.t).every((x) => x.c === 'v:0')).toBe(true) // nothing rose between the switches
      const up = calls.find((x) => x.t > selB.t && x.c.startsWith('v:') && Number(x.c.slice(2)) > 0)!
      expect(up.t - selB.t).toBeGreaterThanOrEqual(hold) // the hold is honoured after the newer switch too
      const silentFrom = calls.find((x) => x.c === 'v:0')!.t
      expect(up.t - silentFrom).toBeLessThanOrEqual(20 + hold + half) // silence ≈ hold + one fade step, not + another fade-down
      expect(calls.filter((x) => x.c.startsWith('select')).map((x) => x.c)).toEqual(['select:a', 'select:b'])
      expect(calls.at(-1)!.c).toBe('v:1')
    } finally { vi.useRealTimers() }
  })
  it('a selectAudio that throws still ends at volume 1', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const setVolume = vi.fn()
    const p = { selectAudio: () => { throw new Error('no such track') }, setVolume }
    await expect(crossfadeAudio(p, 'x', async () => {})).resolves.toBeUndefined()
    expect(setVolume).toHaveBeenLastCalledWith(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
  it('a switch that starts during the previous fade-up takes over without the volume rising', async () => {
    vi.useFakeTimers()
    try {
      const calls: string[] = []
      const p = { selectAudio: (id: string) => calls.push(`select:${id}`), setVolume: (v: number) => calls.push(`v:${v}`) }
      const first = crossfadeAudio(p, 'a')
      await vi.advanceTimersByTimeAsync(tokens.motion.crossfadeMs / 2 + tokens.motion.audioSwitchHoldMs + 50) // 'a' selected, held, now fading up
      expect(calls).toContain('select:a')
      const vols = (xs: string[]) => xs.filter((c) => c.startsWith('v:')).map((c) => Number(c.slice(2)))
      const at = calls.length, level = vols(calls).at(-1)!
      expect(level).toBeGreaterThan(0)
      expect(level).toBeLessThan(1)
      const second = crossfadeAudio(p, 'b')
      await vi.advanceTimersByTimeAsync((tokens.motion.crossfadeMs + tokens.motion.audioSwitchHoldMs) * 2)
      await Promise.all([first, second])
      const sel = calls.indexOf('select:b')
      const between = vols(calls.slice(at, sel))
      expect(between.every((v) => v <= level)).toBe(true) // the first fade-up stopped; nothing rose before the switch
      expect(between.at(-1)).toBe(0)
      expect(calls.filter((c) => c.startsWith('select'))).toEqual(['select:a', 'select:b'])
      expect(calls.at(-1)).toBe('v:1')
    } finally { vi.useRealTimers() }
  })
  it('a newer switch on the same player takes over: the older fade stops and never selects', async () => {
    const calls: string[] = []
    const p = { selectAudio: (id: string) => calls.push(`select:${id}`), setVolume: (v: number) => calls.push(`v:${v}`) }
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let reached!: () => void
    const atStep2 = new Promise<void>((r) => { reached = r })
    let n = 0
    // The first fade is held after its second step (volume 0.6); the second starts from there.
    const first = crossfadeAudio(p, 'a', async () => { if (++n === 2) { reached(); await gate } })
    await atStep2
    expect(calls).toEqual(['v:0.8', 'v:0.6'])
    const second = crossfadeAudio(p, 'b', async () => {})
    await second
    release(); await first
    expect(calls).not.toContain('select:a')
    expect(calls.filter((c) => c.startsWith('select'))).toEqual(['select:b'])
    expect(calls.at(-1)).toBe('v:1')
    const sel = calls.indexOf('select:b')
    const down = calls.slice(2, sel).map((c) => Number(c.slice(2)))
    expect(down[0]).toBeLessThan(0.6) // continues down from where the first fade was, no jump back up
    expect(down.at(-1)).toBe(0)
  })
})
