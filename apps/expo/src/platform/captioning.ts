import type { CaptioningBinding, EdgeType, SystemCaptions } from '@described/shared-ui'

/**
 * Fire OS caption settings binding (DESC-035) over the local native module `DescribedCaptioning`
 * (modules/described-captioning), which reads Android's CaptioningManager — what the viewer set in Fire TV
 * Settings › Accessibility › Captions. https://developer.android.com/reference/android/view/accessibility/CaptioningManager
 *
 * The native side sends plain values; everything that needs judgement (precedence, contrast, size limits) is in
 * shared-ui's platform/captioning.ts.
 */
export interface NativeCaptioningState {
  enabled: boolean
  fontScale: number
  /** Locale.toLanguageTag(), absent when the system has none. */
  locale?: string
  /** 0xAARRGGBB as a signed 32-bit Int; absent when CaptionStyle.hasXxxColor() is false. */
  foregroundColor?: number
  backgroundColor?: number
  windowColor?: number
  /** CaptionStyle.EDGE_TYPE_*: -1 unspecified, 0 none, 1 outline, 2 drop shadow, 3 raised, 4 depressed. */
  edgeType?: number
  edgeColor?: number
  /** The Android family the style's Typeface matches (serif, monospace, …); absent for the default. */
  typeface?: string
}
export interface NativeCaptioning {
  /** The settings now (CaptioningManager.isEnabled, getFontScale, getLocale, getUserStyle). */
  get(): NativeCaptioningState
  /** CaptioningManager.CaptioningChangeListener: every change, with the full state. */
  addListener(event: 'onCaptioningChange', listener: (e: NativeCaptioningState) => void): { remove(): void }
}

const EDGES: Record<number, EdgeType> = { 0: 'none', 1: 'outline', 2: 'dropShadow', 3: 'raised', 4: 'depressed' }
const colour = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null)

/** One native state → shared-ui's SystemCaptions; anything malformed reads as "unset". */
export function fromNative(e: NativeCaptioningState): SystemCaptions {
  return {
    enabled: e.enabled === true,
    fontScale: typeof e.fontScale === 'number' && Number.isFinite(e.fontScale) && e.fontScale > 0 ? e.fontScale : 1,
    locale: typeof e.locale === 'string' && e.locale ? e.locale : null,
    style: {
      foregroundColor: colour(e.foregroundColor), backgroundColor: colour(e.backgroundColor), windowColor: colour(e.windowColor),
      edgeType: (typeof e.edgeType === 'number' && EDGES[e.edgeType]) || null, edgeColor: colour(e.edgeColor),
      typeface: typeof e.typeface === 'string' && e.typeface ? e.typeface : null,
    },
  }
}

/** The shared-ui binding, or undefined when the module is not in the build (captions then keep the app's look). */
export function createCaptioning(native: NativeCaptioning | null): CaptioningBinding | undefined {
  if (!native) return undefined
  return {
    current: () => { try { return fromNative(native.get()) } catch { return null } },
    subscribe: (cb) => {
      const sub = native.addListener('onCaptioningChange', (e) => cb(fromNative(e)))
      return () => sub.remove()
    },
  }
}
