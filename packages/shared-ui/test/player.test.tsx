import { readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer'
import { audioTracksFromHls, parseHlsMaster, textTracksFromHls } from '@moizp/vega-media-kit/core'
import type { Prefs } from '@described/contracts'
import { configureRemote } from '../src/focus/remote'
import { BUFFERING_ANNOUNCE_MS, PENDING_SEEK_MS, Player, type PlayerProps } from '../src/screens/Player'
import { SEEK_COMMIT_MS } from '../src/playback'
import { strings } from '../src/strings'
import { tokens } from '../src/theme/tokens'
import { a11yCalls, back } from './stubs/react-native'
import { kit } from './stubs/kit'
import { title } from './fixtures'

const master = readFileSync(path.resolve(__dirname, 'fixtures/master.m3u8'), 'utf8')
const parsed = parseHlsMaster(master, title.manifestUrl)
const tracks = { audio: audioTracksFromHls(parsed), text: textTracksFromHls(parsed) }
const idOf = (label: string) => [...tracks.audio, ...tracks.text].find((t) => t.label === label)!.id

/** A fake platform key source: `press('right')`, `press('right', true)` for an auto-repeat while held. */
const listeners = new Set<(k: never, repeat?: boolean) => void>()
configureRemote((onKey) => { listeners.add(onKey as never); return () => listeners.delete(onKey as never) })
const press = (k: string, repeat = false) => act(() => { for (const l of [...listeners]) l(k as never, repeat) })

const prefs: Prefs = { adDefault: true, extendedMode: true, voice: 'Joanna', captionKind: 'sdh', captionScale: 100, firstRunDone: true }
const DURATION = title.durationS! // 888
let r!: TestRenderer.ReactTestRenderer
function mount(over: Partial<PlayerProps> = {}) {
  const props: PlayerProps = { title, prefs, withAd: true, scale: 1, onBack: vi.fn(), onProgress: vi.fn(), onPrefs: vi.fn(), speak: vi.fn(async () => {}), ...over }
  act(() => { r = TestRenderer.create(<Player {...props} />) })
  return props
}
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
const player = () => r.root.find((n) => (n.type as unknown) === 'KitPlayer')
const kitProps = () => player().props as Record<string, (...a: unknown[]) => void> & { startAt: number }
const report = (name: string, ...a: unknown[]) => act(() => { kitProps()[name]!(...a) })
const focusables = () => r.root.findAll((n) => (n.type as unknown) === 'FocusableView')
const label = (n: ReactTestInstance) => n.props['aria-label'] as string
const byLabel = (l: string) => focusables().find((n) => label(n).startsWith(l))
const defaultFocus = () => r.root.findAll((n) => (n.type as unknown) === 'DefaultFocus' && n.props.enable === true).map((d) => label(d.findByType('FocusableView' as never)))
const chromeShown = () => r.root.findByProps({ testID: 'chrome' }).props.style.opacity === 1
const status = () => r.root.findByProps({ testID: 'status-line' }).props.children as string
const surface = () => byLabel(strings.player.surface(title.name))

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) // the master read never lands unless a test serves it

})
afterEach(() => { act(() => r.unmount()); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('chrome', () => {
  it('hides after 4 s of playing without a key; any key shows it and restarts the 4 s', () => {
    mount(); report('onState', 'playing')
    act(() => { vi.advanceTimersByTime(tokens.motion.overlayHideMs - 1) })
    expect(chromeShown()).toBe(true)
    act(() => { vi.advanceTimersByTime(1) })
    expect(chromeShown()).toBe(false)
    press('down')
    expect(chromeShown()).toBe(true)
    act(() => { vi.advanceTimersByTime(3000) })
    press('down')
    act(() => { vi.advanceTimersByTime(3000) })
    expect(chromeShown()).toBe(true)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(chromeShown()).toBe(false)
  })
  it('stays while paused or loading', () => {
    mount(); report('onState', 'paused')
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(chromeShown()).toBe(true)
  })
  it('the status line stays when the chrome hides (persistent: "Description on" at a glance)', () => {
    mount(); report('onState', 'playing')
    act(() => { vi.advanceTimersByTime(tokens.motion.overlayHideMs) })
    expect(chromeShown()).toBe(false)
    expect(r.root.findByProps({ testID: 'bar' }).props.style.opacity).toBe(0)
    const line = r.root.findByProps({ testID: 'status-line' })
    for (let n: ReactTestInstance | null = line; n; n = n.parent) expect(Object.assign({}, ...[n.props.style].flat(3).filter(Boolean)).opacity ?? 1).toBe(1)
    expect(status()).toBe('Description on · Joanna') // tracks not known yet: nothing claimed about captions
    report('onTracks', { audio: tracks.audio, text: [] })
    expect(status()).toBe('Description on · Joanna · Captions off') // known, and none on screen
  })
})

describe('remote', () => {
  it('Play/Pause and Select toggle playback', () => {
    mount(); report('onState', 'playing')
    press('playPause'); expect(kit.ref.pause).toHaveBeenCalledOnce()
    report('onState', 'paused')
    press('playPause'); expect(kit.ref.play).toHaveBeenCalledOnce()
    act(() => surface()!.props.onSelect())
    expect(kit.ref.play).toHaveBeenCalledTimes(2)
  })
  it('◄► seek 10 s, gathered into one seek', () => {
    mount(); report('onPosition', 100)
    press('right')
    act(() => { vi.advanceTimersByTime(SEEK_COMMIT_MS) })
    expect(kit.ref.seek).toHaveBeenLastCalledWith(110)
    press('left'); press('left')
    act(() => { vi.advanceTimersByTime(SEEK_COMMIT_MS) })
    expect(kit.ref.seek).toHaveBeenCalledTimes(2)
    expect(kit.ref.seek).toHaveBeenLastCalledWith(90)
  })
  it('clamps at the start and 1 s before the end', () => {
    mount(); report('onPosition', 4)
    press('left'); act(() => { vi.advanceTimersByTime(SEEK_COMMIT_MS) })
    expect(kit.ref.seek).toHaveBeenLastCalledWith(0)
    report('onPosition', 0)
    report('onPosition', DURATION - 3)
    press('right'); act(() => { vi.advanceTimersByTime(SEEK_COMMIT_MS) })
    expect(kit.ref.seek).toHaveBeenLastCalledWith(DURATION - 1)
  })
  it('a second seek starts from the first one, though the player has not reported since (it is buffering)', () => {
    mount(); report('onPosition', 100)
    press('right'); act(() => { vi.advanceTimersByTime(SEEK_COMMIT_MS) })
    expect(kit.ref.seek).toHaveBeenLastCalledWith(110)
    report('onState', 'buffering'); report('onPosition', 100.2) // a late tick from before the seek: ignored
    press('right'); act(() => { vi.advanceTimersByTime(SEEK_COMMIT_MS) })
    expect(kit.ref.seek).toHaveBeenLastCalledWith(120)
  })
  it('the sent seek stands for the position until the player reports near it, or 5 s pass', () => {
    mount(); report('onPosition', 100)
    press('right'); act(() => { vi.advanceTimersByTime(SEEK_COMMIT_MS) })
    report('onPosition', 111) // landed
    press('right'); act(() => { vi.advanceTimersByTime(SEEK_COMMIT_MS) })
    expect(kit.ref.seek).toHaveBeenLastCalledWith(121)
    act(() => { vi.advanceTimersByTime(PENDING_SEEK_MS) }) // never landed: the player's own position again
    press('left'); act(() => { vi.advanceTimersByTime(SEEK_COMMIT_MS) })
    expect(kit.ref.seek).toHaveBeenLastCalledWith(101)
  })
  it('holding ◄► accelerates', () => {
    const hold = (ms: number) => {
      press('right')
      for (let t = 50; t <= ms; t += 50) { act(() => { vi.advanceTimersByTime(50) }); press('right', true) }
      act(() => { vi.advanceTimersByTime(SEEK_COMMIT_MS) })
      return kit.ref.seek.mock.lastCall![0] as number
    }
    mount(); report('onPosition', 0)
    expect(hold(1000)).toBe(60) // one press + 5 repeat steps of 10 s
    report('onPosition', 60); report('onPosition', 0)
    const long = hold(6000)
    expect(long).toBeGreaterThan(30 * 10) // 30 steps; flat 10 s steps would reach only 310
    expect(long).toBeLessThanOrEqual(DURATION)
    expect(long - 10 * 10).toBeGreaterThan(310 - 10 * 10)
  })
  it('the bar shows the seek target at once', () => {
    mount(); report('onPosition', 100)
    press('right')
    expect(JSON.stringify(r.toJSON())).toContain('1:50')
  })
})

describe('the end', () => {
  it('says so, and Select or Play/Pause plays again from the start', () => {
    mount(); report('onPosition', DURATION - 1); report('onState', 'ended')
    expect(status()).toBe(strings.player.ended)
    expect(a11yCalls).toContain(strings.player.ended)
    expect(surface()!.props.accessibilityHint).toContain(strings.player.ended) // the status is spoken with the player's focus
    act(() => surface()!.props.onSelect())
    expect(kit.ref.seek).toHaveBeenLastCalledWith(0)
    expect(kit.ref.play).toHaveBeenCalledOnce()
    report('onState', 'ended')
    press('playPause')
    expect(kit.ref.seek).toHaveBeenCalledTimes(2)
    expect(kit.ref.play).toHaveBeenCalledTimes(2)
  })
})

describe('Back and resume', () => {
  it('Back hands the position to Root (which saves it) and is handled', () => {
    const p = mount(); report('onPosition', 321.4)
    let handled = false
    act(() => { handled = back.press() })
    expect(handled).toBe(true)
    expect(p.onBack).toHaveBeenCalledWith(321.4)
  })
  it('Back after the end saves 0, so the next play starts over', () => {
    const p = mount(); report('onState', 'ended')
    act(() => { back.press() })
    expect(p.onBack).toHaveBeenCalledWith(0)
  })
  it('resumes from resumeS: startAt, then one seek once the load is up (Fire OS ignores startAt)', () => {
    mount({ title: { ...title, resumeS: 120 } })
    expect(kitProps().startAt).toBe(120)
    report('onState', 'loading')
    expect(kit.ref.seek).not.toHaveBeenCalled()
    report('onState', 'playing'); report('onState', 'ready'); report('onState', 'playing')
    expect(kit.ref.seek.mock.calls).toEqual([[120]])
  })
  it('a seek sent before the load is up wins over the resume point (keys and transport alike)', () => {
    const onNowPlaying = vi.fn()
    mount({ title: { ...title, resumeS: 120 }, onNowPlaying }); report('onState', 'loading')
    act(() => onNowPlaying.mock.lastCall![0].controls.seek(300))
    report('onState', 'ready'); report('onState', 'playing')
    expect(kit.ref.seek.mock.calls).toEqual([[300]])
  })
  it('a deep link start (startAtS) wins over the saved position', () => {
    mount({ title: { ...title, resumeS: 120 }, startAtS: 42 })
    expect(kitProps().startAt).toBe(42)
  })
  it('no saved position: starts at 0 and never seeks', () => {
    mount(); report('onState', 'ready'); report('onState', 'playing')
    expect(kitProps().startAt).toBe(0)
    expect(kit.ref.seek).not.toHaveBeenCalled()
  })
})

describe('tracks from the master playlist', () => {
  it('selects Rich captions (and the description text for Extended mode) by characteristics', async () => {
    const renamed = master.replace('NAME="Rich captions"', 'NAME="English"').replace('NAME="Captions"', 'NAME="English (rich)"')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, url, text: async () => renamed })))
    mount(); await flush()
    expect(fetch).toHaveBeenCalledWith(title.manifestUrl)
    // Names that would mislead: only the characteristic says which track is rich (ids are ordinals, same order).
    report('onTracks', { audio: tracks.audio, text: textTracksFromHls(parseHlsMaster(renamed, title.manifestUrl)) })
    expect(kit.ref.selectText).toHaveBeenLastCalledWith([idOf('Rich captions'), idOf('Description text')])
    expect(kitProps().preferredAudio).toEqual({ role: 'description' })
  })
  it('Description off: selects the original audio by role and announces it', async () => {
    mount(); report('onTracks', tracks); report('onState', 'playing')
    press('menu')
    act(() => byLabel(strings.tracks.a11y.original)!.props.onSelect())
    expect(kit.ref.selectAudio).toHaveBeenCalledWith(idOf('Original'))
    expect(a11yCalls).toContain('Description off')
    expect(status()).toBe('Description off · Rich captions')
    act(() => byLabel(strings.tracks.a11y.ad('Joanna'))!.props.onSelect())
    expect(kit.ref.selectAudio).toHaveBeenLastCalledWith(idOf('Audio description'))
    expect(a11yCalls).toContain('Description on')
  })
  it('captions and Extended mode chosen in the sheet are saved as prefs', () => {
    const p = mount(); press('menu')
    act(() => byLabel(strings.tracks.a11y.plain)!.props.onSelect())
    expect(p.onPrefs).toHaveBeenCalledWith({ captionKind: 'captions' })
    act(() => byLabel(strings.tracks.a11y.extendedOn)!.props.onSelect())
    expect(p.onPrefs).toHaveBeenCalledWith({ extendedMode: false })
  })
  it('a caption change re-selects text tracks; the overlay draws only the caption track', async () => {
    mount({ prefs: { ...prefs, captionKind: 'captions', extendedMode: false } }); await flush()
    report('onTracks', tracks)
    expect(kit.ref.selectText).toHaveBeenLastCalledWith([idOf('Captions')])
    report('onCue', [{ trackId: idOf('Captions'), id: 'c1', start: 0, end: 1, text: 'Hello' }, { trackId: idOf('Description text'), id: 'd1', start: 0, end: 1, text: 'A dragon.' }])
    const overlay = r.root.find((n) => (n.type as unknown) === 'CueOverlay')
    expect(overlay.props.active.map((c: { id: string }) => c.id)).toEqual(['c1'])
    expect(overlay.props.theme.userScale).toBe(1)
  })
  it('the status line names what is really showing', async () => {
    mount({ prefs: { ...prefs, captionKind: 'sdh' } }); await flush()
    report('onTracks', { ...tracks, text: tracks.text.filter((t) => t.label !== 'Rich captions') })
    report('onState', 'playing')
    expect(status()).toBe('Description on · Joanna · Captions')
  })
})

