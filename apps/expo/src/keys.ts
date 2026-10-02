/**
 * One hub for the whole app: fed by permanent key-down/up listeners, it marks key-downs that arrive while the key is
 * still held (Android auto-repeat) and hands each key to the current subscribers. Held state outlives subscriptions,
 * so a Select held while one screen's navigator unsubscribes is still a repeat for the next screen's.
 * No react-native import: unit-tested.
 */
export type KeyListener = (code: number, repeat: boolean) => void
export function createKeyHub() {
  const held = new Set<number>()
  const listeners = new Set<KeyListener>()
  // Codes another path owns right now (DESC-008: the active media session's PLAY / PAUSE / STOP). Held state is still
  // tracked, so repeats stay right if ownership changes mid-press; no subscriber ever sees a skipped code.
  let skip: (code: number) => boolean = () => false
  return {
    down(code: number) { const repeat = held.has(code); held.add(code); if (skip(code)) return; listeners.forEach((l) => l(code, repeat)) },
    up(code: number) { held.delete(code) },
    subscribe(l: KeyListener) { listeners.add(l); return () => { listeners.delete(l) } },
    setSkip(f: (code: number) => boolean) { skip = f },
  }
}
