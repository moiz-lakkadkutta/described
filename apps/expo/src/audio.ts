import { createAudioPlayer, type AudioPlayer } from 'expo-audio'
/**
 * Fire OS audio for Root's `speak`: one clip at a time. Always settles — when the clip ends, is stopped, fails to
 * load, or runs past the cap — so a caller that paused the film for it (DESC-007) always resumes.
 * `prefetch` creates the next clip's player ahead of time (ExoPlayer starts loading it at once); a `speak` of the same
 * URL then plays that player. One prefetched clip at most; `stopSpeaking` and `cancelPrefetch` release it.
 *
 * What expo-audio 1.1.1 reports on Android (AudioPlayer.kt): the player is prepared on creation (`buffering`); a failed
 * load (404, no network) never says `error` — ExoPlayer drops to `idle`, and `onIsLoadingChanged(false)` even sends
 * `isLoaded: true`. So a clip counts as loaded only at `playbackState: 'ready'`, and `idle` is a failure: nothing
 * else puts a prepared player back in `idle` until we remove it.
 */
export const LOAD_TIMEOUT_MS = 8_000
export const MAX_CLIP_MS = 30_000 // samples are ~20 s; extended cues ≤ 25 words, ~10 s
type Status = { playbackState?: string; didJustFinish?: boolean; playing?: boolean }
let player: AudioPlayer | null = null
let done: (() => void) | null = null
let ready: { url: string; player: AudioPlayer; state: string } | null = null
const timers: ReturnType<typeof setTimeout>[] = []

function release(p: AudioPlayer | null | undefined) { try { p?.remove() } catch { /* already released */ } }
const stateOf = (p: AudioPlayer) => { try { return (p.currentStatus as Status | undefined)?.playbackState } catch { return undefined } }
function stopClip() {
  timers.splice(0).forEach(clearTimeout)
  release(player)
  player = null
  const d = done; done = null; d?.()
}
/** Drops the prefetched clip (seek away, Extended mode off, leaving the film). */
export function cancelPrefetch() { release(ready?.player); ready = null }
export function stopSpeaking() {
  cancelPrefetch()
  stopClip()
}
export function prefetch(url: string) {
  if (ready?.url === url) return
  cancelPrefetch()
  try {
    const p = createAudioPlayer({ uri: url })
    const entry = { url, player: p, state: 'buffering' }
    p.addListener('playbackStatusUpdate', (s: Status) => { if (s.playbackState) entry.state = s.playbackState })
    ready = entry
  } catch { /* speak loads it then */ }
}
export function speak(url: string): Promise<void> {
  const pre = ready?.url === url ? ready : null
  if (pre) ready = null
  stopClip()
  return new Promise((resolve) => {
    done = resolve
    // A prefetched clip that already failed (idle) ends at once rather than after the load timeout.
    const preState = pre ? (stateOf(pre.player) ?? pre.state) : undefined
    if (pre && preState === 'idle') { release(pre.player); stopClip(); return }
    let loaded = preState === 'ready'
    try {
      const p = pre?.player ?? createAudioPlayer({ uri: url })
      player = p
      p.addListener('playbackStatusUpdate', (s: Status) => {
        if (player !== p) return
        if (s.playbackState === 'ready' || s.playing) loaded = true
        if (s.didJustFinish || s.playbackState === 'ended' || s.playbackState === 'idle' || s.playbackState === 'error') stopClip()
      })
      p.play()
    } catch { stopClip(); return }
    timers.push(setTimeout(() => { if (!loaded) stopClip() }, LOAD_TIMEOUT_MS), setTimeout(stopClip, MAX_CLIP_MS))
  })
}
