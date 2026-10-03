import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, BackHandler, View } from 'react-native'
import { KitPlayer, CueOverlay, parseHlsMaster, parseVtt } from '@moizp/vega-media-kit'
import type { Cue, KitPlayerRef, PlayerError, PlayerState, Tracks } from '@moizp/vega-media-kit'
import type { RemoteKey } from '@moizp/vega-media-kit/platform'
import type { Prefs, TitleDetail } from '@described/contracts'
import { Focusable, T } from '../components'
import { subscribeKeys } from '../focus/keys'
import {
  audioTrackFor, characteristicsByUri, clampSeek, clock, crossfadeAudio, resumePoint, seekStep, statusLine, textSelection,
  SEEK_COMMIT_MS, SEEK_REPEAT_MS, SEEK_STEP_S,
} from '../playback'
import { ExtendedScheduler, extendedCues, type ExtendedCue } from '../extended'
import { strings } from '../strings'
import { tokens } from '../theme/tokens'
import { scrimBands } from '../theme/scrim'
import { px } from '../theme/scale'
import { TrackSheet, type SheetItem } from './TrackSheet'

/** Buffering longer than this is announced ("Loading…"), once per stall. */
export const BUFFERING_ANNOUNCE_MS = 2000
/**
 * A sent seek stands for the position until the player reports within this of it, or this long passes: the kit's
 * Fire OS position only moves on onProgress, which stops while the seek buffers, so a second press would otherwise
 * start from the old place.
 */
export const PENDING_SEEK_NEAR_S = 2
export const PENDING_SEEK_MS = 5000
/** Retries of a failed descriptions read (after 1, 2, 4 s). */
export const DESCRIPTIONS_RETRIES = 3
/** Height of the bottom chrome (bar, time, status line) in px at 1080p; captions sit above it while it shows. */
const CHROME_BOTTOM = 176
const bands = scrimBands()
const announce = (s: string) => AccessibilityInfo.announceForAccessibility(s)
const noop = () => {}

/**
 * What a platform binding needs about the film on screen (DESC-008: Media Controls, Alexa pause). Player reports it
 * on every state or audio change and `null` when it unmounts; `controls` act on the live player.
 */
export interface PlayerSession {
  slug: string; name: string; state: PlayerState; adOn: boolean; durationS: number | null
  /** Committed seeks so far (keys, transport, resume): a new value means the position jumped, so bindings republish it. */
  seeks: number
  /** `seek` is the Player's own seek (clamped, resume-aware), so transport seeks behave like ◄►. */
  controls: { play(): void; pause(): void; seek(s: number): void; getPosition(): number }
}

export interface PlayerProps {
  title: TitleDetail; prefs: Prefs; withAd: boolean; scale: number
  /** Start here instead of the saved position (a deep link with a time, DESC-008). */
  startAtS?: number
  /** Back: leave for Title. `positionS` is where to resume (0 once the film has ended). */
  onBack: (positionS: number) => void
  /** ≤ 4 Hz from the kit. Root saves progress from it. */
  onProgress: (s: number) => void
  /** Caption kind and Extended mode chosen in the track sheet, saved to /me/prefs. */
  onPrefs: (p: Partial<Prefs>) => void
  /** Platform audio for extended cues: resolves when the clip ends, fails, times out or is stopped. */
  speak: (audioUrl: string) => Promise<void>
  /** Stops the clip `speak` is playing (its promise then resolves). */
  stopSpeaking?: () => void
  /** Starts loading a clip so `speak(url)` can start at once (the next extended cue, PREFETCH_AHEAD_S ahead). */
  prefetch?: (audioUrl: string) => void
  /** The audio of description cue `d{n}` (GET /titles/:slug/cues/:cueId/audio). Without it Extended mode never pauses. */
  cueAudioUrl?: (slug: string, cueId: string) => string
  /**
   * The title's whole-file descriptions WebVTT (GET /titles/:slug/descriptions.vtt: built from the same rows as the clip
   * route, so it is the source of truth for d{n}). Read once, as soon as Extended mode is on.
   */
  descriptionsUrl?: string
  onNowPlaying?: (n: PlayerSession | null) => void
}

/**
/**
 * Captions as Settings chose them: size (100–200 %) and style. Box (default, PLAN §8) is the token box; Shadow is a
 * lighter box (cueShadowBox), since bare text is unreadable on bright video. TODO(kit): switch Shadow to a text shadow
 * once CueTheme has one.
 */
