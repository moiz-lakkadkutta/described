import { useEffect, useRef } from 'react'
import type { RemoteKey } from '@moizp/vega-media-kit/platform'

/**
 * Keys a screen takes before spatial navigation sees them — Settings uses ◄► to change the focused value instead of
 * moving focus. Newest handler first; a handler returns true to consume the key. configureRemote calls interceptKey.
 */
export type KeyHandler = (key: RemoteKey, repeat: boolean) => boolean
const handlers: KeyHandler[] = []
export function addKeyHandler(h: KeyHandler): () => void {
  handlers.unshift(h)
  return () => { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1) }
}
export const interceptKey = (key: RemoteKey, repeat = false) => handlers.some((h) => h(key, repeat))
/** Registers `h` while the component is mounted; always calls the latest `h`. */
export function useKeyHandler(h: KeyHandler) {
  const ref = useRef(h)
  ref.current = h
  useEffect(() => addKeyHandler((k, r) => ref.current(k, r)), [])
}
