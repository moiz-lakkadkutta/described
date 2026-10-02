import React, { forwardRef, useImperativeHandle } from 'react'
// The kit's root entry as Player uses it. KitPlayer renders a 'KitPlayer' host with its props and hands Player a ref
// of mocks (`kit.ref`); tests drive it through the props (onTracks, onState, onPosition, onCue, onError).
export { parseHlsMaster, parseVtt } from '@moizp/vega-media-kit/core'
// The kit's fetchHlsVtt over the test's global fetch (a whole-file VTT; tests serve it by URL).
export const fetchHlsVtt = async (url: string) => (await fetch(url)).text()
// Like the kit's Fire OS adapter, getPosition is the last position reported through onPosition (it does not move
// when a seek is sent).
const mocks = () => ({
  play: vi.fn(), pause: vi.fn(), seek: vi.fn(), setRate: vi.fn(), selectAudio: vi.fn(), selectText: vi.fn(),
  getPosition: vi.fn((): number | undefined => kit.position), getTracks: vi.fn(),
})
export const kit = { ref: mocks(), mounts: 0, position: 0, reset() { this.ref = mocks(); this.mounts = 0; this.position = 0 } }
export const KitPlayer = forwardRef<unknown, Record<string, unknown>>(function KitPlayer(props, ref) {
  useImperativeHandle(ref, () => kit.ref, [])
  React.useEffect(() => { kit.mounts++ }, [])
  const onPosition = props.onPosition as ((s: number) => void) | undefined
  return React.createElement('KitPlayer', { ...props, onPosition: (s: number) => { kit.position = s; onPosition?.(s) } })
})
export const CueOverlay = 'CueOverlay' as unknown as React.ComponentType<Record<string, unknown>>
export type { Cue, PlayerError, PlayerState, Tracks, AudioTrack, TextTrack, HlsRendition } from '@moizp/vega-media-kit/core'
export type { KitPlayerRef } from '@moizp/vega-media-kit/player'
