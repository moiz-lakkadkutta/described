import React, { useCallback, useEffect, useRef } from 'react'
import { Animated, Image, View } from 'react-native'
import { SpatialNavigationNode } from 'react-tv-space-navigation'
import { useFocusMemory } from '@moizp/vega-media-kit/focus'
import type { Prefs, TitleDetail } from '@described/contracts'
import { AdBadge, Focusable, T } from '../components'
import { pickInitialFocus } from '../focus/memory'
import { titleModel, type Action, type SampleState } from '../models'
import { strings } from '../strings'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'

const L = tokens.layout
export interface TitleProps {
  title: TitleDetail | null; captionKind: Prefs['captionKind']; inList: boolean; sample: SampleState
  onPlay: (withAd: boolean) => void; onSample: () => void; onCaptions: () => void; onToggleList: () => void; onMore: () => void
}

/** Poster left; name, facts, badges, synopsis (4 lines + More), actions, attribution right. `title: null` → same-size skeleton. */
export function Title(p: TitleProps) {
  return p.title ? <TitleBody {...p} title={p.title} /> : <TitleSkeleton />
}
function TitleBody({ title, captionKind, inList, sample, onPlay, onSample, onCaptions, onToggleList, onMore }: TitleProps & { title: TitleDetail }) {
  const { remember, lastId } = useFocusMemory(`title:${title.slug}`, useCallback(() => {}, []))
  const m = titleModel(title, { sample, inList, captionKind })
  const initial = pickInitialFocus(lastId.current, [...m.actions.map((a) => a.id), ...(m.more ? ['more'] : [])], m.actions[0]?.id ?? 'more')
  const run: Record<string, () => void> = { playAd: () => onPlay(true), play: () => onPlay(false), sample: onSample, captions: onCaptions, list: onToggleList, more: onMore }
  const button = (a: Action) => (
    <Focusable key={a.id} label={a.label} hint={a.hint} selected={a.selected} defaultFocus={a.id === initial} onFocus={() => remember(a.id)} onPress={run[a.id]}
      style={{ alignSelf: 'flex-start', backgroundColor: a.primary ? tokens.color.interactive : tokens.color.surface2, paddingHorizontal: px(28), paddingVertical: px(12) }}
      focusedStyle={a.primary ? undefined : { backgroundColor: tokens.color.surface3 }}>
      <T variant="body" color={a.primary ? tokens.color.ground : tokens.color.text}>{a.primary ? `▶ ${a.text}` : a.text}</T>
    </Focusable>
  )
  return (
    <View style={{ flex: 1, flexDirection: 'row', gap: px(48) }}>
      <View style={{ width: px(L.posterW), height: px(L.posterH), borderRadius: 6, overflow: 'hidden', backgroundColor: tokens.color.surface2 }}>
        {title.posterUrl ? <Image source={{ uri: title.posterUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
        {sample === 'playing' ? <SampleIndicator /> : null}
      </View>
      <SpatialNavigationNode orientation="vertical">
        <View style={{ flex: 1, gap: px(16) }}>
          <T variant="display" numberOfLines={2}>{title.name}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: px(12) }}>
            {m.meta ? <T variant="body" color={tokens.color.textSecondary}>{m.meta}{m.badges.length ? ' ·' : ''}</T> : null}
            {m.badges.map((b) => b.ad ? <AdBadge key={b.text} inline /> : (
              <View key={b.text} style={{ backgroundColor: tokens.color.surface2, paddingHorizontal: px(10), paddingVertical: px(2), borderRadius: 3 }}><T variant="label">{b.text.toUpperCase()}</T></View>
            ))}
          </View>
          {title.synopsis ? <T variant="body" numberOfLines={4} style={{ maxWidth: px(1100) }}>{title.synopsis}</T> : null}
          {m.more ? button(m.more) : null}
          {m.processing ? (
            <View accessibilityLiveRegion="polite" style={{ marginTop: px(12), flexDirection: 'row', alignItems: 'center', gap: px(16) }}>
              <Pulse /><T variant="heading">{m.processing}</T>
            </View>
          ) : null}
          <View style={{ gap: px(12), marginTop: px(8) }}>{m.actions.map(button)}</View>
          <T variant="label" color={tokens.color.textSecondary} style={{ marginTop: 'auto' }}>{title.attribution}</T>
        </View>
      </SpatialNavigationNode>
    </View>
  )
}

/** Full-screen synopsis at 36 px; Back or Close returns to Title with More focused. */
export function Reading({ title, onClose }: { title: TitleDetail | null; onClose: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: px(32) }}>
      <View style={{ width: px(L.readingW), gap: px(24) }}>
        <T variant="title">{title?.name ?? ''}</T>
        <T variant="reading">{title?.synopsis ?? ''}</T>
        <Focusable label={strings.a11y.close} defaultFocus onPress={onClose} style={{ alignSelf: 'flex-start', backgroundColor: tokens.color.surface2, paddingHorizontal: px(28), paddingVertical: px(12) }} focusedStyle={{ backgroundColor: tokens.color.surface3 }}>
          <T variant="body">{strings.title.close}</T>
        </Focusable>
      </View>
    </View>
  )
}

/** Visible "speaking" indicator over the poster while the sample plays: five bars + words, announced politely. */
function SampleIndicator() {
  return (
    <View accessibilityLiveRegion="polite" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: px(24), flexDirection: 'row', alignItems: 'center', gap: px(16), backgroundColor: tokens.color.scrimBottom }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: px(6), height: px(40) }}>{[0, 1, 2, 3, 4].map((i) => <Bar key={i} delay={i * 90} />)}</View>
      <T variant="label">{strings.title.samplePlaying}</T>
    </View>
  )
}
function useLoop(delay: number, ms: number) {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([Animated.delay(delay), Animated.timing(v, { toValue: 1, duration: ms, useNativeDriver: true }), Animated.timing(v, { toValue: 0, duration: ms, useNativeDriver: true })]))
    loop.start(); return () => loop.stop()
  }, [v, delay, ms])
  return v
}
function Bar({ delay }: { delay: number }) {
  const v = useLoop(delay, 300)
  return <Animated.View style={{ width: px(8), height: px(40), borderRadius: 2, backgroundColor: tokens.color.badge, transform: [{ scaleY: v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) }] }} />
}
/** Never a spinner alone: the processing line always carries words; this is only a slow pulse beside them. */
function Pulse() {
  const v = useLoop(0, 900)
  return <Animated.View style={{ width: px(20), height: px(20), borderRadius: px(10), backgroundColor: tokens.color.textSecondary, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }} />
}
function TitleSkeleton() {
  const bar = (w: number, h: number) => <View style={{ width: px(w), height: px(h), borderRadius: 3, backgroundColor: tokens.color.surface1 }} />
  return (
    <View style={{ flex: 1, flexDirection: 'row', gap: px(48) }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ width: px(L.posterW), height: px(L.posterH), borderRadius: 6, backgroundColor: tokens.color.surface1 }} />
      <View style={{ flex: 1, gap: px(16) }}>{bar(640, tokens.type.display.line)}{bar(420, tokens.type.body.line)}{bar(1000, tokens.type.body.line * 4)}{bar(420, 68)}{bar(360, 68)}</View>
    </View>
  )
}
