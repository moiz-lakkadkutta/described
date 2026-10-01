import { tokens } from './theme/tokens'
/** Home/Title geometry in px at 1920×1080 (multiply by scale). Pure, so the skeleton-vs-loaded rule is testable. */
const L = tokens.layout
/** A row shows 3 cards + gutters + a 40 px peek of the fourth. */
export const rowViewportW = L.cardsVisible * (L.cardW + L.gutter) + L.peek
/** Skeleton fills exactly what a loaded row shows: 3 cards and the peek. */
export const skeletonCount = L.cardsVisible + 1
/** Card box: 16:9 image, then a body line (title) and a label line (meta) — both always rendered so heights never change. */
export const cardBox = { w: L.cardW, h: L.cardH + 10 + tokens.type.body.line + tokens.type.label.line }
/** Room kept around every focusable for the outline (4 px + 3 px offset) and 1.04 growth, so focus never clips. */
export const focusBleed = (w: number) => Math.ceil(tokens.focus.width + tokens.focus.offset + (w * (tokens.motion.focusScale - 1)) / 2)
export const rowPad = focusBleed(L.cardW)

export interface Slot { id: string; skeleton: boolean; w: number; h: number }
/** Card slots for a row: the items when loaded, `skeletonCount` placeholders while loading. Same box either way. */
export function rowSlots(group: string, slugs: readonly string[] | null): Slot[] {
  return slugs === null
    ? Array.from({ length: skeletonCount }, (_, i) => ({ id: `${group}:skeleton-${i}`, skeleton: true, w: cardBox.w, h: cardBox.h }))
    : slugs.map((s) => ({ id: `${group}:${s}`, skeleton: false, w: cardBox.w, h: cardBox.h }))
}
