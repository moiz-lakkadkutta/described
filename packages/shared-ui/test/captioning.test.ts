import { CaptionStyle, Prefs } from '@described/contracts'
import { captionTheme, MAX_CAPTION_SCALE, MIN_CAPTION_SCALE, type SystemCaptions, type SystemCaptionStyle } from '../src/platform/captioning'
import { captionContrast, contrastRatio, fromArgb, parseColor, readable } from '../src/theme/colour'
import { tokens } from '../src/theme/tokens'

// DESC-035: the viewer's Fire TV caption settings (CaptioningManager) onto the Player's cue theme.
const style = (s: Partial<SystemCaptionStyle> = {}): SystemCaptionStyle =>
  ({ foregroundColor: null, backgroundColor: null, windowColor: null, edgeType: null, edgeColor: null, typeface: null, ...s })
const sys = (s: Partial<SystemCaptionStyle> = {}, o: Partial<SystemCaptions> = {}): SystemCaptions =>
  ({ enabled: true, fontScale: 1, locale: 'en-US', style: style(s), ...o })
const follow = { captionScale: 100, captionStyle: 'system' } as const
// Android ARGB as a Kotlin Int: 0xFF000000 and up arrive negative.
const argb = (hex: number) => hex | 0
const YELLOW = argb(0xffffff00), BLACK = argb(0xff000000), WHITE = argb(0xffffffff), BLUE = argb(0xff0000ff)
const appBox = { fontFamily: tokens.type.caption.family, primaryColor: tokens.color.text, boxColor: tokens.color.cueBox, userScale: 1 }

describe('colour helpers', () => {
  it('reads Android ARGB ints, negative ones included', () => {
    expect(fromArgb(YELLOW)).toEqual({ a: 1, r: 255, g: 255, b: 0 })
    expect(fromArgb(argb(0x80102030))).toEqual({ a: 128 / 255, r: 16, g: 32, b: 48 })
    expect(fromArgb(0x000000ff).a).toBe(0) // CaptionStyle's "none" colour: clear
  })
  it('reads the token forms', () => {
    expect(parseColor('#0D1215')).toEqual({ r: 13, g: 18, b: 21, a: 1 })
    expect(parseColor(tokens.color.cueBox)).toEqual({ r: 0, g: 0, b: 0, a: 0.65 })
    expect(() => parseColor('teal')).toThrow()
  })
  it('contrast ratio: white on black is 21', () => {
    expect(contrastRatio(fromArgb(WHITE), fromArgb(BLACK))).toBeCloseTo(21, 5)
  })
  it("the app's own Box passes the floor over the brightest picture", () => {
    expect(captionContrast(parseColor(tokens.color.text), parseColor(tokens.color.cueBox))).toBeGreaterThanOrEqual(tokens.contrast.min)
  })
})

describe('precedence', () => {
  it('Box and Shadow chosen in Settings win over the system style', () => {
    const s = sys({ foregroundColor: YELLOW, backgroundColor: BLUE, typeface: 'serif' }, { fontScale: 2 })
    expect(captionTheme({ captionScale: 150, captionStyle: 'box' }, s)).toEqual({ ...appBox, userScale: 1.5 })
    expect(captionTheme({ captionScale: 100, captionStyle: 'shadow' }, s)).toEqual({ ...appBox, boxColor: tokens.color.cueShadowBox })
  })
  it('Match Fire TV with system captions off: the Box', () => {
    expect(captionTheme(follow, sys({ foregroundColor: YELLOW }, { enabled: false }))).toEqual(appBox)
  })
  it('Match Fire TV without a binding (Vega, tests): the Box', () => {
    expect(captionTheme(follow, null)).toEqual(appBox)
    expect(captionTheme(follow)).toEqual(appBox)
  })
  it('Match Fire TV with system captions on: the system style', () => {
    const t = captionTheme(follow, sys({ foregroundColor: YELLOW, backgroundColor: BLACK, typeface: 'serif' }))
    expect(t).toEqual({ fontFamily: 'serif', primaryColor: 'rgba(255,255,0,1)', secondaryColor: 'rgba(255,255,0,1)', boxColor: 'rgba(0,0,0,1)', userScale: 1 })
  })
  it('Match Fire TV is the default for new profiles and the first value Settings offers', () => {
    expect(CaptionStyle.options[0]).toBe('system')
    expect(Prefs.shape.captionStyle.parse('system')).toBe('system')
  })
})

