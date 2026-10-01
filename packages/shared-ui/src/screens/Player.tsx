import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, BackHandler, View } from 'react-native'
import { KitPlayer, CueOverlay, parseHlsMaster } from '@moizp/vega-media-kit'
import type { Cue, KitPlayerRef, PlayerError, PlayerState, Tracks } from '@moizp/vega-media-kit'
import type { RemoteKey } from '@moizp/vega-media-kit/platform'
import type { Prefs, TitleDetail } from '@described/contracts'
import { Focusable, T } from '../components'
import { subscribeKeys } from '../focus/remote'
import {
  audioTrackFor, characteristicsByUri, clampSeek, clock, crossfadeAudio, resumePoint, seekStep, statusLine, textSelection,
  SEEK_COMMIT_MS, SEEK_REPEAT_MS, SEEK_STEP_S,
} from '../playback'
import { strings } from '../strings'
import { tokens } from '../theme/tokens'
import { scrimBands } from '../theme/scrim'
import { px } from '../theme/scale'
import { TrackSheet, type SheetItem } from './TrackSheet'

/** Buffering longer than this is announced ("Loading…"), once per stall. */
export const BUFFERING_ANNOUNCE_MS = 2000
/** Height of the bottom chrome (bar, time, status line) in px at 1080p; captions sit above it while it shows. */
const CHROME_BOTTOM = 176
const bands = scrimBands()
const announce = (s: string) => AccessibilityInfo.announceForAccessibility(s)

/**
 * What a platform binding needs about the film on screen (DESC-008: Media Controls, Alexa pause). Player reports it
 * on every state or audio change and `null` when it unmounts; `controls` act on the live player.
 */
export interface PlayerSession {
  slug: string; name: string; state: PlayerState; adOn: boolean; durationS: number | null
  controls: { play(): void; pause(): void; seek(s: number): void; getPosition(): number }
}

export interface PlayerProps {
  title: TitleDetail; prefs: Prefs; withAd: boolean; scale: number
  /** Back: leave for Title. `positionS` is where to resume (0 once the film has ended). */
  onBack: (positionS: number) => void
  /** ≤ 4 Hz from the kit. Root saves progress from it. */
  onProgress: (s: number) => void
  /** Caption kind and Extended mode chosen in the track sheet, saved to /me/prefs. */
  onPrefs: (p: Partial<Prefs>) => void
  /** Platform audio for extended cues (DESC-007). Root passes a no-op until cues carry their own clips. */
  speak: (audioUrl: string) => Promise<void>
  onNowPlaying?: (n: PlayerSession | null) => void
}

/**
 * DESC-007 plugs in here: the per-cue clip for an `{extended=1}` cue (GET /titles/:slug/cues/:id/audio, prefetched
 * 10 s ahead). Until then there is none, so nothing pauses.
 */
const extendedCueAudio = (_cue: Cue, _slug: string): string | null => null

/**
 * Player: full-bleed video through the kit. AD is an audio rendition chosen by role; captions and description text
 * are text tracks chosen by kind and HLS characteristics; the kit's CueOverlay draws them. Chrome (title, bar,
 * time, status line) shows on any key and hides after 4 s of playing without input. Remote: Select / Play-Pause
 * toggle, ◄► skip 10 s (held: faster), ▲ or Menu open the track sheet, Back saves the position and leaves.
 */
