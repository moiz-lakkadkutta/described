import React from 'react'
import { Image, View } from 'react-native'
import { Focusable } from './Focusable'
import { T } from './Text'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'

export interface CardProps { title: string; imageUrl?: string; badge?: string; meta?: string; onPress: () => void; label: string; testID?: string }
/** 16:9 card, 412×232 px at 1080p. Badge top-left, title below. Focus growth stays inside the 24 px gutter. */
export function Card({ title, imageUrl, badge, meta, onPress, label, testID }: CardProps) {
  const w = tokens.layout.cardW, h = tokens.layout.cardH
  return (
    <Focusable label={label} onPress={onPress} testID={testID}>
      <View style={{ width: px(w) }}>
        <View style={{ width: px(w), height: px(h), borderRadius: 6, overflow: 'hidden', backgroundColor: tokens.color.surface2 }}>
          {imageUrl ? <Image source={{ uri: imageUrl }} style={{ width: '100%', height: '100%' }} accessibilityIgnoresInvertColors /> : null}
          {badge ? (
            <View style={{ position: 'absolute', top: px(12), left: px(12), backgroundColor: tokens.color.badge, paddingHorizontal: px(10), paddingVertical: px(4), borderRadius: 3 }}>
              <T variant="label" color={tokens.color.ground}>{badge}</T>
            </View>
          ) : null}
        </View>
        <T variant="body" numberOfLines={1} style={{ marginTop: px(10) }}>{title}</T>
        {meta ? <T variant="label" color={tokens.color.textSecondary}>{meta}</T> : null}
      </View>
    </Focusable>
  )
}
