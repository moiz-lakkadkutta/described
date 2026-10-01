import React, { useCallback } from 'react'
import { Image, View } from 'react-native'
import { SpatialNavigationNode, SpatialNavigationScrollView } from 'react-tv-space-navigation'
import { useFocusMemory } from '@moizp/vega-media-kit/focus'
import type { Catalog } from '@described/contracts'
import { AdBadge, Card, Focusable, Row, SkeletonCard, T } from '../components'
import { pickInitialFocus } from '../focus/memory'
import { homeModel, type Action } from '../models'
import { tokens } from '../theme/tokens'
import { scrimBands } from '../theme/scrim'
import { px } from '../theme/scale'

const L = tokens.layout
const bands = scrimBands()

/**
 * Home: hero (1488×560, scrim, display name, synopsis, actions) then rows. While the catalog loads, the hero and
 * rows are skeletons of the same size and nothing is focusable; focus lands once, on the restored element.
 * Focus memory: the kit's useFocusMemory keeps the last focused id per screen across visits to Title.
 */
export function Home({ catalog, myList, onOpen, onPlay, onToggleList }: {
  catalog: Catalog | null; myList: ReadonlySet<string>
  onOpen: (slug: string) => void; onPlay: (slug: string, withAd: boolean) => void; onToggleList: (slug: string) => void
}) {
  const m = homeModel(catalog, myList)
  const { remember, lastId } = useFocusMemory('home', useCallback(() => {}, []))
  const initial = pickInitialFocus(lastId.current, m.ids, 'hero:playAd')
  const hero = m.hero
  const press = (a: Action) => () => {
    if (!hero) return
    if (a.id === 'hero:playAd') onPlay(hero.slug, true)
    else if (a.id === 'hero:play') onPlay(hero.slug, false)
    else onToggleList(hero.slug)
  }
  return (
    <SpatialNavigationScrollView useNativeScroll offsetFromStart={px(L.safeY)}>
      <View style={{ width: px(L.heroW), height: px(L.heroH), marginBottom: px(32), borderRadius: px(tokens.radius.card), overflow: 'hidden', backgroundColor: tokens.color.surface1 }}>
        {hero?.posterUrl ? <Image source={{ uri: hero.posterUrl }} style={{ position: 'absolute', top: 0, right: 0, width: '60%', height: '100%' }} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '100%' }}>
          {bands.map((c) => <View key={c} style={{ flex: 1, backgroundColor: c }} />)}
        </View>
        {/* LRUD orders siblings by registration, so the hero's node is mounted from the start (before the rows). */}
        <SpatialNavigationNode orientation="horizontal">
          <View style={{ flex: 1, justifyContent: 'flex-end', padding: px(48), gap: px(16) }}>
            {hero ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: px(16) }}>
                  <T variant="display" numberOfLines={1}>{hero.name}</T>
                  {hero.badges.includes('ad') ? <AdBadge inline /> : null}
                </View>
                {hero.synopsis ? <T variant="body" numberOfLines={2} style={{ maxWidth: px(1100) }}>{hero.synopsis}</T> : null}
                <View style={{ flexDirection: 'row', gap: px(20), marginTop: px(8) }}>
                    {m.actions.map((a) => (
                      <Focusable key={a.id} label={a.label} hint={a.hint} selected={a.selected} defaultFocus={a.id === initial} onFocus={() => remember(a.id)} onPress={press(a)}
                        style={{ backgroundColor: a.primary ? tokens.color.interactive : tokens.color.surface2, paddingHorizontal: px(32), paddingVertical: px(16) }}
                        focusedStyle={a.primary ? undefined : { backgroundColor: tokens.color.surface3 }}>
                        <T variant="heading" color={a.primary ? tokens.color.ground : tokens.color.text}>{a.primary ? `▶ ${a.text}` : a.text}</T>
                      </Focusable>
                    ))}
                </View>
              </>
            ) : (
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: px(16) }}>
                <View style={{ width: px(560), height: px(tokens.type.display.line), borderRadius: px(tokens.radius.badge), backgroundColor: tokens.color.surface2 }} />
                <View style={{ width: px(900), height: px(tokens.type.body.line * 2), borderRadius: px(tokens.radius.badge), backgroundColor: tokens.color.surface2 }} />
                <View style={{ width: px(720), height: px(tokens.type.heading.line + 32), borderRadius: px(tokens.radius.badge), backgroundColor: tokens.color.surface2 }} />
              </View>
            )}
          </View>
        </SpatialNavigationNode>
      </View>
      {/* Rows remount together when data arrives (key changes), so a late Continue watching row still registers first. */}
      {m.rows.map((r) => (
        <Row key={`${r.key}:${catalog ? 'live' : 'skeleton'}`} label={r.label}>
          {r.cards.map((c) => c.skeleton || !c.item
            ? <SkeletonCard key={c.id} />
            : <Card key={c.id} title={c.title} meta={c.meta} ad={c.ad} imageUrl={c.item.posterUrl ?? undefined} label={c.label} testID={c.id}
                defaultFocus={c.id === initial} onFocus={() => remember(c.id)} onPress={() => onOpen(c.item!.slug)} />)}
        </Row>
      ))}
    </SpatialNavigationScrollView>
  )
}
