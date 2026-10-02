import React from 'react'
import { View } from 'react-native'
import { SpatialNavigationNode, SpatialNavigationScrollView } from 'react-tv-space-navigation'
import { FocusRow } from '@moizp/vega-media-kit/focus'
import { T } from './Text'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'
import { rowPad, rowPadY, rowViewportW } from '../layout'
import { setFocusContext } from '../a11y'

/**
 * Label above a horizontal focus group: 3 cards visible + a 40 px peek, 24 px gutters. LRUD keeps the row's last
 * focused card, so ▲▼ back into a row lands where you left it; ◄ from the first card falls through to the rail.
 */
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: px(28) }}>
      <T variant="label" color={tokens.color.textSecondary} style={{ marginBottom: px(6), marginLeft: px(rowPad) }}>{label.toUpperCase()}</T>
      {/* Entering the row says its name once, before the card (VoiceView never reaches the label text). */}
      <SpatialNavigationNode orientation="horizontal" onActive={() => setFocusContext(label)}>
        <SpatialNavigationScrollView horizontal useNativeScroll offsetFromStart={px(rowPad)} style={{ width: px(rowViewportW + 2 * rowPad) }}>
          {/* FocusRow pads gutter/2 vertically; top up to rowPadY so the outline is never clipped. */}
          <View style={{ paddingHorizontal: px(rowPad), paddingVertical: px(Math.max(0, rowPadY - tokens.layout.gutter / 2)) }}>
            <FocusRow gutter={px(tokens.layout.gutter)}>{children}</FocusRow>
          </View>
        </SpatialNavigationScrollView>
      </SpatialNavigationNode>
    </View>
  )
}
