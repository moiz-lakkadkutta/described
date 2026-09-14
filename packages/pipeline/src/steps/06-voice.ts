import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly'
import { readFile, writeFile } from 'node:fs/promises'
import type { Ctx } from './index'
import type { FitCue } from './05-fit'
/** Polly neural, one voice per title, SSML with a 150 ms lead-in break. Extended cues are voiced too (spoken by the app at runtime). */
export async function voice(ctx: Ctx) {
  const cues = JSON.parse(await readFile(`${ctx.work}/cues.json`, 'utf8')) as FitCue[]
  const polly = new PollyClient({ region: process.env.AWS_REGION ?? 'eu-central-1' })
  for (const [i, c] of cues.entries()) {
    const ssml = `<speak><break time="150ms"/><prosody rate="100%">${escape(c.text)}</prosody></speak>`
    const r = await polly.send(new SynthesizeSpeechCommand({ Engine: 'neural', VoiceId: ctx.voice as never, OutputFormat: 'mp3', TextType: 'ssml', Text: ssml, LanguageCode: ctx.language === 'de' ? 'de-DE' : 'en-US' }))
    await writeFile(`${ctx.work}/cue_${i}.mp3`, Buffer.from(await r.AudioStream!.transformToByteArray()))
  }
}
const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
