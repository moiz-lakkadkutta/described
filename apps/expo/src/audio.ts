import { createAudioPlayer, type AudioPlayer } from 'expo-audio'
/**
 * Fire OS audio for Root's `speak`: one clip at a time. Always settles — when the clip ends, is stopped, fails to
 * load, or runs past the cap — so a caller that paused the film for it (DESC-007) always resumes.
 */
export const LOAD_TIMEOUT_MS = 8_000
export const MAX_CLIP_MS = 30_000 // samples are ~20 s
let player: AudioPlayer | null = null
let done: (() => void) | null = null
const timers: ReturnType<typeof setTimeout>[] = []

export function stopSpeaking() {
  timers.splice(0).forEach(clearTimeout)
  try { player?.remove() } catch { /* already released */ }
  player = null
  const d = done; done = null; d?.()
}
export function speak(url: string): Promise<void> {
  stopSpeaking()
  return new Promise((resolve) => {
    done = resolve
    let loaded = false
    try {
      const p = createAudioPlayer({ uri: url })
      player = p
      p.addListener('playbackStatusUpdate', (s) => {
        if (player !== p) return
        if (s.isLoaded) loaded = true
        if (s.didJustFinish || s.playbackState === 'error') stopSpeaking()
      })
      p.play()
    } catch { stopSpeaking(); return }
    timers.push(setTimeout(() => { if (!loaded) stopSpeaking() }, LOAD_TIMEOUT_MS), setTimeout(stopSpeaking, MAX_CLIP_MS))
  })
}
