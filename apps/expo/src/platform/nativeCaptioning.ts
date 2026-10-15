import { requireOptionalNativeModule } from 'expo'
import type { NativeCaptioning } from './captioning'
/** Null when the module was left out of the build (expo.autolinking.exclude) — captions then keep the app's look. */
export const nativeCaptioning = requireOptionalNativeModule<NativeCaptioning>('DescribedCaptioning')