describe('loading and errors', () => {
  it('status says Loading… while buffering; announced once, after 2 s', () => {
    mount(); report('onState', 'playing'); report('onState', 'buffering')
    expect(status()).toBe('Loading…')
    act(() => { vi.advanceTimersByTime(BUFFERING_ANNOUNCE_MS - 1) })
    expect(a11yCalls).not.toContain('Loading…')
    act(() => { vi.advanceTimersByTime(1) })
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(a11yCalls.filter((s) => s === 'Loading…')).toHaveLength(1)
  })
  it('loading then buffering is one stall: announced once; a new stall after playing is announced again', () => {
    mount(); report('onState', 'loading')
    act(() => { vi.advanceTimersByTime(BUFFERING_ANNOUNCE_MS) })
    report('onState', 'buffering')
    act(() => { vi.advanceTimersByTime(BUFFERING_ANNOUNCE_MS * 3) })
    expect(a11yCalls.filter((s) => s === 'Loading…')).toHaveLength(1)
    report('onState', 'playing'); report('onState', 'buffering')
    act(() => { vi.advanceTimersByTime(BUFFERING_ANNOUNCE_MS) })
    expect(a11yCalls.filter((s) => s === 'Loading…')).toHaveLength(2)
  })
  it('a short stall says nothing', () => {
    mount(); report('onState', 'buffering')
    act(() => { vi.advanceTimersByTime(1500) })
    report('onState', 'playing')
    act(() => { vi.advanceTimersByTime(5000) })
    expect(a11yCalls).not.toContain('Loading…')
  })
  it('a fatal error shows and announces the plain copy; Select tries again from the same place', () => {
    mount(); report('onPosition', 200)
    report('onError', { code: 'EXO', message: 'Playback error', fatal: true })
    expect(status()).toBe(strings.player.error)
    expect(a11yCalls).toContain(strings.player.error)
    expect(JSON.stringify(r.toJSON())).not.toContain('EXO')
    act(() => surface()!.props.onSelect())
    expect(kit.mounts).toBe(2)
    expect(kitProps().startAt).toBe(200)
    expect(status()).not.toBe(strings.player.error)
  })
  it('a non-fatal error (a caption fetch) does not stop anything', () => {
    mount(); report('onTracks', tracks); report('onState', 'playing')
    report('onError', { code: 'TEXT_FETCH', message: 'x', fatal: false })
    expect(status()).toBe('Description on · Joanna · Rich captions')
  })
})

