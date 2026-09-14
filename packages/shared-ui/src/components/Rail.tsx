import React from 'react'
import { View } from 'react-native'
import { Focusable } from './Focusable'
import { T } from './Text'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'

export interface RailItem { key: string; label: string }
/** Left navigation rail: 96 px collapsed, labels appear on focus. Vertical D-pad moves between items; → leaves the rail. */
export function Rail({ items, current, onSelect, expanded }: { items: RailItem[]; current: string; onSelect: (k: string) => void; expanded: boolean }) {
  return (
    <View style={{ width: px(expanded ? tokens.layout.railExpanded : tokens.layout.rail), paddingTop: px(tokens.layout.safeY), gap: px(12), backgroundColor: tokens.color.surface1 }} accessibilityRole="menu">
      {items.map((it) => (
        <Focusable key={it.key} label={it.label} selected={it.key === current} onPress={() => onSelect(it.key)} style={{ paddingVertical: px(20), paddingHorizontal: px(24) }}>
          <T variant="label" color={it.key === current ? tokens.color.interactive : tokens.color.textSecondary}>{expanded ? it.label : it.label.slice(0, 1)}</T>
        </Focusable>
      ))}
    </View>
  )
}