export const cueTheme = (prefs: Pick<Prefs, 'captionScale' | 'captionStyle'>) => ({
  fontFamily: tokens.type.caption.family, primaryColor: tokens.color.text, userScale: prefs.captionScale / 100,
  boxColor: prefs.captionStyle === 'shadow' ? tokens.color.cueShadowBox : tokens.color.cueBox,
})
/**
 * Player: full-bleed video through the kit. AD is an audio rendition chosen by role; captions and description text
 * are text tracks chosen by kind and HLS characteristics; the kit's CueOverlay draws them. Chrome (title, bar,
 * time) shows on any key and hides after 4 s of playing without input; the status line always stays. Remote: Select / Play-Pause
 * toggle, ◄► skip 10 s (held: faster), ▲ or Menu open the track sheet, Back saves the position and leaves.
 *
 * Extended mode (AD and `prefs.extendedMode` on): when playback crosses the start of an `{extended=1}` description cue,
 * the film pauses, the ochre bar shows, and the cue's clip plays; then the film resumes — also when the clip fails or
 * times out (`speak` always settles). A seek, Back, Menu, Play, or turning AD / Extended mode off ends the pause at
 * once (the clip stops); Pause or Select during it keeps the film paused after the clip.
 */
export function Player({ title, prefs, withAd, scale, startAtS, onBack, onProgress, onPrefs, speak, stopSpeaking = noop, prefetch = noop, cueAudioUrl, descriptionsUrl, onNowPlaying }: PlayerProps) {
  const ref = useRef<KitPlayerRef>(null)
  const [state, setState] = useState<PlayerState>('idle')
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [tracks, setTracks] = useState<Tracks>({ audio: [], text: [] })
  const [tracksKnown, setTracksKnown] = useState(false)
  const [chars, setChars] = useState<Map<string, string[]> | null>(null)
  const [cues, setCues] = useState<Cue[]>([])
  const [adOn, setAdOn] = useState(withAd) // the chosen action wins over the default
  const [position, setPosition] = useState(0)
  const [scrub, setScrub] = useState<number | null>(null)
  const [sheet, setSheet] = useState(false)
  const [chrome, setChrome] = useState(true)
  const [poke, setPoke] = useState(0)
  const [describing, setDescribing] = useState(false)
  const [seeks, setSeeks] = useState(0)

  const pos = useRef(0)
  const startAt = useRef(startAtS != null ? clampSeek(startAtS, title.durationS) : resumePoint(title.resumeS, title.durationS))
  const seekedToStart = useRef(false)
  const tracksRef = useRef(tracks)
  const stateRef = useRef(state)
  stateRef.current = state
  const scrubRef = useRef<number | null>(null)
  const commit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hold = useRef({ start: 0, last: 0 })
  const sheetItem = useRef<SheetItem | undefined>(undefined)
  const [extCues, setExtCues] = useState<ExtendedCue[] | null>(null)
  const scheduler = useRef<ExtendedScheduler | null>(null)
  /** The extended pause in progress; `token` tells its own clip's end from a stale one. */
  const ext = useRef<{ token: object; userPaused: boolean } | null>(null)
  /** Extended cues crossed while another was speaking (two close cues): spoken next, in order. */
  const queue = useRef<ExtendedCue[]>([])
  /** The kit's `paused` is ours (an extended pause) until it reports `playing` again: not the viewer's pause. */
  const ownPause = useRef(false)
  const seeked = useRef(false)
  const prefetched = useRef<string | null>(null)
  const stopRef = useRef(stopSpeaking)
  stopRef.current = stopSpeaking // latest, so endExtended (and the unmount cleanup keyed on it) never changes
  const pendingSeek = useRef<{ target: number; timer: ReturnType<typeof setTimeout> } | null>(null)
  const announcedStall = useRef(false)

  const showChrome = useCallback(() => { setChrome(true); setPoke((n) => n + 1) }, [])
  /**
   * Ends the extended pause (`token`: only if it is still that one). `cancel` stops the clip first. Returns whether the
   * film should play on — false when there was no pause, or the viewer paused during it.
   */
  const endExtended = useCallback((how: 'done' | 'cancel', token?: object): boolean => {
    const e = ext.current
    if (how === 'cancel') queue.current = []
    if (!e || (token && e.token !== token)) return false
    ext.current = null
    setDescribing(false)
    if (how === 'cancel') { prefetched.current = null; stopRef.current() }
    return !e.userPaused
  }, [])
  /** Drops the prefetched clip too (seek away, Extended mode off, leaving): stopSpeaking releases it. */
  const releaseAudio = useCallback(() => { queue.current = []; if (endExtended('cancel')) return true; prefetched.current = null; stopRef.current(); return false }, [endExtended])
  const getPosition = useCallback(() => scrubRef.current ?? pendingSeek.current?.target ?? ref.current?.getPosition() ?? pos.current, [])
  const clearPending = useCallback(() => { if (pendingSeek.current) clearTimeout(pendingSeek.current.timer); pendingSeek.current = null }, [])
  /** The one seek path: keys, transport controls (DESC-008) and resume. A seek sent before the load is up wins over resume. */
  const seekTo = useCallback((s: number) => {
    const target = clampSeek(s, title.durationS)
    seekedToStart.current = true
    clearPending()
    // A seek never starts an extended cue it lands on; during an extended pause it ends the pause and plays on. The
    // prefetched clip belonged to the old place.
    scheduler.current?.seeked(); seeked.current = true
    if (releaseAudio()) ref.current?.play()
    pendingSeek.current = { target, timer: setTimeout(() => { pendingSeek.current = null }, PENDING_SEEK_MS) }
    ref.current?.seek(target)
    pos.current = target; setPosition(target); setSeeks((n) => n + 1)
  }, [title.durationS, clearPending, releaseAudio])

  // Rich vs plain captions is an HLS characteristic the kit's TextTrack does not carry: read it from the master.
  useEffect(() => {
    let live = true
    fetch(title.manifestUrl)
      .then(async (r) => { if (!r.ok) throw new Error(`master ${r.status}`); return parseHlsMaster(await r.text(), r.url || title.manifestUrl) }) // base URL as the kit resolves it
      .then((m) => { if (live) setChars(characteristicsByUri(m.renditions)) })
      .catch(() => {}) // the NAME fallback covers it
    return () => { live = false }
  }, [title.manifestUrl])

  const selection = useMemo(() => textSelection(tracks.text, prefs.captionKind, { adOn, extendedMode: prefs.extendedMode, chars }), [tracks.text, prefs.captionKind, prefs.extendedMode, adOn, chars])
  const idsKey = selection.ids.join(',')
  // Text selection follows the choice; re-applied for every new track list (a retry reloads the source).
  useEffect(() => { if (tracks.text.length) ref.current?.selectText(selection.ids) }, [tracks, idsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Extended mode: the whole descriptions VTT, one request, read as soon as AD and Extended mode are on — before the
  // first tick, so a cue at 0:00 is not missed. The kit's onCue only reports cues on screen; prefetching needs the rest.
  const extendedOn = adOn && prefs.extendedMode && !!cueAudioUrl && !!descriptionsUrl
  useEffect(() => {
    if (!extendedOn || extCues) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    // A failed read is retried after 1, 2 and 4 s; a 404 (no such published title) is final. Then: no pauses.
    const load = (attempt: number) => {
      fetch(descriptionsUrl!)
        .then(async (r) => { if (r.status === 404) return null; if (!r.ok) throw new Error(`descriptions ${r.status}`); return r.text() })
        .then((vtt) => { if (live && vtt !== null) setExtCues(extendedCues(parseVtt(vtt, { trackId: 'descriptions' }))) })
        .catch(() => { if (live && attempt < DESCRIPTIONS_RETRIES) timer = setTimeout(() => load(attempt + 1), 1000 * 2 ** attempt) })
    }
    load(0)
    return () => { live = false; clearTimeout(timer) }
  }, [extendedOn, descriptionsUrl, extCues])
  useEffect(() => {
    if (!extCues) return
    scheduler.current = new ExtendedScheduler(extCues)
    // Playing from the very start with no seek yet: the first tick counts from 0:00, so early cues are crossed. (If the
    // cues arrive late, the jump from 0 to the first tick is > MAX_TICK_S and counts as a seek, not a crossing.)
    if (!seeked.current && startAt.current === 0) scheduler.current.begin(0)
  }, [extCues])
  // Turning AD or Extended mode off (track sheet, Settings) ends a pause in progress and drops the prefetched clip.
  useEffect(() => { if (!extendedOn && releaseAudio()) ref.current?.play() }, [extendedOn, releaseAudio])
  useEffect(() => () => { releaseAudio() }, [releaseAudio])

  /**
   * Pause → announce → speak → resume (unless the viewer paused meanwhile, or something else already ended it). A cue
   * queued behind this one is spoken next, still paused; `userPaused` carries over.
   */
  const startExtended = (cue: ExtendedCue, userPaused = false) => {
    const token = {}
    ext.current = { token, userPaused }
    prefetched.current = null
    setDescribing(true); announce(strings.player.extendedBar)
    ownPause.current = true
    ref.current?.pause()
    speak(cueAudioUrl!(title.slug, cue.id)).catch(() => {}).then(() => {
      const viewerPaused = ext.current?.token === token && ext.current.userPaused
      const resume = endExtended('done', token)
      const next = ext.current === null && (resume || viewerPaused) ? queue.current.shift() : undefined
      if (next) startExtended(next, viewerPaused)
      else if (resume) ref.current?.play()
    })
  }
  /**
   * Every position tick: start an extended cue crossed in playback; prefetch the next one 10 s ahead. Not gated on the
   * reported state (onState can lag the tick, and the scheduler has already moved past the cue): any forward crossing
   * counts, except while ◄► is held (the viewer is leaving this place).
   */
  const extendedTick = (s: number) => {
    const t = scheduler.current?.tick(s)
    if (!t || !extendedOn) return
    if (t.upcoming && prefetched.current !== t.upcoming.id) { prefetched.current = t.upcoming.id; prefetch(cueAudioUrl!(title.slug, t.upcoming.id)) }
    if (!t.triggers.length || scrubRef.current !== null) return
    queue.current.push(...t.triggers)
    if (!ext.current) startExtended(queue.current.shift()!, stateRef.current === 'paused' && !ownPause.current) // crossed as the viewer paused: stay paused after
  }

  // Chrome hides after 4 s of playing with no key; it stays while paused, loading, stopped or the sheet is open.
  useEffect(() => {
    if (!chrome || sheet || state !== 'playing' || error) return
    const t = setTimeout(() => setChrome(false), tokens.motion.overlayHideMs)
    return () => clearTimeout(t)
  }, [chrome, poke, sheet, state, error])
  const chromeShown = chrome || state !== 'playing' || error

  // A stall is announced once, after 2 s (loading → buffering is still one stall); a short one says nothing.
  useEffect(() => {
    if (state === 'playing' || state === 'paused') announcedStall.current = false
    if (error || announcedStall.current || (state !== 'loading' && state !== 'buffering')) return
    const t = setTimeout(() => { announcedStall.current = true; announce(strings.player.loading) }, BUFFERING_ANNOUNCE_MS)
    return () => clearTimeout(t)
  }, [state, error])
  useEffect(() => { if (state === 'ended') announce(strings.player.ended) }, [state])
  useEffect(() => { if (error) announce(strings.player.error) }, [error])

  const play = useCallback(() => {
    endExtended('cancel') // Play during an extended pause: the film, now
    // ExoPlayer stays at the end after `ended`: playing again needs a seek to the start first.
    if (stateRef.current === 'ended') seekTo(0)
    ref.current?.play()
  }, [seekTo, endExtended])
  /** Pause during an extended pause keeps the film paused once the clip ends. */
  const pause = useCallback(() => { if (ext.current) ext.current.userPaused = true; else ref.current?.pause() }, [])
  const { slug, name, durationS } = title
  useEffect(() => {
    onNowPlaying?.({ slug, name, state, adOn, durationS, seeks, controls: { play, pause, seek: seekTo, getPosition } })
  }, [onNowPlaying, slug, name, durationS, state, adOn, seeks, play, pause, seekTo, getPosition])
  useEffect(() => () => onNowPlaying?.(null), [onNowPlaying])
  useEffect(() => () => { clearTimeout(commit.current); clearPending() }, [clearPending])

  const toggle = () => {
    if (error) { retry(); return }
    if (ext.current) { ext.current.userPaused = !ext.current.userPaused; return } // the film is paused for the clip either way
    if (stateRef.current === 'playing' || stateRef.current === 'buffering') ref.current?.pause()
    else play()
  }
  const retry = () => {
    startAt.current = getPosition(); seekedToStart.current = false; clearPending()
    setError(false); setState('idle'); setTracks({ audio: [], text: [] }); setTracksKnown(false); setAttempt((a) => a + 1)
  }
  const seekBy = (dir: 1 | -1, repeat: boolean) => {
    const now = Date.now()
    let step = SEEK_STEP_S
    if (!repeat) hold.current = { start: now, last: now }
    else {
      if (now - hold.current.last < SEEK_REPEAT_MS) return
      hold.current.last = now
      step = seekStep(now - hold.current.start)
    }
    const target = clampSeek(getPosition() + dir * step, title.durationS)
    scrubRef.current = target; setScrub(target)
    clearTimeout(commit.current)
    commit.current = setTimeout(() => {
      scrubRef.current = null; setScrub(null)
      seekTo(target)
    }, SEEK_COMMIT_MS)
  }
  const openSheet = () => {
    if (endExtended('cancel')) ref.current?.play() // Menu during an extended pause: the clip stops, the film plays on
    setSheet(true) // TrackSheet folds its name into the first item's announcement
  }
  const closeSheet = () => { setSheet(false); showChrome() }
  const chooseAudio = (on: boolean) => {
    if (on === adOn) return
    setAdOn(on)
    announce(on ? strings.tracks.announceOn : strings.tracks.announceOff)
    const t = audioTrackFor(tracksRef.current.audio, on)
    if (t && ref.current) void crossfadeAudio(ref.current, t.id)
  }

  // Raw keys (Select reaches the surface through spatial navigation; Back through BackHandler). A key the player acts
  // on is consumed, so spatial navigation does not also move focus (◄► seek, ▲ opens the sheet). In the sheet only
  // Menu and the play keys are taken; ▲▼ and Select move through it.
  const onKey = useRef<(k: RemoteKey, repeat: boolean) => boolean>(() => false)
  onKey.current = (k, repeat) => {
    if (k === 'back') return false
    if (sheet) {
      // In the sheet: Menu closes it; Play/Pause still toggles playback (as the media session does with PLAY/PAUSE).
      if (k === 'menu') { if (!repeat) closeSheet(); return true }
      if (k === 'playPause') { if (!repeat) toggle(); return true }
      if (k === 'play') { play(); return true }
      if (k === 'pause') { pause(); return true }
      return false
    }
    showChrome()
    switch (k) {
      case 'playPause': if (!repeat) toggle(); return true
      case 'play': play(); return true
      case 'pause': pause(); return true
      case 'left': case 'rewind': seekBy(-1, repeat); return true
      case 'right': case 'fastForward': seekBy(1, repeat); return true
      case 'up': case 'menu': if (!repeat) openSheet(); return true
      default: return false
    }
  }
  useEffect(() => subscribeKeys((k, repeat) => onKey.current(k, repeat)), [])

  const onBackRef = useRef<() => boolean>(() => false)
  onBackRef.current = () => {
    if (sheet) { closeSheet(); return true }
    clearTimeout(commit.current)
    releaseAudio()
    onBack(stateRef.current === 'ended' ? 0 : getPosition())
    return true
  }
  useEffect(() => { const sub = BackHandler.addEventListener('hardwareBackPress', () => onBackRef.current()); return () => sub.remove() }, [])

  const onState = (s: PlayerState) => {
    setState(s)
    if (s === 'playing') ownPause.current = false
    // The kit's Fire OS adapter does not apply `startAt` (react-native-video has no start position), so the resume
    // point is sought once the load is up. Harmless where startAt already worked.
    if ((s === 'ready' || s === 'playing') && !seekedToStart.current) {
      seekedToStart.current = true
      if (startAt.current > 0) seekTo(startAt.current)
    }
  }
  const onError = (e: PlayerError) => { if (e.fatal) { endExtended('cancel'); setError(true); setState('error') } }

  const shownPos = scrub ?? position
  const duration = title.durationS ?? 0
  const fraction = duration ? Math.min(1, shownPos / duration) : 0
  const status = statusLine({ state, error, adOn, voice: title.voice, caption: tracksKnown ? selection.kind : null }) // what is really on screen; nothing before the tracks are known
  const visibleCues = cues.filter((c) => c.trackId === selection.shown)
  const insetY = tokens.layout.safeY + (chromeShown ? CHROME_BOTTOM : 0)

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.video }}>
      <KitPlayer
        key={attempt}
        ref={ref}
        source={{ uri: title.manifestUrl, type: 'hls' }}
        autoplay startAt={startAt.current}
        preferredAudio={{ role: adOn ? 'description' : 'main' }}
        onTracks={(t: Tracks) => { tracksRef.current = t; setTracks(t); setTracksKnown(true) }}
        onCue={setCues} onState={onState} onError={onError}
        onPosition={(s: number) => {
          const p = pendingSeek.current
          if (p && Math.abs(s - p.target) > PENDING_SEEK_NEAR_S) return // a tick from before the seek landed
          if (p) clearPending()
          pos.current = s; setPosition(s); onProgress(s)
          extendedTick(s)
        }}
        style={{ flex: 1 }}
      />
      <CueOverlay active={visibleCues} primaryTrackId={selection.shown} scale={scale} safeInset={{ x: Math.round(tokens.layout.safeX * scale), y: Math.round(insetY * scale) }}
        theme={cueTheme(prefs)} />

      <View testID="chrome" pointerEvents="none" accessibilityElementsHidden={!chromeShown} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: chromeShown ? 1 : 0 }}>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: px(200) }}>{[...bands].reverse().map((c) => <View key={c} style={{ flex: 1, backgroundColor: c }} />)}</View>
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: px(CHROME_BOTTOM + tokens.layout.safeY + 80) }}>{bands.map((c) => <View key={c} style={{ flex: 1, backgroundColor: c }} />)}</View>
        <View style={{ position: 'absolute', top: px(tokens.layout.safeY), left: px(tokens.layout.safeX), right: px(tokens.layout.safeX) }}>
          <T variant="heading" numberOfLines={1}>{title.name}</T>
        </View>
      </View>

      <View style={{ position: 'absolute', left: px(tokens.layout.safeX), right: px(tokens.layout.safeX), bottom: px(tokens.layout.safeY), gap: px(16) }}>
        <View testID="bar" style={{ flexDirection: 'row', alignItems: 'center', gap: px(24), opacity: chromeShown ? 1 : 0 }}>
          <T variant="label" style={{ minWidth: px(120) }}>{clock(shownPos)}</T>
          <View style={{ flex: 1 }}>
            {sheet ? <View style={{ height: px(44) }} /> : (
              <Focusable label={strings.player.surface(title.name)} hint={`${status}. ${strings.player.surfaceHint}`} defaultFocus onPress={() => { showChrome(); toggle() }} testID="player-surface"
                style={{ height: px(44), justifyContent: 'center', paddingHorizontal: px(8) }}>
                <View accessibilityLabel={strings.player.position(clock(shownPos), clock(duration))} style={{ height: px(8), borderRadius: px(4), backgroundColor: tokens.color.surface3, overflow: 'hidden' }}>
                  <View testID="progress-fill" style={{ width: `${fraction * 100}%`, height: '100%', backgroundColor: tokens.color.interactive }} />
                </View>
              </Focusable>
            )}
          </View>
          <T variant="label" color={tokens.color.textSecondary} style={{ minWidth: px(120), textAlign: 'right' }}>{clock(duration)}</T>
        </View>
        {/* Persistent 28 px status line, bottom-left: always on screen, so "Description on" can be checked at a glance. */}
        <View style={{ alignSelf: 'flex-start', backgroundColor: tokens.color.scrimBottom, paddingHorizontal: px(12), paddingVertical: px(4), borderRadius: px(tokens.radius.badge) }}>
          <T variant="label" testID="status-line" color={error ? tokens.color.error : tokens.color.text}>{status}</T>
        </View>
      </View>

      {describing ? (
        <View testID="extended-bar" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: px(8), backgroundColor: tokens.color.badge }}>
          <T variant="label" style={{ position: 'absolute', right: px(tokens.layout.safeX), bottom: px(16) }}>{strings.player.extendedBar}</T>
        </View>
      ) : null}
      {sheet ? (
        <TrackSheet voice={title.voice} adOn={adOn} captionKind={prefs.captionKind} extendedMode={prefs.extendedMode} initial={sheetItem.current}
          onFocusItem={(id) => { sheetItem.current = id }} onAudio={chooseAudio}
          onCaptions={(k) => onPrefs({ captionKind: k })} onExtended={(on) => onPrefs({ extendedMode: on })} />
      ) : null}
    </View>
  )
}