describe('track sheet', () => {
  it('▲ or Menu opens it with focus on the audio in use; Menu closes it and focus returns to the player', () => {
    mount(); report('onState', 'playing')
    expect(defaultFocus()).toEqual([strings.player.surface(title.name)])
    press('up')
    expect(r.root.findAllByProps({ testID: 'track-sheet' })).toHaveLength(1)
    expect(surface()).toBeUndefined()
    // The panel's name rides on the first item's announcement; each item names its section.
    expect(defaultFocus()).toEqual([`${strings.tracks.heading}. ${strings.tracks.a11y.ad('Joanna')}`])
    press('menu')
    expect(r.root.findAllByProps({ testID: 'track-sheet' })).toHaveLength(0)
    expect(defaultFocus()).toEqual([strings.player.surface(title.name)])
  })
  it('Back closes the sheet, not the player; reopening returns to the item last focused', () => {
    const p = mount(); press('menu')
    act(() => byLabel(strings.tracks.a11y.rich)!.props.onFocus())
    act(() => { expect(back.press()).toBe(true) })
    expect(p.onBack).not.toHaveBeenCalled()
    expect(r.root.findAllByProps({ testID: 'track-sheet' })).toHaveLength(0)
    press('menu')
    expect(defaultFocus()).toEqual([`${strings.tracks.heading}. ${strings.tracks.a11y.rich}`])
  })
  it('while open, ◄► and Play/Pause leave the film alone', () => {
    mount(); report('onState', 'playing'); press('menu')
    press('left'); press('playPause')
    act(() => { vi.advanceTimersByTime(SEEK_COMMIT_MS) })
    expect(kit.ref.seek).not.toHaveBeenCalled()
    expect(kit.ref.pause).not.toHaveBeenCalled()
  })
  it('selected = teal ring + ✓; sections in spec order', () => {
    mount(); press('menu')
    expect(focusables().map(label)).toEqual([
      strings.tracks.a11y.original, `${strings.tracks.heading}. ${strings.tracks.a11y.ad('Joanna')}`,
      strings.tracks.a11y.off, strings.tracks.a11y.plain, strings.tracks.a11y.rich, strings.tracks.a11y.descText,
      strings.tracks.a11y.extendedOn,
    ])
    const selected = focusables().filter((n) => n.props.accessibilityState.selected).map(label)
    expect(selected).toEqual([`${strings.tracks.heading}. ${strings.tracks.a11y.ad('Joanna')}`, strings.tracks.a11y.rich, strings.tracks.a11y.extendedOn])
    act(() => byLabel(strings.tracks.a11y.original)!.props.onFocus()) // once focus moves, the name is not repeated
    expect(focusables().map(label)).toContain(strings.tracks.a11y.ad('Joanna'))
    const rich = byLabel(strings.tracks.a11y.rich)!
    const styles = rich.findAll((x) => (x.type as unknown) === 'View').map((x) => Object.assign({}, ...[x.props.style].flat(3).filter(Boolean)))
    expect(styles.some((st) => st.borderColor === tokens.color.interactive)).toBe(true)
    expect(JSON.stringify(rich.findAll((x) => (x.type as unknown) === 'Text').map((t) => t.props.children))).toContain('✓')
  })
})