export function Player({ title, prefs, withAd, scale, onBack, onProgress, onPrefs, speak, onNowPlaying }: PlayerProps) {
  const ref = useRef<KitPlayerRef>(null)
  const [state, setState] = useState<PlayerState>('idle')
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [tracks, setTracks] = useState<Tracks>({ audio: [], text: [] })
  const [chars, setChars] = useState<Map<string, string[]> | null>(null)
  const [cues, setCues] = useState<Cue[]>([])
  const [adOn, setAdOn] = useState(withAd) // the chosen action wins over the default
  const [position, setPosition] = useState(0)
  const [scrub, setScrub] = useState<number | null>(null)
  const [sheet, setSheet] = useState(false)
  const [chrome, setChrome] = useState(true)
  const [poke, setPoke] = useState(0)
  const [describing, setDescribing] = useState(false)

  const pos = useRef(0)
  const startAt = useRef(resumePoint(title.resumeS, title.durationS))
  const seekedToStart = useRef(false)
  const tracksRef = useRef(tracks)
  const stateRef = useRef(state)
  stateRef.current = state
  const scrubRef = useRef<number | null>(null)
  const commit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hold = useRef({ start: 0, last: 0 })
  const sheetItem = useRef<SheetItem | undefined>(undefined)
  const spoken = useRef(new Set<string>())

  const showChrome = useCallback(() => { setChrome(true); setPoke((n) => n + 1) }, [])
  const getPosition = useCallback(() => scrubRef.current ?? ref.current?.getPosition() ?? pos.current, [])

  // Rich vs plain captions is an HLS characteristic the kit's TextTrack does not carry: read it from the master.
  useEffect(() => {
    let live = true
    fetch(title.manifestUrl)
      .then(async (r) => parseHlsMaster(await r.text(), r.url || title.manifestUrl)) // base URL as the kit resolves it
      .then((m) => { if (live) setChars(characteristicsByUri(m.renditions)) })
      .catch(() => {}) // the NAME fallback covers it
    return () => { live = false }
  }, [title.manifestUrl])

  const selection = useMemo(() => textSelection(tracks.text, prefs.captionKind, { adOn, extendedMode: prefs.extendedMode, chars }), [tracks.text, prefs.captionKind, prefs.extendedMode, adOn, chars])
  const idsKey = selection.ids.join(',')
  // Text selection follows the choice; re-applied for every new track list (a retry reloads the source).
  useEffect(() => { if (tracks.text.length) ref.current?.selectText(selection.ids) }, [tracks, idsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Extended cues: pause → speak → resume (DESC-007 supplies the clip; see extendedCueAudio).
  useEffect(() => {
    const ext = cues.find((c) => c.meta?.extended === '1' && !spoken.current.has(c.id))
    if (!ext || !adOn || !prefs.extendedMode) return
    spoken.current.add(ext.id)
    const audio = extendedCueAudio(ext, title.slug)
    if (!audio) return
    setDescribing(true); ref.current?.pause()
    speak(audio).finally(() => { setDescribing(false); ref.current?.play() })
  }, [cues, adOn, prefs.extendedMode, speak, title.slug])

  // Chrome hides after 4 s of playing with no key; it stays while paused, loading, stopped or the sheet is open.
  useEffect(() => {
    if (!chrome || sheet || state !== 'playing' || error) return
    const t = setTimeout(() => setChrome(false), tokens.motion.overlayHideMs)
    return () => clearTimeout(t)
  }, [chrome, poke, sheet, state, error])
  const chromeShown = chrome || state !== 'playing' || error

  // A stall is announced once, after 2 s; a short one says nothing.
  useEffect(() => {
    if (error || (state !== 'loading' && state !== 'buffering')) return
    const t = setTimeout(() => announce(strings.player.loading), BUFFERING_ANNOUNCE_MS)
    return () => clearTimeout(t)
  }, [state, error])
  useEffect(() => { if (error) announce(strings.player.error) }, [error])

  useEffect(() => {
    onNowPlaying?.({
      slug: title.slug, name: title.name, state, adOn, durationS: title.durationS,
      controls: { play: () => ref.current?.play(), pause: () => ref.current?.pause(), seek: (s) => ref.current?.seek(clampSeek(s, title.durationS)), getPosition },
    })
  }, [onNowPlaying, title, state, adOn, getPosition])
  useEffect(() => () => onNowPlaying?.(null), [onNowPlaying])
  useEffect(() => () => clearTimeout(commit.current), [])

  const toggle = () => {
    if (error) { retry(); return }
    if (stateRef.current === 'playing' || stateRef.current === 'buffering') ref.current?.pause()
    else ref.current?.play()
  }
  const retry = () => {
    startAt.current = getPosition(); seekedToStart.current = false
    setError(false); setState('idle'); setTracks({ audio: [], text: [] }); setAttempt((a) => a + 1)
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
      ref.current?.seek(target)
      pos.current = target; setPosition(target)
      scrubRef.current = null; setScrub(null)
    }, SEEK_COMMIT_MS)
  }
  const openSheet = () => { setSheet(true) }
  const closeSheet = () => { setSheet(false); showChrome() }
  const chooseAudio = (on: boolean) => {
    if (on === adOn) return
    setAdOn(on)
    announce(on ? strings.tracks.announceOn : strings.tracks.announceOff)
    const t = audioTrackFor(tracksRef.current.audio, on)
    if (t && ref.current) void crossfadeAudio(ref.current, t.id)
  }

  // Raw keys (Select reaches the surface through spatial navigation; Back through BackHandler).
  const onKey = useRef<(k: RemoteKey, repeat: boolean) => void>(() => {})
  onKey.current = (k, repeat) => {
    if (k === 'back') return
    if (sheet) { if (k === 'menu' && !repeat) closeSheet(); return }
    showChrome()
    switch (k) {
      case 'playPause': if (!repeat) toggle(); break
      case 'play': ref.current?.play(); break
      case 'pause': ref.current?.pause(); break
      case 'left': case 'rewind': seekBy(-1, repeat); break
      case 'right': case 'fastForward': seekBy(1, repeat); break
      case 'up': case 'menu': if (!repeat) openSheet(); break
      default: break
    }
  }
  useEffect(() => subscribeKeys((k, repeat) => onKey.current(k, repeat)), [])

  const onBackRef = useRef<() => boolean>(() => false)
  onBackRef.current = () => {
    if (sheet) { closeSheet(); return true }
    clearTimeout(commit.current)
    onBack(stateRef.current === 'ended' ? 0 : getPosition())
    return true
  }
  useEffect(() => { const sub = BackHandler.addEventListener('hardwareBackPress', () => onBackRef.current()); return () => sub.remove() }, [])

  const onState = (s: PlayerState) => {
    setState(s)
    // The kit's Fire OS adapter does not apply `startAt` (react-native-video has no start position), so the resume
    // point is sought once the load is up. Harmless where startAt already worked.
    if ((s === 'ready' || s === 'playing') && !seekedToStart.current) {
      seekedToStart.current = true
      if (startAt.current > 0) { ref.current?.seek(startAt.current); pos.current = startAt.current; setPosition(startAt.current) }
    }
  }
  const onError = (e: PlayerError) => { if (e.fatal) { setError(true); setState('error') } }

  const shownPos = scrub ?? position
  const duration = title.durationS ?? 0
  const fraction = duration ? Math.min(1, shownPos / duration) : 0
  const status = statusLine({ state, error, adOn, voice: title.voice, caption: tracks.text.length ? selection.kind : prefs.captionKind })
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
        onTracks={(t: Tracks) => { tracksRef.current = t; setTracks(t) }}
        onCue={setCues} onState={onState} onError={onError}
        onPosition={(s: number) => { pos.current = s; setPosition(s); onProgress(s) }}
        style={{ flex: 1 }}
      />
      <CueOverlay active={visibleCues} primaryTrackId={selection.shown} scale={scale} safeInset={{ x: Math.round(tokens.layout.safeX * scale), y: Math.round(insetY * scale) }}
        theme={{ fontFamily: tokens.type.caption.family, boxColor: tokens.color.cueBox, primaryColor: tokens.color.text, userScale: prefs.captionScale / 100 }} />

      <View testID="chrome" pointerEvents="none" accessibilityElementsHidden={!chromeShown} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: chromeShown ? 1 : 0 }}>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: px(200) }}>{[...bands].reverse().map((c) => <View key={c} style={{ flex: 1, backgroundColor: c }} />)}</View>
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: px(CHROME_BOTTOM + tokens.layout.safeY + 80) }}>{bands.map((c) => <View key={c} style={{ flex: 1, backgroundColor: c }} />)}</View>
        <View style={{ position: 'absolute', top: px(tokens.layout.safeY), left: px(tokens.layout.safeX), right: px(tokens.layout.safeX) }}>
          <T variant="heading" numberOfLines={1}>{title.name}</T>
        </View>
      </View>

      <View style={{ position: 'absolute', left: px(tokens.layout.safeX), right: px(tokens.layout.safeX), bottom: px(tokens.layout.safeY), gap: px(16), opacity: chromeShown ? 1 : 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: px(24) }}>
          <T variant="label" style={{ minWidth: px(120) }}>{clock(shownPos)}</T>
          <View style={{ flex: 1 }}>
            {sheet ? <View style={{ height: px(44) }} /> : (
              <Focusable label={strings.player.surface(title.name)} hint={strings.player.surfaceHint} defaultFocus onPress={() => { showChrome(); toggle() }} testID="player-surface"
                style={{ height: px(44), justifyContent: 'center', paddingHorizontal: px(8) }}>
                <View accessibilityLabel={strings.player.position(clock(shownPos), clock(duration))} style={{ height: px(8), borderRadius: px(4), backgroundColor: tokens.color.surface3, overflow: 'hidden' }}>
                  <View testID="progress-fill" style={{ width: `${fraction * 100}%`, height: '100%', backgroundColor: tokens.color.interactive }} />
                </View>
              </Focusable>
            )}
          </View>
          <T variant="label" color={tokens.color.textSecondary} style={{ minWidth: px(120), textAlign: 'right' }}>{clock(duration)}</T>
        </View>
        {/* Persistent 28 px status line, bottom-left; hides with the chrome. */}
        <T variant="label" testID="status-line" color={error ? tokens.color.error : tokens.color.textSecondary}>{status}</T>
      </View>

      {describing ? <View accessibilityLabel={strings.player.extendedBar} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: px(8), backgroundColor: tokens.color.badge }} /> : null}
      {sheet ? (
        <TrackSheet voice={title.voice} adOn={adOn} captionKind={prefs.captionKind} extendedMode={prefs.extendedMode} initial={sheetItem.current}
          onFocusItem={(id) => { sheetItem.current = id }} onAudio={chooseAudio}
          onCaptions={(k) => onPrefs({ captionKind: k })} onExtended={(on) => onPrefs({ extendedMode: on })} />
      ) : null}
    </View>
  )
}
