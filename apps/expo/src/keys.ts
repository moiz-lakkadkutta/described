/** Marks key-downs that arrive while the same key is still held (Android auto-repeat). No react-native import: unit-tested. */
export function createRepeatTracker() {
  const held = new Set<number>()
  return {
    down(code: number): boolean { const repeat = held.has(code); held.add(code); return repeat },
    up(code: number) { held.delete(code) },
  }
}
