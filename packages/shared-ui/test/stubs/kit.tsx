// The kit's root entry as Player uses it: host stand-ins only.
export const KitPlayer = 'KitPlayer' as unknown as React.ComponentType<Record<string, unknown>>
export const CueOverlay = 'CueOverlay' as unknown as React.ComponentType<Record<string, unknown>>
export type Cue = { id: string; meta?: Record<string, string> }
export type KitPlayerRef = { play(): void; pause(): void; selectAudio(id: string): void; selectText(ids: string[]): void }
export type PlayerState = string