describe('size', () => {
  it('the system size, times the size chosen in Settings', () => {
    expect(captionTheme(follow, sys({}, { fontScale: 1.5 })).userScale).toBe(1.5)
    expect(captionTheme({ captionScale: 125, captionStyle: 'system' }, sys({}, { fontScale: 1.5 })).userScale).toBeCloseTo(1.875)
  })
  it('never above 200 % nor under the type floor', () => {
    expect(captionTheme({ captionScale: 200, captionStyle: 'system' }, sys({}, { fontScale: 2 })).userScale).toBe(MAX_CAPTION_SCALE)
    const small = captionTheme(follow, sys({}, { fontScale: 0.25 })).userScale
    expect(small).toBe(MIN_CAPTION_SCALE)
    expect(small * tokens.type.caption.size).toBe(tokens.type.floor)
  })
  it('a nonsense scale counts as 1', () => {
    expect(captionTheme(follow, sys({}, { fontScale: Number.NaN })).userScale).toBe(1)
    expect(captionTheme(follow, sys({}, { fontScale: 0 })).userScale).toBe(1)
  })
})

describe('typeface', () => {
  it.each([['serif', 'serif'], ['monospace', 'monospace'], ['casual', 'casual'], ['sans-serif', tokens.type.caption.family], [null, tokens.type.caption.family], ['comic-papyrus', tokens.type.caption.family]])('%s → %s', (face, family) => {
    expect(captionTheme(follow, sys({ typeface: face })).fontFamily).toBe(family)
  })
})

describe('colours and the box', () => {
  it('unset colours: token text on the token box', () => {
    expect(captionTheme(follow, sys())).toMatchObject({ primaryColor: 'rgba(236,238,234,1)', boxColor: 'rgba(0,0,0,0.65)' })
  })
  it('a clear background uses the window colour', () => {
    const t = captionTheme(follow, sys({ foregroundColor: WHITE, backgroundColor: argb(0x00000000), windowColor: BLUE }))
    expect(t.boxColor).toBe('rgba(0,0,255,1)')
  })
  it('edges are read but not drawn (the kit has no text shadow): the box stays', () => {
    const t = captionTheme(follow, sys({ foregroundColor: WHITE, backgroundColor: argb(0x00000000), edgeType: 'dropShadow', edgeColor: BLACK }))
    expect(fromArgb(0).a).toBe(0)
    expect(captionContrast(parseColor(t.primaryColor), parseColor(t.boxColor))).toBeGreaterThanOrEqual(tokens.contrast.min)
  })
})

describe('contrast clamp (tokens.contrast.min)', () => {
  const check = (fg: number, bg: number) => {
    const t = captionTheme(follow, sys({ foregroundColor: fg, backgroundColor: bg }))
    return { t, c: captionContrast(parseColor(t.primaryColor), parseColor(t.boxColor)) }
  }
  it('readable colours are kept as the viewer set them', () => {
    expect(readable(fromArgb(YELLOW), fromArgb(BLACK)).adjusted).toBe(false)
    expect(check(YELLOW, BLUE).t).toMatchObject({ primaryColor: 'rgba(255,255,0,1)', boxColor: 'rgba(0,0,255,1)' })
  })
  it('see-through text is made opaque first', () => {
    const r = readable(fromArgb(argb(0x40ffffff)), fromArgb(BLACK))
    expect(r).toMatchObject({ adjusted: true, fg: { a: 1 }, box: { a: 1 } })
  })
  it('a faint box is made just opaque enough', () => {
    const r = readable(fromArgb(WHITE), fromArgb(argb(0x20000000)))
    expect(r.box.a).toBeGreaterThan(0.2)
    expect(r.box.a).toBeLessThan(1)
    expect(captionContrast(r.fg, { ...r.box, a: r.box.a - 0.05 })).toBeLessThan(tokens.contrast.min) // one step less fails
  })
  it('white on white: dark token text on the white box', () => {
    const { t, c } = check(WHITE, WHITE)
    expect(t.primaryColor).toBe('rgba(13,18,21,1)')
    expect(c).toBeGreaterThanOrEqual(tokens.contrast.min)
  })
  it('mid grey on mid grey (neither token text reaches the floor): the app box', () => {
    const grey = argb(0xff767676)
    const { t, c } = check(grey, grey)
    expect(t.boxColor).toBe('rgba(0,0,0,0.65)')
    expect(c).toBeGreaterThanOrEqual(tokens.contrast.min)
  })
  it.each([
    [YELLOW, WHITE], [BLUE, BLACK], [argb(0xffff0000), argb(0xff00ff00)], [argb(0x10ffffff), argb(0x00000000)],
    [argb(0xff00ffff), argb(0x80ffffff)], [argb(0xff808080), argb(0xff7f7f7f)], [BLACK, argb(0x00ffffff)],
  ])('%s on %s always ends readable', (fg, bg) => {
    expect(check(fg, bg).c).toBeGreaterThanOrEqual(tokens.contrast.min)
  })
})
