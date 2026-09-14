import React from 'react'
import { View } from 'react-native'
import type { Prefs, TitleDetail } from '@described/contracts'
import { Focusable, T } from '../components'
import { strings } from '../strings'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'

/** Right-side 640 px panel: Audio (Original / Audio description) · Captions (Off / Captions / Rich / Description text) · Extended mode. */
export function TrackSheet({ title, adOn, prefs, onAd, onText, onClose }: { title: TitleDetail; adOn: boolean; prefs: Prefs; onAd: (on: boolean) => void; onText: (ids: string[]) => void; onClose: () => void }) {
  const lang = title.tracks.text[0]?.language ?? 'en'
  const item = (label: string, selected: boolean, onPress: () => void, first = false) => (
    <Focusable key={label} label={label} selected={selected} hasTVPreferredFocus={first} onPress={onPress} style={{ paddingVertical: px(18), paddingHorizontal: px(24) }}>
      <T variant="body">{selected ? '✓  ' : '    '}{label}</T>
    </Focusable>
  )
  return (
    <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: px(640), backgroundColor: tokens.color.surface1, padding: px(48), gap: px(8) }} accessibilityViewIsModal aria-label={strings.tracks.heading}>
      <T variant="title">{strings.tracks.heading}</T>
      <T variant="label" color={tokens.color.textSecondary} style={{ marginTop: px(24) }}>{strings.tracks.audio.toUpperCase()}</T>
      {item(strings.tracks.original, !adOn, () => onAd(false), true)}
      {item(strings.tracks.ad(title.voice), adOn, () => onAd(true))}
      <T variant="label" color={tokens.color.textSecondary} style={{ marginTop: px(24) }}>{strings.tracks.captions.toUpperCase()}</T>
      {item(strings.tracks.off, prefs.captionKind === 'off', () => onText([]))}
      {item(strings.tracks.plain, prefs.captionKind === 'captions', () => onText([`captions-${lang}`]))}
      {item(strings.tracks.rich, prefs.captionKind === 'sdh', () => onText([`sdh-${lang}`]))}
      {item(strings.tracks.descText, prefs.captionKind === 'descriptions', () => onText([`descriptions-${lang}`]))}
      <View style={{ marginTop: 'auto' }}>{item(strings.tracks.extended, prefs.extendedMode, onClose)}</View>
    </View>
  )
}
