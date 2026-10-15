import { useEffect, useState } from 'react'
import type { Prefs } from '@described/contracts'
import { tokens } from '../theme/tokens'
import { css, fromArgb, parseColor, readable } from '../theme/colour'
import { platformBindings } from './nowPlaying'

/**
 * The viewer's system caption settings (DESC-035) — on Fire OS, Settings › Accessibility › Captions, read through
 * Android's CaptioningManager by the platform entry (apps/expo/src/platform/captioning.ts) and injected with
 * `configurePlatform({ captioning })`. shared-ui never imports native code; without a binding (Vega today, tests)
 * captions look exactly as before.
 * https://developer.android.com/reference/android/view/accessibility/CaptioningManager
 *
 * Precedence: Caption style "Match Fire TV" (`system`, the default) follows the system style while system captions are
 * on; Box or Shadow chosen in Settings always wins. Caption size in Settings scales the system size (100 % = the
 * viewer's Fire TV size). Captions are on by default (Rich captions) whatever the system says; "off" is only ever a
 * choice made in the app, so it is kept.
 *
 * System colours are the viewer's choice, so they are used as given — not from tokens — but clamped so caption text
 * never falls under `tokens.contrast.min` against its box, over the darkest and the brightest picture.
 */
export type EdgeType = 'none' | 'outline' | 'dropShadow' | 'raised' | 'depressed'
export interface SystemCaptionStyle {
  /** Colours are 0xAARRGGBB as Android gives them (a Kotlin Int may arrive negative); null when the style leaves them unset. */
  foregroundColor: number | null
  /** Behind the text itself. */
  backgroundColor: number | null
  /** Behind the whole caption block. The kit draws one box, so it is used only when the background is clear. */
  windowColor: number | null
  /** The kit draws no text edge yet, so edges are read but not drawn (TODO(kit): a text shadow in CueTheme). */
  edgeType: EdgeType | null
  edgeColor: number | null
  /** An Android font family (serif, monospace, …); null for the system default. */
  typeface: string | null
}
export interface SystemCaptions {
  /** Captions are on in the system settings. */
  enabled: boolean
  /** The system caption size, 1 = normal (Android offers 0.25 to 2). */
  fontScale: number
  /** The preferred caption language (BCP 47), or null. Every Described title has English captions only, so it is informational. */
  locale: string | null
  style: SystemCaptionStyle
}
export interface CaptioningBinding {
  /** The settings now, or null when the platform cannot read them. */
  current(): SystemCaptions | null
  /** Called on every change (the viewer edits Fire TV's caption settings while the app runs). Returns unsubscribe. */
  subscribe(cb: (s: SystemCaptions) => void): () => void
}

/** The live system caption settings for a screen, or null without a binding. */
export function useSystemCaptions(): SystemCaptions | null {
  const binding = platformBindings().captioning
  const [s, setS] = useState<SystemCaptions | null>(() => safe(() => binding?.current() ?? null))
  useEffect(() => {
    if (!binding) return
    setS(safe(() => binding.current())) // a change between the first render and this effect
    return binding.subscribe(setS)
  }, [binding])
  return s
}
const safe = <T,>(f: () => T | null): T | null => { try { return f() } catch { return null } }

/** What CueOverlay takes (a subset of the kit's CueTheme). */
export interface CaptionTheme { fontFamily: string; primaryColor: string; secondaryColor?: string; boxColor: string; userScale: number }

/** The largest caption size, as Settings' 200 %. */
export const MAX_CAPTION_SCALE = 2
/** The smallest: caption text never goes under the type floor. */
export const MIN_CAPTION_SCALE = tokens.type.floor / tokens.type.caption.size
const clampScale = (s: number) => Math.min(MAX_CAPTION_SCALE, Math.max(MIN_CAPTION_SCALE, s))

/** Families Android's Typeface.create knows; anything else (or the default sans) keeps Atkinson Hyperlegible. */
export const SYSTEM_FAMILIES: ReadonlySet<string> = new Set(['serif', 'monospace', 'serif-monospace', 'sans-serif-monospace', 'sans-serif-condensed', 'sans-serif-smallcaps', 'casual', 'cursive'])

/**
 * The cue theme for the Player. Box and Shadow are the app's own looks; `system` follows the viewer's system caption
 * style while system captions are on, and is the Box otherwise (or without a binding).
 */
export function captionTheme(prefs: Pick<Prefs, 'captionScale' | 'captionStyle'>, system: SystemCaptions | null = null): CaptionTheme {
  const app: CaptionTheme = {
    fontFamily: tokens.type.caption.family, primaryColor: tokens.color.text, userScale: prefs.captionScale / 100,
    boxColor: prefs.captionStyle === 'shadow' ? tokens.color.cueShadowBox : tokens.color.cueBox,
  }
  if (prefs.captionStyle !== 'system' || !system?.enabled) return app
  const st = system.style
  const fg = st.foregroundColor === null ? parseColor(tokens.color.text) : fromArgb(st.foregroundColor)
  const bg = st.backgroundColor === null ? null : fromArgb(st.backgroundColor)
  const win = st.windowColor === null ? null : fromArgb(st.windowColor)
  // One box: the text background if it shows, else the window if that shows, else the background (clear: clamped up).
  const box = bg && bg.a > 0 ? bg : win && win.a > 0 ? win : bg ?? parseColor(tokens.color.cueBox)
  const ok = readable(fg, box)
  const fontScale = Number.isFinite(system.fontScale) && system.fontScale > 0 ? system.fontScale : 1
  return {
    fontFamily: st.typeface && SYSTEM_FAMILIES.has(st.typeface) ? st.typeface : tokens.type.caption.family,
    primaryColor: css(ok.fg), secondaryColor: css(ok.fg), boxColor: css(ok.box),
    userScale: clampScale(fontScale * (prefs.captionScale / 100)),
  }
}
