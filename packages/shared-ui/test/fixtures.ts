import type { Catalog, CatalogItem, TitleDetail } from '@described/contracts'
const item = (slug: string, name: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  slug, name, year: 2010, durationS: 888, posterUrl: `https://cdn.example/${slug}.jpg`, badges: ['ad', 'sdh'], extendedCount: 0, resumeS: null,
  synopsis: `${name} synopsis.`, ...extra,
})
export const sintel = item('sintel-90-210', 'Sintel', { extendedCount: 3, badges: ['ad', 'sdh', 'extended'] })
export const tears = item('tears-of-steel', 'Tears of Steel', { year: 2012, durationS: 734, resumeS: 120 })
export const bunny = item('big-buck-bunny', 'Big Buck Bunny', { year: 2008, durationS: 596, posterUrl: null })
export const catalog: Catalog = { continue: [tears], newlyDescribed: [sintel, tears], all: [sintel, tears, bunny] }
export const title: TitleDetail = {
  ...sintel,
  synopsis: 'A lonely young woman, Sintel, helps and befriends a dragon, whom she calls Scales. But when he is kidnapped by an adult dragon, Sintel decides to embark on a dangerous quest to find her lost friend Scales, a journey that takes her across mountains, deserts and snow.',
  attribution: 'Sintel © Blender Foundation, CC-BY 3.0. Described by Described.',
  manifestUrl: 'https://dco7qa0c4m1pw.cloudfront.net/published/sintel-90-210/master.m3u8', voice: 'Joanna',
  tracks: { audio: [], text: [] },
  sampleCue: { startS: 12, audioUrl: 'https://cdn.example/cue.mp3', text: 'A dragon lands.' },
}
