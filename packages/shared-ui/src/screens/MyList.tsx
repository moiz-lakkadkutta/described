import React from 'react'
import type { Catalog, CatalogItem } from '@described/contracts'
import { Grid } from '../components'
import { strings } from '../strings'

/**
 * My list: the titles this device saved, newest first (the order of `myList`), as a grid. A slug the catalog no longer
 * has is left out. Empty: the heading and one sentence saying how to add a title; the rail holds focus (Root).
 */
export function MyList({ catalog, myList, onOpen }: { catalog: Catalog | null; myList: ReadonlySet<string>; onOpen: (slug: string) => void }) {
  const items = catalog ? myListItems(catalog, myList) : null
  return <Grid memoryKey="list" heading={strings.list.heading} items={items} empty={strings.list.empty} onOpen={onOpen} />
}
export function myListItems(catalog: Catalog, myList: ReadonlySet<string>): CatalogItem[] {
  const bySlug = new Map(catalog.all.map((i) => [i.slug, i]))
  return [...myList].flatMap((s) => bySlug.get(s) ?? [])
}
