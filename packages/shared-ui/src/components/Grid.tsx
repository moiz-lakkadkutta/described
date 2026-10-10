import React, { useCallback, useEffect } from 'react'
import { View } from 'react-native'
import { SpatialNavigationNode, SpatialNavigationScrollView } from 'react-tv-space-navigation'
import { FocusRow, useFocusMemory } from '@moizp/vega-media-kit/focus'
import type { CatalogItem } from '@described/contracts'
import { Card, SkeletonCard } from './Card'
import { T } from './Text'
import { pickInitialFocus } from '../focus/memory'
import { announceFocus, setFocusContext } from '../a11y'
import { gridModel } from '../models'
import { rowPad, rowPadY } from '../layout'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'

const L = tokens.layout
/**
 * A titled grid of cards, 3 per row (Described, My list). A vertical node of horizontal rows with `alignInGrid`, so ▲▼
 * keep the column. Focus memory per `memoryKey`: the remembered card if it is still here, else the first. The heading is
 * said once when focus enters the grid. `items`: null while the catalog loads (one skeleton row, nothing focusable);
 * empty → `empty` in a live region, and the rail item named by `emptyFocusLabel` takes focus (Root). VoiceView then hears
 * one utterance, "<heading>. <empty>. <rail item>" (the FirstRun pattern: focus context + a debounced focus announcement
 * that the rail item's own announcement collapses into).
 */
export function Grid({ memoryKey, heading, items, empty, emptyFocusLabel, onOpen }: {
  memoryKey: string; heading: string; items: readonly CatalogItem[] | null; empty?: string; emptyFocusLabel?: string; onOpen: (slug: string) => void
}) {
  const m = gridModel(memoryKey, items)
  const { remember, lastId } = useFocusMemory(memoryKey, useCallback(() => {}, []))
  const initial = m.first ? pickInitialFocus(lastId.current, m.ids, m.first) : null
  const isEmpty = !!items && items.length === 0
  // A live region does not speak on first appearance, so the empty sentence is said explicitly, once, with the focus.
  useEffect(() => {
    if (!isEmpty || !empty) return
    setFocusContext(`${heading}. ${empty}`)
    if (emptyFocusLabel) announceFocus(emptyFocusLabel, undefined, () => true)
  }, [isEmpty, empty, heading, emptyFocusLabel])
  return (
    <View style={{ flex: 1 }}>
      {/* The heading sits above the scroll view: a focus scroll puts the focused row offsetFromStart below the scroll
          view's top, which used to push a heading inside it half out of view (device run 2026-10-10). */}
      <T variant="title" style={{ marginBottom: px(Math.max(0, L.headingGap - rowPadY)), marginLeft: px(rowPad) }}>{heading}</T>
      {isEmpty && empty ? (
        <View accessibilityLiveRegion="polite"><T variant="body" color={tokens.color.textSecondary} style={{ marginTop: px(rowPadY), marginLeft: px(rowPad), maxWidth: px(L.readingW) }}>{empty}</T></View>
      ) : null}
      {/* offsetFromStart = rowPadY: a focused row lands with room above it for the outline and growth (the scroll view clips). */}
      <SpatialNavigationScrollView useNativeScroll offsetFromStart={px(rowPadY)}>
        <SpatialNavigationNode orientation="vertical" alignInGrid onActive={() => setFocusContext(heading)}>
          {/* Room above the first row and below the last for the focus outline and growth (the scroll view clips), like Row's rowPadY. */}
          <View style={{ paddingHorizontal: px(rowPad), paddingTop: px(rowPadY), paddingBottom: px(rowPadY) }}>
            {m.rows.map((row, i) => (
              <SpatialNavigationNode key={`${memoryKey}:${i}:${items ? 'live' : 'skeleton'}`} orientation="horizontal">
                <View>
                  <FocusRow gutter={px(L.gutter)}>
                    {row.map((c) => c.skeleton || !c.item
                      ? <SkeletonCard key={c.id} />
                      : <Card key={c.id} title={c.title} meta={c.meta} ad={c.ad} imageUrl={c.item.posterUrl ?? undefined} label={c.label} testID={c.id}
                          defaultFocus={c.id === initial} onFocus={() => remember(c.id)} onPress={() => onOpen(c.item!.slug)} />)}
                  </FocusRow>
                </View>
              </SpatialNavigationNode>
            ))}
          </View>
        </SpatialNavigationNode>
      </SpatialNavigationScrollView>
    </View>
  )
}
