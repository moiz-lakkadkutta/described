import React from 'react'
import { Image, View } from 'react-native'
import type { TitleDetail } from '@described/contracts'
import { Focusable, T } from '../components'
import { strings } from '../strings'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'

export function Title({ title, onPlay, onHearSample, onBack }: { title: TitleDetail; onPlay: (withAd: boolean) => void; onHearSample: () => void; onBack: () => void }) {
  const badges = ['AD', 'Rich captions', ...(title.extendedCount ? [`Extended: ${title.extendedCount} pauses`] : [])]
  return (
    <View style={{ flexDirection: 'row', gap: px(48) }}>
      <View style={{ width: px(480), height: px(720), borderRadius: 6, overflow: 'hidden', backgroundColor: tokens.color.surface2 }}>
        {title.posterUrl ? <Image source={{ uri: title.posterUrl }} style={{ width: '100%', height: '100%' }} /> : null}
      </View>
      <View style={{ flex: 1, gap: px(20) }}>
        <T variant="display">{title.name}</T>
        <T variant="body" color={tokens.color.textSecondary}>{[title.year, title.durationS ? `${Math.round(title.durationS / 60)} min` : null].filter(Boolean).join(' · ')}</T>
        <View style={{ flexDirection: 'row', gap: px(12) }}>
          {badges.map((b) => <View key={b} style={{ backgroundColor: b === 'AD' ? tokens.color.badge : tokens.color.surface2, paddingHorizontal: px(12), paddingVertical: px(6), borderRadius: 3 }}><T variant="label" color={b === 'AD' ? tokens.color.ground : tokens.color.text}>{b}</T></View>)}
        </View>
        <T variant="body" numberOfLines={4}>{title.synopsis}</T>
        <View style={{ gap: px(14), marginTop: px(12) }}>
          <Focusable label={`${strings.home.playWithAd}: ${title.name}`} hasTVPreferredFocus onPress={() => onPlay(true)} style={{ backgroundColor: tokens.color.interactive, paddingHorizontal: px(32), paddingVertical: px(18), alignSelf: 'flex-start' }}><T variant="heading" color={tokens.color.ground}>▶ {strings.home.playWithAd}</T></Focusable>
          <Focusable label={`${strings.home.play} ${title.name} without description`} onPress={() => onPlay(false)} style={{ backgroundColor: tokens.color.surface2, paddingHorizontal: px(32), paddingVertical: px(18), alignSelf: 'flex-start' }}><T variant="heading">{strings.home.play}</T></Focusable>
          <Focusable label={strings.title.hearSample} hint="Plays 20 seconds of the description voice" onPress={onHearSample} style={{ backgroundColor: tokens.color.surface2, paddingHorizontal: px(32), paddingVertical: px(18), alignSelf: 'flex-start' }}><T variant="heading">{strings.title.hearSample}</T></Focusable>
        </View>
        <T variant="label" color={tokens.color.textSecondary} style={{ marginTop: 'auto' }}>{title.attribution}</T>
      </View>
    </View>
  )
}