describe('every focusable states its purpose', () => {
  it.each([['player', false], ['track sheet', true]])('%s', (_, open) => {
    mount(); if (open) press('menu')
    const f = focusables()
    expect(f.length).toBeGreaterThan(0)
    for (const n of f) {
      expect(label(n)?.trim().length).toBeGreaterThan(3)
      expect(label(n)).not.toMatch(/^(button|item|focusable)$/i)
    }
  })
  it('no text below the 28 px floor', () => {
    mount(); press('menu')
    const sizes = r.root.findAll((n) => (n.type as unknown) === 'Text').map((t) => Object.assign({}, ...[t.props.style].flat(3).filter(Boolean)).fontSize as number)
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(tokens.type.floor)
  })
})

describe('platform hook (DESC-008)', () => {
  it('reports the session with live controls, and null when the player closes', () => {
    const onNowPlaying = vi.fn()
    mount({ onNowPlaying }); report('onState', 'playing')
    const s = onNowPlaying.mock.lastCall![0]
    expect(s).toMatchObject({ slug: title.slug, state: 'playing', adOn: true, durationS: DURATION })
    s.controls.pause(); expect(kit.ref.pause).toHaveBeenCalled()
    s.controls.seek(9999); expect(kit.ref.seek).toHaveBeenLastCalledWith(DURATION - 1)
    act(() => r.unmount())
    expect(onNowPlaying).toHaveBeenLastCalledWith(null)
    act(() => { r = TestRenderer.create(<></>) })
  })
})

describe('extended cues stay with DESC-007', () => {
  it('an {extended=1} cue neither pauses nor speaks yet', () => {
    const p = mount(); report('onTracks', tracks)
    report('onCue', [{ trackId: idOf('Description text'), id: 'd1', start: 0, end: 1, text: 'A dragon.', meta: { extended: '1' } }])
    expect(kit.ref.pause).not.toHaveBeenCalled()
    expect(p.speak).not.toHaveBeenCalled()
  })
})
