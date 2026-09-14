import { Dimensions, PixelRatio, Platform } from 'react-native'
/** All sizes in tokens are px at 1920×1080. Fire OS renders at 960×540 dp (→ 0.5); Vega at 1080p (→ 1). */
export function uiScale(): number {
  const { width } = Dimensions.get('window')
  if ((Platform.OS as string) === 'vega' || (Platform.OS as string) === 'kepler') return width / 1920
  return width / 1920 // Fire OS: window width is ~960 dp → 0.5
}
export const px = (n: number) => PixelRatio.roundToNearestPixel(n * uiScale())
