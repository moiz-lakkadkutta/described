import React from 'react'
import { View } from 'react-native'
import { SpatialNavigationNode, SpatialNavigationScrollView } from 'react-tv-space-navigation'
import { FocusRow } from '@moizp/vega-media-kit/focus'
import { T } from './Text'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'
import { rowPad, rowViewportW } from '../layout'

/**
 * Label above a horizontal focus group: 3 cards visible + a 40 px peek, 24 px gutters. LRUD keeps the row's last
 * focused card, so ▲▼ back into a row lands where you left it; ◄ from the first card falls through to the rail.
 */
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: px(28) }}>
      <T variant="label" color={tokens.color.textSecondary} style={{ marginBottom: px(6), marginLeft: px(rowPad) }}>{label.toUpperCase()}</T>
      <SpatialNavigationNode orientation="horizontal">
        <SpatialNavigationScrollView horizontal useNativeScroll offsetFromStart={px(rowPad)} style={{ width: px(rowViewportW + 2 * rowPad) }}>
          <View style={{ paddingHorizontal: px(rowPad) }}>
            <FocusRow gutter={px(tokens.layout.gutter)}>{children}</FocusRow>
          </View>
        </SpatialNavigationScrollView>
      </SpatialNavigationNode>
    </View>
  )
}
