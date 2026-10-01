import React, { createContext, useContext } from 'react'
import { Text as RNText, type TextProps } from 'react-native'
import { tokens, type TypeRole } from '../theme/tokens'
import { textStyle } from '../theme/typography'
import { uiScale } from '../theme/scale'

/** False when the platform could not load Atkinson Hyperlegible: system sans at identical sizes. */
export const FontsLoadedContext = createContext(true)

export function T({ variant = 'body', color, style, ...rest }: TextProps & { variant?: TypeRole; color?: string }) {
  const loaded = useContext(FontsLoadedContext)
  return <RNText {...rest} style={[textStyle(variant, loaded, uiScale()), { color: color ?? tokens.color.text }, style]} />
}
