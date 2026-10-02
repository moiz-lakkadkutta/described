/**
 * Restore rule for useFocusMemory: the remembered element if it is still on screen, else the screen's default.
 * Ids are `<group>:<key>` (e.g. `newly:sintel`, `hero:playAd`), so a title that left the catalog falls back cleanly.
 */
export function pickInitialFocus(remembered: string | undefined, available: readonly string[], fallback: string): string {
  return remembered && available.includes(remembered) ? remembered : fallback
}
