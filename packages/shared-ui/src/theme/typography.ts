import { tokens, type TypeRole } from './tokens'
/**
 * Text style for a type role, with no react-native import so it is unit-testable.
 * Loaded: the named Atkinson face carries the weight (no fontWeight — Android would fake-bold a Bold face).
 * Not loaded: system sans at the same size, line height and tracking, weight from the token.
 */
export function textStyle(variant: TypeRole, fontsLoaded: boolean, scale: number) {
  const t = tokens.type[variant]
  const size = t.size * scale
  return {
    fontFamily: fontsLoaded ? t.family : undefined,
    fontWeight: fontsLoaded ? undefined : t.weight,
    fontSize: size, lineHeight: t.line * scale, letterSpacing: t.tracking ? size * t.tracking : 0,
    fontVariant: t.tabular ? ['tabular-nums' as const] : undefined,
  }
}
