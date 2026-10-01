import React from 'react'
import { Image, View } from 'react-native'
import { Focusable } from './Focusable'
import { T } from './Text'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'
import { cardBox } from '../layout'
import { strings } from '../strings'

export interface CardProps { title: string; imageUrl?: string; ad?: boolean; meta?: string; onPress: () => void; onFocus?: () => void; label: string; defaultFocus?: boolean; testID?: string }
const L = tokens.layout
/** 16:9 card, 412×232 px at 1080p. AD badge top-left, title and meta below (both lines always present). Focus growth stays inside the row's padding. */
export function Card({ title, imageUrl, ad, meta, onPress, onFocus, label, defaultFocus, testID }: CardProps) {
  return (
    <Focusable label={label} onPress={onPress} onFocus={onFocus} defaultFocus={defaultFocus} testID={testID}>
      {({ focused }) => (
        <View style={{ width: px(cardBox.w), height: px(cardBox.h) }}>
          <View style={{ width: px(L.cardW), height: px(L.cardH), borderRadius: 6, overflow: 'hidden', backgroundColor: focused ? tokens.color.surface3 : tokens.color.surface2 }}>
            {imageUrl ? <Image source={{ uri: imageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
            {ad ? <AdBadge /> : null}
          </View>
          <T variant="body" numberOfLines={1} style={{ marginTop: px(10) }}>{title}</T>
          <T variant="label" numberOfLines={1} color={tokens.color.textSecondary}>{meta || ' '}</T>
        </View>
      )}
    </Focusable>
  )
}
/** Ochre is reserved for this badge, and it always carries the letters. */
export function AdBadge({ inline }: { inline?: boolean }) {
  return (
    <View style={[{ backgroundColor: tokens.color.badge, paddingHorizontal: px(10), paddingVertical: px(2), borderRadius: 3 }, inline ? null : { position: 'absolute', top: px(12), left: px(12) }]}>
      <T variant="label" color={tokens.color.ground}>{strings.badge.ad}</T>
    </View>
  )
}
/** Loading placeholder with the card's exact box, so focus geometry never jumps when data arrives. Not focusable. */
export function SkeletonCard() {
  const line = (role: 'body' | 'label', w: number) => (
    <View style={{ height: px(tokens.type[role].line), justifyContent: 'center' }}><View style={{ width: px(w), height: px(tokens.type[role].size * 0.7), borderRadius: 3, backgroundColor: tokens.color.surface1 }} /></View>
  )
  return (
    <View style={{ width: px(cardBox.w), height: px(cardBox.h) }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ width: px(L.cardW), height: px(L.cardH), borderRadius: 6, backgroundColor: tokens.color.surface1 }} />
      <View style={{ marginTop: px(10) }}>{line('body', 260)}{line('label', 140)}</View>
    </View>
  )
}
