import { getAndroidId } from 'expo-application'
/**
 * Stable per-install profile id for the API's `x-device-id`. Android ID is per device, user and signing key, so it
 * survives app restarts and updates. Kept here: platform identity never goes into shared-ui.
 */
export function deviceId(): string {
  try { const id = getAndroidId(); if (id) return `fireos-${id}` } catch { /* not Android */ }
  return 'dev-device'
}
