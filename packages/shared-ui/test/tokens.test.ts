import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { tokens } from '../src/theme/tokens'
// WCAG relative luminance contrast — keeps the palette honest as it evolves.
function lum(hex: string) {
  const [r, g, b] = hex.replace('#', '').match(/.{2}/g)!.map((h) => parseInt(h, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05) }
describe('palette contrast', () => {
  it('body text ≥ 7:1 on ground (AAA) — we target far higher for TV', () => { expect(contrast(tokens.color.text, tokens.color.ground)).toBeGreaterThanOrEqual(7) })
  it('secondary text ≥ 4.5:1 on ground', () => { expect(contrast(tokens.color.textSecondary, tokens.color.ground)).toBeGreaterThanOrEqual(tokens.contrast.min) })
  it('the contrast floor is WCAG AA', () => { expect(tokens.contrast.min).toBe(4.5) })
  it('interactive and badge ≥ 3:1 on ground (non-text contrast)', () => {
    expect(contrast(tokens.color.interactive, tokens.color.ground)).toBeGreaterThanOrEqual(3)
    expect(contrast(tokens.color.badge, tokens.color.ground)).toBeGreaterThanOrEqual(3)
  })
  it('focus outline ≥ 3:1 against cards', () => { expect(contrast(tokens.color.focus, tokens.color.surface2)).toBeGreaterThanOrEqual(3) })
  // pictureBright is a measuring point, never drawn: the white frame caption contrast is checked over (DESC-035).
  it('no pure white anywhere', () => { for (const [k, v] of Object.entries(tokens.color)) if (k !== 'pictureBright') expect(v.toLowerCase()).not.toBe('#ffffff') })
  it('pictureBright is only used by the contrast clamp, never drawn', () => {
    const src = path.resolve(__dirname, '../src')
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
    const users = walk(src).filter((f) => readFileSync(f, 'utf8').includes('pictureBright')).map((f) => path.relative(src, f))
    expect(users.sort()).toEqual([path.join('theme', 'colour.ts'), path.join('theme', 'tokens.ts')])
  })
  it('type floor respected', () => { for (const [k, t] of Object.entries(tokens.type)) if (k !== 'count' && typeof t === 'object') expect(t.size).toBeGreaterThanOrEqual(tokens.type.floor) })
})
