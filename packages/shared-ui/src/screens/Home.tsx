import React from 'react'
import { ScrollView, View } from 'react-native'
import type { Catalog, CatalogItem } from '@described/contracts'
import { Card, Row, T, Focusable } from '../components'
import { strings } from '../strings'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'

export function Home({ catalog, onOpen, onPlay }: { catalog: Catalog | null; onOpen: (slug: string) => void; onPlay: (slug: string) => void }) {
  const hero = catalog?.newlyDescribed[0]
  const card = (i: CatalogItem) => <Card key={i.slug} title={i.name} imageUrl={i.posterUrl ?? undefined} badge="AD" meta={i.durationS ? `${Math.round(i.durationS / 60)} min` : undefined} label={`Open ${i.name}`} onPress={() => onOpen(i.slug)} />
  return (
    <ScrollView>
      {hero ? (
        <View style={{ height: px(tokens.layout.heroH), justifyContent: 'flex-end', marginBottom: px(40) }} accessibilityRole="header">
          <T variant="display">{hero.name}</T>
          <View style={{ flexDirection: 'row', gap: px(16), marginTop: px(24) }}>
            <Focusable label={`${strings.home.playWithAd}: ${hero.name}`} hasTVPreferredFocus onPress={() => onPlay(hero.slug)} style={{ backgroundColor: tokens.color.interactive, paddingHorizontal: px(32), paddingVertical: px(18) }}>
              <T variant="heading" color={tokens.color.ground}>▶ {strings.home.playWithAd}</T>
            </Focusable>
            <Focusable label={`Open ${hero.name}`} onPress={() => onOpen(hero.slug)} style={{ backgroundColor: tokens.color.surface2, paddingHorizontal: px(32), paddingVertical: px(18) }}>
              <T variant="heading">{strings.title.more}</T>
            </Focusable>
          </View>
        </View>
      ) : null}
      {catalog?.continue.length ? <Row label={strings.home.continue}>{catalog.continue.map(card)}</Row> : null}
      <Row label={strings.home.newly}>{(catalog?.newlyDescribed ?? skeleton()).map(card)}</Row>
      <Row label={strings.home.all}>{(catalog?.all ?? []).map(card)}</Row>
    </ScrollView>
  )
}
/** Skeleton cards keep the focus geometry stable while loading. */
const skeleton = (): CatalogItem[] => Array.from({ length: 4 }, (_, i) => ({ slug: `sk${i}`, name: ' ', year: null, durationS: null, posterUrl: null, badges: [], extendedCount: 0, resumeS: null }))
