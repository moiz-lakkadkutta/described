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
  return {
    down(code: number) { const repeat = held.has(code); held.add(code); listeners.forEach((l) => l(code, repeat)) },
    up(code: number) { held.delete(code) },
    subscribe(l: KeyListener) { listeners.add(l); return () => { listeners.delete(l) } },
  }
}
