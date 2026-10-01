import { z } from 'zod'
export const Badge = z.enum(['ad', 'sdh', 'extended'])
export const CatalogItem = z.object({ slug: z.string(), name: z.string(), year: z.number().nullable(), durationS: z.number().nullable(), posterUrl: z.string().url().nullable(), badges: z.array(Badge), extendedCount: z.number().int(), resumeS: z.number().nullable(), synopsis: z.string().nullable().optional() })
export const Catalog = z.object({ continue: z.array(CatalogItem), newlyDescribed: z.array(CatalogItem), all: z.array(CatalogItem) })
export const TitleDetail = CatalogItem.extend({
  synopsis: z.string().nullable(), attribution: z.string(), manifestUrl: z.string().url(), voice: z.string(),
  tracks: z.object({ audio: z.array(z.object({ id: z.string(), language: z.string(), role: z.enum(['main', 'description']), label: z.string() })), text: z.array(z.object({ id: z.string(), language: z.string(), kind: z.enum(['captions', 'sdh', 'descriptions']), label: z.string(), url: z.string().url() })) }),
  sampleCue: z.object({ startS: z.number(), audioUrl: z.string().url(), text: z.string() }).nullable(),
  /** Set while the pipeline is still describing this title; the Title screen shows it instead of the play actions. */
  processingMinutesLeft: z.number().int().nullable().optional(),
})
/** Polly neural voices offered in Settings, in the order the list shows them. Vicki and Daniel are de-DE voices. */
export const Voice = z.enum(['Vicki', 'Joanna', 'Daniel', 'Matthew'])
/** Caption background: a dark box (default, PLAN §8) or a text shadow only. */
export const CaptionStyle = z.enum(['box', 'shadow'])
export const Prefs = z.object({ adDefault: z.boolean(), extendedMode: z.boolean(), voice: Voice, captionKind: z.enum(['off', 'captions', 'sdh', 'descriptions']), captionScale: z.union([z.literal(100), z.literal(125), z.literal(150), z.literal(200)]), captionStyle: CaptionStyle, firstRunDone: z.boolean() })
/**
 * Prompts the app voice speaks: the three first-run panels and the Settings voice preview. The same text is shown on
 * screen and announced to VoiceView. Clips live at CloudFront `prompts/<voice>/<key>.mp3` (see promptAudioKey);
 * the API's GET /prompts/:voice/:key.mp3 redirects there.
 * TODO(DESC-010): generate the clips with Polly in the pipeline (one per voice × key, neural, mp3, the 06-voice SSML
 * settings; de-DE for Vicki and Daniel) and upload them under prompts/. Until then the redirect ends in a 404 and the
 * app only announces the text.
 */
export const PromptKey = z.enum(['firstRun1', 'firstRun2', 'firstRun3', 'voicePreview'])
export const promptText: Record<z.infer<typeof PromptKey>, string> = {
  firstRun1: "Described plays every film with audio description. It's on now.",
  firstRun2: 'Press Menu while watching to change voice, captions or turn it off.',
  firstRun3: "Extended mode pauses the film when there's a lot to describe. Keep it on?",
  voicePreview: 'Night. A woman in a red coat climbs a snowy ridge.',
}
export const promptAudioKey = (voice: z.infer<typeof Voice>, key: z.infer<typeof PromptKey>) => `prompts/${voice}/${key}.mp3`
/** Settings → About & licenses: one attribution sentence per published title. */
export const About = z.object({ titles: z.array(z.object({ name: z.string(), attribution: z.string() })) })
export const ProgressPut = z.object({ titleSlug: z.string(), positionS: z.number().min(0) })
export const DescriptionCueDto = z.object({ startS: z.number(), endS: z.number(), text: z.string(), extended: z.boolean(), audioUrl: z.string().url().nullable() })
export type CatalogItem = z.infer<typeof CatalogItem>
export type Catalog = z.infer<typeof Catalog>
export type TitleDetail = z.infer<typeof TitleDetail>
export type Prefs = z.infer<typeof Prefs>
export type Voice = z.infer<typeof Voice>
export type CaptionStyle = z.infer<typeof CaptionStyle>
export type PromptKey = z.infer<typeof PromptKey>
export type About = z.infer<typeof About>
