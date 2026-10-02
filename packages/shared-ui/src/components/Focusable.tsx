import React, { useRef } from 'react'
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native'
import { DefaultFocus, SpatialNavigationFocusableView } from 'react-tv-space-navigation'
import { announceFocus } from '../a11y'
import { T } from './Text'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'

export interface FocusableProps {
  children: React.ReactNode | ((s: { focused: boolean }) => React.ReactNode)
  onPress?: () => void
  onFocus?: () => void
  label: string // aria-label: purpose, not "button"
  hint?: string
  selected?: boolean
  style?: ViewStyle
  /** Applied while focused, e.g. the surface one step brighter. */
  focusedStyle?: ViewStyle
  /** Takes focus when its screen mounts (react-tv-space-navigation DefaultFocus). */
  defaultFocus?: boolean
  /** Draw the ✓ with the selected ring (off where there is no room, e.g. the collapsed rail). */
  check?: boolean
  testID?: string
}

const radius = tokens.radius.card
/**
 * Focus is a physical change: 4 px off-white outline 3 px outside the element + 1.04 scale in 150 ms.
 * Selected is a teal inset ring + check. Never colour alone. Focus comes from react-tv-space-navigation
 * (native Pressable focus never moves on the stick — friction 2026-09-26 D-pad).
 */
export function Focusable({ children, onPress, onFocus, label, hint, selected, style, focusedStyle, defaultFocus, check = true, testID }: FocusableProps) {
  const scale = useRef(new Animated.Value(1)).current
  const focused = useRef(false)
  const animate = (to: number) => Animated.timing(scale, { toValue: to, duration: tokens.motion.focusMs, useNativeDriver: true }).start()
  // Always wrapped: toggling the wrapper would remount the node and drop focus.
  return (
    <DefaultFocus enable={!!defaultFocus}>
      <SpatialNavigationFocusableView
        onSelect={onPress}
        onFocus={() => { focused.current = true; animate(tokens.motion.focusScale); announceFocus(label, hint, () => focused.current); onFocus?.() }}
        onBlur={() => { focused.current = false; animate(1) }}
        viewProps={{ 'aria-label': label, accessibilityHint: hint, accessibilityState: { selected: !!selected }, testID }}
      >
        {({ isFocused }) => (
          <Animated.View style={[styles.base, style, isFocused && focusedStyle, { transform: [{ scale }] }]}>
            {typeof children === 'function' ? children({ focused: isFocused }) : children}
            {selected ? (
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: px(radius), borderWidth: px(tokens.focus.selectedWidth), borderColor: tokens.color.interactive }]}>
                {check ? <View style={{ position: 'absolute', top: px(4), right: px(8) }}><T variant="label" color={tokens.color.interactive}>✓</T></View> : null}
              </View>
            ) : null}
            {isFocused ? <View pointerEvents="none" style={[styles.outline, outline()]} /> : null}
          </Animated.View>
        )}
      </SpatialNavigationFocusableView>
    </DefaultFocus>
  )
}
const outline = () => {
  const o = -px(tokens.focus.width + tokens.focus.offset)
  return { top: o, left: o, right: o, bottom: o, borderWidth: px(tokens.focus.width), borderRadius: px(radius + tokens.focus.width + tokens.focus.offset) }
}
const styles = StyleSheet.create({ base: { borderRadius: px(radius) }, outline: { position: 'absolute', borderColor: tokens.color.focus } })
