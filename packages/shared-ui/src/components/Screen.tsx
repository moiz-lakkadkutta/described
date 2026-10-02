import React from 'react'
import { View } from 'react-native'
import { SpatialNavigationNode } from 'react-tv-space-navigation'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'
/** Ground + 5 % safe zone. Every screen sits inside this. Rail and content are siblings in one horizontal focus group. */
export function Screen({ children, rail }: { children: React.ReactNode; rail?: React.ReactNode }) {
  return (
    <SpatialNavigationNode orientation="horizontal">
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: tokens.color.ground }}>
        {rail}
        <SpatialNavigationNode orientation="vertical">
          <View style={{ flex: 1, paddingHorizontal: px(tokens.layout.safeX), paddingVertical: px(tokens.layout.safeY) }}>{children}</View>
        </SpatialNavigationNode>
      </View>
    </SpatialNavigationNode>
  )
}
