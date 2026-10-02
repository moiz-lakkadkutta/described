import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly'
import { readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Ctx } from './index'
import type { FitCue } from './05-fit'
import { cueAudioFile } from '../cues'
/**
 * Polly neural, one voice per title, SSML with a 150 ms lead-in break. Extended cues are voiced too: 07-mix leaves them out
 * of the AD rendition, and the app plays their clip while the film is paused (DESC-007). File names: ../cues.
 */
export async function voice(ctx: Ctx) {
  const cues = JSON.parse(await readFile(`${ctx.work}/cues.json`, 'utf8')) as FitCue[]
  const polly = new PollyClient({ region: process.env.AWS_REGION ?? 'eu-central-1' })
  for (const [i, c] of cues.entries()) {
    const ssml = `<speak><break time="150ms"/><prosody rate="100%">${escape(c.text)}</prosody></speak>`
    const r = await polly.send(new SynthesizeSpeechCommand({ Engine: 'neural', VoiceId: ctx.voice as never, OutputFormat: 'mp3', TextType: 'ssml', Text: ssml, LanguageCode: ctx.language === 'de' ? 'de-DE' : 'en-US' }))
    await writeFile(`${ctx.work}/${cueAudioFile(i)}`, Buffer.from(await r.AudioStream!.transformToByteArray()))
  }
}

export const LanguageSchema = z.enum(['en', 'de'])
/** Polly neural voice per language when --voice is not given; POLLY_VOICE_EN / POLLY_VOICE_DE (.env.example) override the built-ins. */
const DEFAULT_VOICES = { en: 'Joanna', de: 'Vicki' } as const
/** Pure (tested): validates --lang (zod enum, default en) and picks --voice, else POLLY_VOICE_{EN,DE}, else Joanna / Vicki. */
export function resolveLanguageAndVoice(o: { lang?: string; voice?: string }, env: Record<string, string | undefined> = process.env): { language: 'en' | 'de'; voice: string } {
  const language = LanguageSchema.parse(o.lang ?? 'en')
  return { language, voice: o.voice || env[`POLLY_VOICE_${language.toUpperCase()}`] || DEFAULT_VOICES[language] }
}
const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
