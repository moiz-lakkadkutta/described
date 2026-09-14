import React, { useState } from 'react'
import { Animated, Pressable, StyleSheet, type ViewStyle } from 'react-native'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'

export interface FocusableProps {
  children: React.ReactNode
  onPress?: () => void
  onFocus?: () => void
  label: string // aria-label: purpose, not "button"
  hint?: string
  selected?: boolean
  style?: ViewStyle
  hasTVPreferredFocus?: boolean
  testID?: string
}

/** Focus is a physical change: outline + 1.04 scale in 150 ms. Selected is a persistent accent ring. Never colour alone. */
export function Focusable({ children, onPress, onFocus, label, hint, selected, style, hasTVPreferredFocus, testID }: FocusableProps) {
  const [focused, setFocused] = useState(false)
  const scale = React.useRef(new Animated.Value(1)).current
  const animate = (to: number) => Animated.timing(scale, { toValue: to, duration: tokens.motion.focusMs, useNativeDriver: true }).start()
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => { setFocused(true); animate(tokens.motion.focusScale); onFocus?.() }}
      onBlur={() => { setFocused(false); animate(1) }}
      hasTVPreferredFocus={hasTVPreferredFocus}
      aria-label={label}
      accessibilityHint={hint}
      aria-selected={selected}
      testID={testID}
      style={{ outlineWidth: 0 }}
    >
      <Animated.View
        style={[
          styles.base,
          style,
          selected && { borderColor: tokens.color.interactive, borderWidth: px(3) },
          focused && { borderColor: tokens.color.focus, borderWidth: px(tokens.focus.width), margin: -px(tokens.focus.width) },
          { transform: [{ scale }] },
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  )
}
const styles = StyleSheet.create({ base: { borderRadius: 6, borderColor: 'transparent', borderWidth: 0 } })
