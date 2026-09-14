import React from 'react'
import { Text as RNText, type TextProps } from 'react-native'
import { tokens, type TypeRole } from '../theme/tokens'
import { px } from '../theme/scale'

export function T({ variant = 'body', color, style, ...rest }: TextProps & { variant?: TypeRole; color?: string }) {
  const t = tokens.type[variant]
  return (
    <RNText
      {...rest}
      style={[{ fontFamily: t.family, fontWeight: t.weight, fontSize: px(t.size), lineHeight: px(t.line), letterSpacing: t.tracking ? px(t.size) * t.tracking : 0, color: color ?? tokens.color.text, fontVariant: t.tabular ? ['tabular-nums'] : undefined }, style]}
    />
  )
}
