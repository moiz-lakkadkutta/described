/** Described design tokens — see docs/PLAN.md §6. Sizes are px at 1920×1080; multiply by scale. */
export type TypeRole = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption'
export const tokens = {
  color: {
    ground: '#0D1215', surface1: '#161D21', surface2: '#202A2F',
    text: '#ECEEEA', textSecondary: '#A9B4B2',
    interactive: '#4FA79F',      // persistent selected / active
    badge: '#D9A441',            // the one warm note: audio description present / speaking
    focus: '#ECEEEA',            // physical outline, never a hue
    error: '#E07A6C',
    scrimTop: 'rgba(13,18,21,0)', scrimBottom: 'rgba(13,18,21,0.92)',
    cueBox: 'rgba(0,0,0,0.65)',
  },
  type: {
    floor: 28,
    display: { family: 'AtkinsonHyperlegible-Bold', weight: '700', size: 64, line: 72, tracking: -0.01 },
    title:   { family: 'AtkinsonHyperlegible-Bold', weight: '700', size: 48, line: 56 },
    heading: { family: 'AtkinsonHyperlegible-Bold', weight: '700', size: 36, line: 44 },
    body:    { family: 'AtkinsonHyperlegible-Regular', weight: '400', size: 32, line: 44 },
    label:   { family: 'AtkinsonHyperlegible-Bold', weight: '700', size: 28, line: 36, tracking: 0.02 },
    caption: { family: 'AtkinsonHyperlegible-Regular', weight: '400', size: 44, line: 57 }, // overlay
  } as Record<TypeRole, { family: string; weight: '400' | '700'; size: number; line: number; tracking?: number; tabular?: boolean }> & { floor: number },
  layout: { safeX: 96, safeY: 54, rail: 96, railExpanded: 336, cardW: 412, cardH: 232, gutter: 24, heroH: 560 },
  focus: { width: 4, offset: 3 },
  motion: { focusMs: 150, focusScale: 1.04, overlayHideMs: 4000, crossfadeMs: 300 },
} as const
