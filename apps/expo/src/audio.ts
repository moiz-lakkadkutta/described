import { createAudioPlayer, type AudioPlayer } from 'expo-audio'
/** Fire OS audio for Root's `speak`: one clip at a time; resolves when it ends or is stopped. */
let player: AudioPlayer | null = null
let done: (() => void) | null = null
export function stopSpeaking() {
  player?.remove(); player = null
  const d = done; done = null; d?.()
}
export function speak(url: string): Promise<void> {
  stopSpeaking()
  return new Promise((resolve) => {
    const p = createAudioPlayer({ uri: url })
    player = p; done = resolve
    p.addListener('playbackStatusUpdate', (s) => { if (s.didJustFinish && player === p) stopSpeaking() })
    p.play()
  })
}
