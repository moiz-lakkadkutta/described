import { z } from 'zod'
export const Badge = z.enum(['ad', 'sdh', 'extended'])
export const CatalogItem = z.object({ slug: z.string(), name: z.string(), year: z.number().nullable(), durationS: z.number().nullable(), posterUrl: z.string().url().nullable(), badges: z.array(Badge), extendedCount: z.number().int(), resumeS: z.number().nullable() })
export const Catalog = z.object({ continue: z.array(CatalogItem), newlyDescribed: z.array(CatalogItem), all: z.array(CatalogItem) })
export const TitleDetail = CatalogItem.extend({
  synopsis: z.string().nullable(), attribution: z.string(), manifestUrl: z.string().url(), voice: z.string(),
  tracks: z.object({ audio: z.array(z.object({ id: z.string(), language: z.string(), role: z.enum(['main', 'description']), label: z.string() })), text: z.array(z.object({ id: z.string(), language: z.string(), kind: z.enum(['captions', 'sdh', 'descriptions']), label: z.string(), url: z.string().url() })) }),
  sampleCue: z.object({ startS: z.number(), audioUrl: z.string().url(), text: z.string() }).nullable(),
})
export const Prefs = z.object({ adDefault: z.boolean(), extendedMode: z.boolean(), voice: z.enum(['Joanna', 'Matthew', 'Vicki', 'Daniel']), captionKind: z.enum(['off', 'captions', 'sdh', 'descriptions']), captionScale: z.union([z.literal(100), z.literal(125), z.literal(150), z.literal(200)]), firstRunDone: z.boolean() })
export const ProgressPut = z.object({ titleSlug: z.string(), positionS: z.number().min(0) })
export const DescriptionCueDto = z.object({ startS: z.number(), endS: z.number(), text: z.string(), extended: z.boolean(), audioUrl: z.string().url().nullable() })
export type CatalogItem = z.infer<typeof CatalogItem>
export type Catalog = z.infer<typeof Catalog>
export type TitleDetail = z.infer<typeof TitleDetail>
export type Prefs = z.infer<typeof Prefs>
