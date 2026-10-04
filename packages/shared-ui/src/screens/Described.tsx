import React from 'react'
import type { Catalog } from '@described/contracts'
import { Grid } from '../components'
import { strings } from '../strings'

/** Described: every title in the library (all titles are described today — PLAN §7), as a grid. */
export function Described({ catalog, onOpen }: { catalog: Catalog | null; onOpen: (slug: string) => void }) {
  return <Grid memoryKey="described" heading={strings.described.heading} items={catalog ? catalog.all : null} onOpen={onOpen} />
}
