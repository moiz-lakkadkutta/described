import type { Catalog, CatalogItem, Prefs, TitleDetail } from '@described/contracts'
import { rowSlots, type Slot } from './layout'
import { strings } from './strings'

/** View-models for Home and Title: everything a focusable needs (id, visible text, spoken label) without React. */
export interface Action { id: string; text: string; label: string; hint?: string; primary?: boolean; selected?: boolean }
export interface CardModel extends Slot { item?: CatalogItem; title: string; meta: string; label: string; ad: boolean }
export interface RowModel { key: string; label: string; cards: CardModel[] }

const minutes = (s: number | null) => (s ? Math.round(s / 60) : null)
const meta = (i: CatalogItem) => [i.year, minutes(i.durationS) && strings.minutes(minutes(i.durationS)!)].filter(Boolean).join(' · ')
const facts = (i: CatalogItem, resume: boolean) => [
  i.year ? String(i.year) : null,
  minutes(i.durationS) ? strings.a11y.minutes(minutes(i.durationS)!) : null,
  resume && i.resumeS ? strings.a11y.resume(minutes(i.resumeS) ?? 0) : null,
  i.badges.includes('ad') ? strings.a11y.ad : null,
].filter((x): x is string => !!x)

export const listAction = (i: { slug: string; name: string }, inList: boolean, id = 'list'): Action => ({
  id, text: strings.home.myList, label: inList ? strings.a11y.listRemove(i.name) : strings.a11y.listAdd(i.name), selected: inList,
})

export function heroActions(i: CatalogItem, inList: boolean): Action[] {
  return [
    { id: 'hero:playAd', text: strings.home.playWithAd, label: strings.a11y.playWithAd(i.name), primary: true },
    { id: 'hero:play', text: strings.home.play, label: strings.a11y.playWithout(i.name) },
    listAction(i, inList, 'hero:list'),
  ]
}

function row(key: string, label: string, items: CatalogItem[] | null): RowModel {
  const bySlug = new Map((items ?? []).map((i) => [i.slug, i]))
  return {
    key, label,
    cards: rowSlots(key, items ? items.map((i) => i.slug) : null).map((s) => {
      const item = bySlug.get(s.id.slice(key.length + 1))
      return item
        ? { ...s, item, title: item.name, meta: meta(item), label: strings.a11y.open(item.name, facts(item, key === 'continue')), ad: item.badges.includes('ad') }
        : { ...s, title: '', meta: '', label: '', ad: false }
    }),
  }
}

/** Rows in order; Continue watching only when it has something. `null` catalog → skeleton rows of the same geometry. */
export function homeModel(catalog: Catalog | null, myList: ReadonlySet<string>) {
  const hero = catalog?.newlyDescribed[0] ?? catalog?.all[0] ?? null
  const rows = [
    ...(catalog?.continue.length ? [row('continue', strings.home.continue, catalog.continue)] : []),
    row('newly', strings.home.newly, catalog ? catalog.newlyDescribed : null),
    row('all', strings.home.all, catalog ? catalog.all : null),
  ]
  const actions = hero ? heroActions(hero, myList.has(hero.slug)) : []
  const ids = [...actions.map((a) => a.id), ...rows.flatMap((r) => r.cards.filter((c) => !c.skeleton).map((c) => c.id))]
  return { hero, actions, rows, ids }
}

export type SampleState = 'idle' | 'playing'
const captionNames: Record<Prefs['captionKind'], string> = { off: strings.tracks.off, captions: strings.tracks.plain, sdh: strings.tracks.rich, descriptions: strings.tracks.descText }
export const nextCaptionKind = (k: Prefs['captionKind']): Prefs['captionKind'] => (['off', 'captions', 'sdh', 'descriptions'] as const)[(['off', 'captions', 'sdh', 'descriptions'].indexOf(k) + 1) % 4]!
/** The Title screen shows this many synopsis lines; a longer synopsis gets "More". */
export const SYNOPSIS_LINES = 4

export function titleModel(t: TitleDetail, o: { sample: SampleState; inList: boolean; captionKind: Prefs['captionKind']; synopsisLines?: number }) {
  const badges = [
    ...(t.badges.includes('ad') ? [{ text: strings.badge.ad, ad: true }] : []),
    ...(t.badges.includes('sdh') ? [{ text: strings.badge.sdh, ad: false }] : []),
    ...(t.extendedCount ? [{ text: strings.badge.extended(t.extendedCount), ad: false }] : []),
  ]
  const caption = captionNames[o.captionKind]
  const actions: Action[] = [
    { id: 'playAd', text: strings.home.playWithAd, label: strings.a11y.playWithAd(t.name), primary: true },
    { id: 'play', text: strings.title.playWithout, label: strings.a11y.playWithout(t.name) },
    ...(t.sampleCue ? [o.sample === 'playing'
      ? { id: 'sample', text: strings.title.stopSample, label: strings.a11y.stopSample }
      : { id: 'sample', text: strings.title.hearSample, label: strings.a11y.sample(t.name), hint: strings.a11y.sampleHint }] : []),
    { id: 'captions', text: strings.title.captions(caption), label: strings.a11y.captions(caption), hint: strings.a11y.captionsHint },
    listAction(t, o.inList),
  ]
  const more: Action | null = t.synopsis && (o.synopsisLines ?? 0) > SYNOPSIS_LINES ? { id: 'more', text: strings.title.more, label: strings.a11y.more(t.name) } : null
  return {
    meta: [t.year, minutes(t.durationS) && strings.minutes(minutes(t.durationS)!)].filter(Boolean).join(' · '),
    badges,
    processing: t.processingMinutesLeft != null ? strings.title.processing(t.processingMinutesLeft) : null,
    actions: t.processingMinutesLeft != null ? [listAction(t, o.inList)] : actions, // My list stays, so focus has somewhere to land
    more,
  }
}
