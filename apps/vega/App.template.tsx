import React from 'react'
import { Root, configureRemote } from '@described/shared-ui'
import type { KeySource } from '@described/shared-ui'
import { mapKey } from '@moizp/vega-media-kit/platform'
// Vega's TVEventHandler is exported by the Kepler package, not react-native:
// https://developer.amazon.com/docs/react-native-vega/0.72/using_tveventhandler.html
// manifest.toml needs `[[wants.service]] id = "com.amazon.inputd.service"` for remote button events.
import { TVEventHandler } from '@amazon-devices/react-native-kepler'

type TVEvent = { eventType: string; eventKeyAction?: number } // 0 = pressed (repeats while held), 1 = released

/**
 * Vega key source, same shape as apps/expo/src/remote.ts: one permanent module-level handler feeds every subscriber,
 * so held-key state survives a screen change. A held button sends eventKeyAction 0 repeatedly and a single 1 on
 * release; the second and later 0s are `repeat`. eventType names (playpause, skip_backward, …) map through the kit's mapKey.
 */
const held = new Set<string>()
const subscribers = new Set<Parameters<KeySource>[0]>()
const handler = new TVEventHandler()
handler.enable(null, (_: unknown, evt: TVEvent) => {
  if (!evt?.eventType) return
  if (evt.eventKeyAction === 1) { held.delete(evt.eventType); return }
  const repeat = held.has(evt.eventType); held.add(evt.eventType)
  const k = mapKey(evt.eventType)
  if (k) for (const s of [...subscribers]) s(k, repeat)
})
const keySource: KeySource = (onKey) => { subscribers.add(onKey); return () => { subscribers.delete(onKey) } }

configureRemote(keySource)
// Vega entry. Sizes are px at 1080p → scale 1.
export default function App() { return <Root apiBaseUrl={'https://api.described.example'} scale={1} /> }
