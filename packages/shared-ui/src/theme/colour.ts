import { tokens } from './tokens'

/**
 * Colour maths for colours that do not come from tokens: the viewer's system caption colours (DESC-035,
 * platform/captioning.ts). Lives under theme/ because it has to spell colour formats.
 */
export interface Rgba { r: number; g: number; b: number; a: number }
export function fromArgb(argb: number): Rgba {
  const v = argb >>> 0
  return { a: ((v >>> 24) & 0xff) / 255, r: (v >>> 16) & 0xff, g: (v >>> 8) & 0xff, b: v & 0xff }
}
/** '#RRGGBB' or 'rgba(r,g,b,a)' — the forms tokens use. */
export function parseColor(c: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(c)
  if (hex) { const v = parseInt(hex[1]!, 16); return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff, a: 1 } }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(c)
  if (!m) throw new Error(`unknown colour ${c}`)
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) }
}
export const css = (c: Rgba) => `rgba(${c.r},${c.g},${c.b},${Math.round(c.a * 100) / 100})`
/** `top` drawn over the opaque `under`. */
const over = (top: Rgba, under: Rgba): Rgba => ({
  r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1,
})
const lum = (c: Rgba) => {
  const ch = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b)
}
export const contrastRatio = (a: Rgba, b: Rgba) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05) }
/** The picture's extremes: a black frame and a white frame. */
const PICTURE = [parseColor(tokens.color.video), parseColor(tokens.color.pictureBright)]
/** Caption text against its box, over the worst picture behind a see-through box. */
export function captionContrast(fg: Rgba, box: Rgba): number {
  return Math.min(...PICTURE.map((p) => { const under = over(box, p); return contrastRatio(over(fg, under), under) }))
}

/**
 * The viewer's colours, changed as little as needed to reach `tokens.contrast.min`: first the text made opaque, then
 * the box made more opaque (5 % steps), then light or dark token text on the opaque box, and as a last resort the app's
 * own box with the token text.
 */
export function readable(fg: Rgba, box: Rgba): { fg: Rgba; box: Rgba; adjusted: boolean } {
  const min = tokens.contrast.min
  const tries: { fg: Rgba; box: Rgba }[] = [{ fg, box }]
  const solid = { ...fg, a: 1 }
  for (let a = Math.ceil(box.a * 20) / 20; a <= 1.0001; a += 0.05) tries.push({ fg: solid, box: { ...box, a: Math.min(1, a) } })
  const opaque = { ...box, a: 1 }
  const light = parseColor(tokens.color.text), dark = parseColor(tokens.color.ground)
  tries.push({ fg: contrastRatio(light, opaque) >= contrastRatio(dark, opaque) ? light : dark, box: opaque })
  for (const [i, t] of tries.entries()) if (captionContrast(t.fg, t.box) >= min) return { ...t, adjusted: i > 0 }
  const tokenBox = parseColor(tokens.color.cueBox)
  return { fg: captionContrast(solid, tokenBox) >= min ? solid : light, box: tokenBox, adjusted: true }
}
