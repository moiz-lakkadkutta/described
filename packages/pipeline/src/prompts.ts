import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'
import type { Cue } from '@moizp/vega-media-kit/core'
import type { Shot } from './steps/02-shots'
import type { Gap } from './steps/03-speech'
import type { FitCue, } from './steps/05-fit'
import { WPS } from './steps/05-fit'

/** The description prompt — Netflix / Prime Video / DCMP rules, encoded. Changing this is a product decision; note it in docs/decisions. */
export function describeSystemPrompt({ maxWords, knownNames, language }: { maxWords: number; knownNames: string[]; language: 'en' | 'de' }) {
  return [
    `You write audio description for blind and low-vision viewers. Reply in ${language === 'de' ? 'German' : 'English'}. Follow these rules exactly.`,
    '- Present tense, active voice, third person. Describe what is visible, never motivation or emotion words: write "clenches her fists", not "is angry".',
    `- Do not name a character until the dialogue has named them; until then use one stable visible descriptor (e.g. "the woman in the red coat"). Known names so far: ${knownNames.join(', ') || 'none'}.`,
    '- Precise colours (olive, burgundy). Mention scene changes ("Night. A rooftop."). Read on-screen text verbatim, introduced with "Words appear:".',
    '- No interpretation, no film language ("the camera pans"), no "we see".',
    `- At most ${maxWords} words. If nothing new is visible compared to the previous shot, reply exactly: SAME`,
  ].join('\n')
}

/** Words that fit the most likely gap for this shot at 160 wpm; 8 words for a 3 s gap. Extended budget is 25. */
export function wordBudget(shot: Shot, gaps: Gap[]): number {
  const g = gaps.find((g) => g.endMs > shot.startMs) // first gap at or after the shot start
  if (!g) return 25
  const availS = (g.endMs - Math.max(g.startMs, shot.startMs)) / 1000
  return Math.max(3, Math.min(25, Math.floor(availS * WPS)))
}

const client = () => new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' })
const LITE = () => process.env.NOVA_LITE_MODEL_ID ?? 'amazon.nova-lite-v1:0'

export async function shortenWithNovaLite(text: string, maxWords: number, language: 'en' | 'de'): Promise<string> {
  const r = await client().send(new ConverseCommand({ modelId: LITE(), system: [{ text: `Shorten audio description to at most ${maxWords} words. Remove adjectives first, then clauses. Keep present tense and the most plot-relevant fact. ${language === 'de' ? 'German.' : 'English.'} Reply with the sentence only.` }], messages: [{ role: 'user', content: [{ text }] }], inferenceConfig: { maxTokens: 80, temperature: 0 } }))
  return (r.output?.message?.content?.[0]?.text ?? text).trim()
}

/** SDH: add [sounds] and [Speaker] identification per Netflix conventions; strict JSON out. */
export async function sdhWithNovaLite(captions: Cue[], descriptions: FitCue[], language: 'en' | 'de'): Promise<Cue[]> {
  const r = await client().send(new ConverseCommand({
    modelId: LITE(),
    system: [{ text: 'You produce SDH captions. Input: JSON captions (with speaker labels) and the audio-description cues (what is visible). Output: the same captions array with (1) sound-effect cues inserted where the descriptions imply a sound ([door slams], lowercase brackets, ≤ 3 words), (2) speaker IDs as [Name] only when the speaker is likely off-screen or ambiguous, (3) no other changes. ≤ 42 characters per line, 2 lines. Reply with JSON only: {"cues":[{"id","start","end","text","speaker"?,"sound"?}]}' }],
    messages: [{ role: 'user', content: [{ text: JSON.stringify({ language, captions: captions.map(({ id, start, end, text, speaker }) => ({ id, start, end, text, speaker })), descriptions: descriptions.map((d) => ({ start: d.startMs / 1000, text: d.text })) }) }] }],
    inferenceConfig: { maxTokens: 4000, temperature: 0 },
  }))
  const parsed = JSON.parse(r.output?.message?.content?.[0]?.text ?? '{"cues":[]}') as { cues: Array<Omit<Cue, 'trackId'>> }
  return parsed.cues.map((c) => ({ ...c, trackId: 'sdh' }))
}
