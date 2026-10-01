// Host-string stand-ins for the react-native surface shared-ui uses; enough for react-test-renderer.
const host = (name: string) => name as unknown as React.ComponentType<Record<string, unknown>>
export const View = host('View'), Text = host('Text'), Image = host('Image'), ScrollView = host('ScrollView')
class Value { constructor(public v: number) {} interpolate() { return this } }
const anim = () => ({ start() {}, stop() {} })
export const Animated = { View: host('Animated.View'), Value, timing: anim, loop: anim, sequence: anim, delay: anim }
export const StyleSheet = { create: <T,>(s: T) => s, absoluteFill: {} }
export const Dimensions = { get: () => ({ width: 1920, height: 1080 }) }
export const PixelRatio = { roundToNearestPixel: (n: number) => n }
export const Platform = { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default }
export const AccessibilityInfo = { isScreenReaderEnabled: async () => false, addEventListener: () => ({ remove() {} }), announceForAccessibility: () => {} }
export const BackHandler = { addEventListener: () => ({ remove() {} }) }
export type ViewStyle = Record<string, unknown>
export type TextProps = Record<string, unknown>
