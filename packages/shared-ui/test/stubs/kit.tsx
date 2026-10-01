import React, { forwardRef, useImperativeHandle } from 'react'
// The kit's root entry as Player uses it. KitPlayer renders a 'KitPlayer' host with its props and hands Player a ref
// of mocks (`kit.ref`); tests drive it through the props (onTracks, onState, onPosition, onCue, onError).
export { parseHlsMaster } from '@moizp/vega-media-kit/core'
const mocks = () => ({
  play: vi.fn(), pause: vi.fn(), seek: vi.fn(), setRate: vi.fn(), selectAudio: vi.fn(), selectText: vi.fn(),
  getPosition: vi.fn((): number | undefined => undefined), getTracks: vi.fn(),
})
export const kit = { ref: mocks(), mounts: 0, reset() { this.ref = mocks(); this.mounts = 0 } }
export const KitPlayer = forwardRef<unknown, Record<string, unknown>>(function KitPlayer(props, ref) {
  useImperativeHandle(ref, () => kit.ref, [])
  React.useEffect(() => { kit.mounts++ }, [])
  return React.createElement('KitPlayer', props)
})
export const CueOverlay = 'CueOverlay' as unknown as React.ComponentType<Record<string, unknown>>
export type { Cue, PlayerError, PlayerState, Tracks, AudioTrack, TextTrack, HlsRendition } from '@moizp/vega-media-kit/core'
export type { KitPlayerRef } from '@moizp/vega-media-kit/player'
