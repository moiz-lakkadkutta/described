import { useEffect, useRef } from 'react'
import type { RemoteKey } from '@moizp/vega-media-kit/platform'

/**
 * The one place raw remote keys go before spatial navigation. configureRemote's single platform subscription calls
 * interceptKey for every key-down; handlers run newest first, and one that returns true consumes the key, so spatial
 * navigation never sees it (Settings: ◄► change a value; Player: ◄► seek, Menu opens the sheet). A handler that
 * returns nothing only observes. Keys the platform hands to another path (the media session's PLAY/PAUSE/STOP,
 * apps/expo setKeySkip) never arrive here.
 */
export type KeyHandler = (key: RemoteKey, repeat: boolean) => boolean | void
const handlers: KeyHandler[] = []
/** Subscribe for as long as you need raw keys; returns the unsubscribe. */
export function subscribeKeys(h: KeyHandler): () => void {
  handlers.unshift(h)
  return () => { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1) }
}
/** Offers a key to the handlers; true when one consumed it. */
export const interceptKey = (key: RemoteKey, repeat = false) => handlers.some((h) => h(key, repeat) === true)
/** subscribeKeys while the component is mounted; always calls the latest `h`. */
export function useKeyHandler(h: KeyHandler) {
  const ref = useRef(h)
  ref.current = h
  useEffect(() => subscribeKeys((k, r) => ref.current(k, r)), [])
}
