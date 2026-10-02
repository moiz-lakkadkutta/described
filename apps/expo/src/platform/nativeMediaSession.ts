import { requireOptionalNativeModule } from 'expo'
import type { NativeMediaSession } from './mediaSession'
/** Null when the module was left out of the build (expo.autolinking.exclude) — the binding is then a no-op. */
export const nativeMediaSession = requireOptionalNativeModule<NativeMediaSession>('DescribedMediaSession')
