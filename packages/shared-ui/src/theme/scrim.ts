import { tokens } from './tokens'
const rgba = (s: string) => s.match(/[\d.]+/g)!.map(Number) as [number, number, number, number]
/** Hero scrim as `n` stacked bands from tokens.color.scrimTop → scrimBottom (no gradient library on both platforms). */
export function scrimBands(n = 8): string[] {
  const a = rgba(tokens.color.scrimTop), b = rgba(tokens.color.scrimBottom)
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n
    const c = a.map((v, k) => v + (b[k]! - v) * t)
    return `rgba(${c.slice(0, 3).map(Math.round).join(',')},${c[3]!.toFixed(3)})`
  })
}
