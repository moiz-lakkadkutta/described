import { createAudioPlayer, type AudioPlayer } from 'expo-audio'
/**
 * Fire OS audio for Root's `speak`: one clip at a time. Always settles — when the clip ends, is stopped, fails to
 * load, or runs past the cap — so a caller that paused the film for it (DESC-007) always resumes.
 * `prefetch` creates the next clip's player ahead of time (ExoPlayer starts loading it at once); a `speak` of the same
 * URL then plays that player. One prefetched clip at most; `stopSpeaking` releases it too.
 */
export const LOAD_TIMEOUT_MS = 8_000
export const MAX_CLIP_MS = 30_000 // samples are ~20 s; extended cues ≤ 25 words, ~10 s
let player: AudioPlayer | null = null
let done: (() => void) | null = null
let ready: { url: string; player: AudioPlayer } | null = null
const timers: ReturnType<typeof setTimeout>[] = []

function release(p: AudioPlayer | null | undefined) { try { p?.remove() } catch { /* already released */ } }
function stopClip() {
  timers.splice(0).forEach(clearTimeout)
  release(player)
  player = null
  const d = done; done = null; d?.()
}
export function stopSpeaking() {
  release(ready?.player); ready = null
  stopClip()
}
export function prefetch(url: string) {
  if (ready?.url === url) return
  release(ready?.player); ready = null
  try { ready = { url, player: createAudioPlayer({ uri: url }) } } catch { /* speak loads it then */ }
}
export function speak(url: string): Promise<void> {
  const pre = ready?.url === url ? ready.player : null
  if (pre) ready = null
  stopClip()
  return new Promise((resolve) => {
    done = resolve
    let loaded = false
    try {
      const p = pre ?? createAudioPlayer({ uri: url })
      player = p
      loaded = !!pre?.isLoaded // a prefetched clip may have loaded before this listener existed
      p.addListener('playbackStatusUpdate', (s) => {
        if (player !== p) return
        if (s.isLoaded) loaded = true
        if (s.didJustFinish || s.playbackState === 'error') stopClip()
      })
      p.play()
    } catch { stopClip(); return }
    timers.push(setTimeout(() => { if (!loaded) stopClip() }, LOAD_TIMEOUT_MS), setTimeout(stopClip, MAX_CLIP_MS))
  })
}
