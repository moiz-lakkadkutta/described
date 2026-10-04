import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PromptKey, Voice, promptAudioKey, promptTextFor, voiceLanguage } from '@described/contracts'
import { pollyUsd } from './cost'
import { upload as s3Upload } from './s3'

type VoiceName = Voice
type Key = PromptKey
export interface PromptClipDeps { polly?: { send(cmd: unknown): Promise<{ AudioStream?: { transformToByteArray(): Promise<Uint8Array> } }> }; upload?: typeof s3Upload }
export interface PromptClip { voice: VoiceName; key: Key; language: string; text: string; s3Key: string }

const escapeXml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** Same wrapper as 06-voice (150 ms lead-in, normal rate); duplicated on purpose — that file belongs to the describe pipeline. */
export const promptSsml = (text: string) => `<speak><break time="150ms"/><prosody rate="100%">${escapeXml(text)}</prosody></speak>`

/**
 * App-voice prompt clips (first-run panels, Settings voice preview): one MP3 per voice × key, in that voice's own language.
 * Polly SynthesizeSpeech, neural, mp3, SSML — https://docs.aws.amazon.com/polly/latest/dg/API_SynthesizeSpeech.html
 * Voices and languages: https://docs.aws.amazon.com/polly/latest/dg/available-voices.html
 * Billed per character of text, SSML tags not counted — https://aws.amazon.com/polly/pricing/ (src/cost.ts).
 * Writes outDir/<voice>/<key>.mp3; with upload, puts each at s3://$S3_BUCKET_MEDIA/<promptAudioKey> (under published/, the only
 * prefix CloudFront serves) with a 60 s cache, so a re-run is visible within a minute under the same URL.
 * dryRun: no Polly call, no file, no upload — only the plan (clips, characters, estimated USD). Paid runs need the human (decision 0005).
 */
export async function synthesizePrompts(
  o: { voices?: VoiceName[]; keys?: Key[]; outDir: string; upload: boolean; dryRun?: boolean },
  deps: PromptClipDeps = {},
): Promise<{ clips: PromptClip[]; written: string[]; uploaded: string[]; chars: number; usd: number }> {
  const clips = (o.voices ?? Voice.options).flatMap((voice) => (o.keys ?? PromptKey.options).map((key) => ({ voice, key, language: voiceLanguage[voice], text: promptTextFor(voice, key), s3Key: promptAudioKey(voice, key) })))
  const chars = clips.reduce((n, c) => n + c.text.length, 0)
  const result = { clips, written: [] as string[], uploaded: [] as string[], chars, usd: pollyUsd(chars) }
  if (o.dryRun) return result
  const bucket = process.env.S3_BUCKET_MEDIA
  if (o.upload && !bucket) throw new Error('S3_BUCKET_MEDIA is not set; set it or pass --no-upload')
  const polly = deps.polly ?? new PollyClient({ region: process.env.AWS_REGION ?? 'eu-central-1' })
  const upload = deps.upload ?? s3Upload
  for (const c of clips) {
    const r = await polly.send(new SynthesizeSpeechCommand({ Engine: 'neural', VoiceId: c.voice, OutputFormat: 'mp3', TextType: 'ssml', LanguageCode: c.language as never, Text: promptSsml(c.text) }))
    if (!r.AudioStream) throw new Error(`Polly returned no audio for ${c.voice}/${c.key}`)
    const file = join(o.outDir, c.voice, `${c.key}.mp3`)
    await mkdir(join(o.outDir, c.voice), { recursive: true })
    await writeFile(file, Buffer.from(await r.AudioStream.transformToByteArray()))
    result.written.push(file)
    if (o.upload) {
      const uri = `s3://${bucket}/${c.s3Key}`
      await upload(file, uri, { ContentType: 'audio/mpeg', CacheControl: 'public,max-age=60' })
      result.uploaded.push(uri)
    }
  }
  return result
}

/** Pure (tested): `pnpm pipeline prompts` flags → synthesizePrompts options. A dry run unless --run is given (and --dry-run always wins). */
export function promptOptions(o: { voice?: string; out?: string; upload?: boolean; run?: boolean; dryRun?: boolean }) {
  return {
    voices: o.voice ? o.voice.split(',').map((v) => Voice.parse(v.trim())) : undefined,
    outDir: o.out ?? 'work/prompts',
    upload: o.upload !== false,
    dryRun: !o.run || !!o.dryRun,
  }
}
