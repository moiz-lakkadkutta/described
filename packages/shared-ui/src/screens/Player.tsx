import React, { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { KitPlayer, CueOverlay } from '@moizp/vega-media-kit'
import type { Cue, KitPlayerRef, PlayerState } from '@moizp/vega-media-kit'
import type { Prefs, TitleDetail } from '@described/contracts'
import { T } from '../components'
import { strings } from '../strings'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'
import { TrackSheet } from './TrackSheet'

/**
 * Player: AD is an audio rendition (role=description) selected through the kit; captions/descriptions are text tracks.
 * Extended cues ({extended=1} meta) pause the video, play Polly audio, resume — WCAG 1.2.7 behaviour.
 */
export function Player({ title, prefs, withAd, scale, onBack, onProgress, speak }: {
  title: TitleDetail; prefs: Prefs; withAd: boolean; scale: number; onBack: (positionS: number) => void; onProgress: (s: number) => void
  speak: (audioUrl: string) => Promise<void> // platform-provided audio playback for extended cues
}) {
  const ref = useRef<KitPlayerRef>(null)
  const [cues, setCues] = useState<Cue[]>([])
  const [state, setState] = useState<PlayerState>('idle')
  const [sheet, setSheet] = useState(false)
  const [adOn, setAdOn] = useState(withAd && prefs.adDefault)
  const [describing, setDescribing] = useState(false)
  const spoken = useRef(new Set<string>())
  const textIds = () => (prefs.captionKind === 'off' ? [] : [`${prefs.captionKind}-${title.tracks.text[0]?.language ?? 'en'}`]).concat(prefs.extendedMode ? ['descriptions-' + (title.tracks.text[0]?.language ?? 'en')] : [])

  useEffect(() => {
    // Extended-description handling: when a cue with extended=1 becomes active, pause → speak → resume.
    const ext = cues.find((c) => c.meta?.extended === '1' && !spoken.current.has(c.id))
    if (!ext || !adOn || !prefs.extendedMode) return
    spoken.current.add(ext.id)
    const audio = title.sampleCue?.audioUrl // TODO(DESC-007): per-cue audio URL from /titles/:slug/cues/:id/audio, prefetched 10 s ahead
    if (!audio) return
    setDescribing(true); ref.current?.pause()
    speak(audio).finally(() => { setDescribing(false); ref.current?.play() })
  }, [cues, adOn, prefs.extendedMode, speak, title.sampleCue])

  const visibleCues = cues.filter((c) => !c.meta?.extended || prefs.captionKind === 'descriptions')
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <KitPlayer
        ref={ref}
        source={{ uri: title.manifestUrl, type: 'hls', headers: { 'x-kit-text-urls': JSON.stringify(Object.fromEntries(title.tracks.text.map((t) => [t.id, t.url]))) } }}
        autoplay startAt={title.resumeS ?? 0}
        preferredAudio={{ role: adOn ? 'description' : 'main' }}
        preferredText={{ kinds: prefs.captionKind === 'off' ? [] : [prefs.captionKind === 'sdh' ? 'captions' : prefs.captionKind === 'descriptions' ? 'descriptions' : 'subtitles'] }}
        onCue={setCues} onState={setState} onPosition={onProgress}
      />
      <CueOverlay active={visibleCues} scale={scale} theme={{ fontFamily: tokens.type.caption.family, userScale: prefs.captionScale / 100 }} />
      {/* persistent 28 px status line, bottom-left (hides with chrome after 4 s — TODO(DESC-006)) */}
      <View style={{ position: 'absolute', left: px(tokens.layout.safeX), bottom: px(tokens.layout.safeY) }}>
        <T variant="label" color={tokens.color.textSecondary}>{state === 'buffering' ? strings.player.loading : adOn ? strings.player.statusOn(title.voice, prefs.captionKind) : strings.player.statusOff}</T>
      </View>
      {describing ? <View accessibilityLiveRegion="polite" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: px(8), backgroundColor: tokens.color.badge }} /> : null}
      {sheet ? (
        <TrackSheet title={title} adOn={adOn} prefs={prefs} onAd={(on) => { setAdOn(on); ref.current?.selectAudio(on ? 'audio_ad' : 'audio_main') }} onText={(ids) => ref.current?.selectText(ids)} onClose={() => setSheet(false)} />
      ) : null}
      {/* Remote wiring (Menu → sheet, Back → onBack(position), Play/Pause) is done in Root via useRemote; exposed handlers: */}
      <View accessible={false} style={{ display: 'none' }} testID="player-handlers" onLayout={() => void textIds} />
    </View>
  )
}
