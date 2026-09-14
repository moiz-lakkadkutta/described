import React from 'react'
import { View } from 'react-native'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'
/** Ground + 5 % safe zone. Every screen sits inside this. */
export function Screen({ children, rail }: { children: React.ReactNode; rail?: React.ReactNode }) {
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: tokens.color.ground }}>
      {rail}
      <View style={{ flex: 1, paddingHorizontal: px(tokens.layout.safeX), paddingVertical: px(tokens.layout.safeY) }}>{children}</View>
    </View>
  )
}
