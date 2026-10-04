import React, { useState } from 'react'
import { View } from 'react-native'
import { SpatialNavigationNode } from 'react-tv-space-navigation'
import { Focusable } from './Focusable'
import { T } from './Text'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'
import { strings } from '../strings'

export interface RailItem { key: string; label: string }
/**
 * Left navigation rail: 96 px collapsed, 336 px while it holds focus. The wide panel overlays the content, so
 * content geometry never moves. ▲▼ between items; ► returns to the content's last focused element.
 */
/** `focusCurrent`: the current item takes focus when the screen mounts (a screen with nothing else to focus, e.g. an empty My list). */
export function Rail({ items, current, onSelect, focusCurrent }: { items: RailItem[]; current: string; onSelect: (k: string) => void; focusCurrent?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <SpatialNavigationNode orientation="vertical" onActive={() => setOpen(true)} onInactive={() => setOpen(false)}>
      <View style={{ width: px(tokens.layout.rail), zIndex: 2 }}>
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: px(open ? tokens.layout.railExpanded : tokens.layout.rail), paddingTop: px(tokens.layout.safeY), paddingHorizontal: px(12), gap: px(12), backgroundColor: tokens.color.surface1 }} accessibilityRole="menu">
          {items.map((it) => (
            <Focusable key={it.key} label={strings.a11y.rail(it.label)} selected={it.key === current} check={open} defaultFocus={!!focusCurrent && it.key === current} onPress={() => onSelect(it.key)} style={{ paddingVertical: px(16), paddingHorizontal: px(12) }} focusedStyle={{ backgroundColor: tokens.color.surface2 }}>
              <T variant="label" numberOfLines={1} color={it.key === current ? tokens.color.interactive : tokens.color.textSecondary}>{open ? it.label : it.label.slice(0, 1)}</T>
            </Focusable>
          ))}
        </View>
      </View>
    </SpatialNavigationNode>
  )
}
