/**
 * SPIKE: the same six rewritten cues (deepseek run, cues 44–49) voiced per Polly engine/voice the way 06-voice does it
 * (150 ms lead-in break, prosody rate), measured with ffmpeg silencedetect (decision 0009) → words per second vs fit's 2.67.
 * Writes spikes/out/voice/<variant>.mp3 (the six clips joined with 0.6 s gaps, for listening) and voice.json. us-east-1.
 * https://docs.aws.amazon.com/polly/latest/dg/generative-voices.html · https://docs.aws.amazon.com/polly/latest/dg/long-form-voices.html
 * https://docs.aws.amazon.com/polly/latest/dg/prosody-tag.html (generative: prosody only around full sentences)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { PollyClient, SynthesizeSpeechCommand, type Engine, type VoiceId } from '@aws-sdk/client-polly'
import { execa } from 'execa'

const out = new URL('./out/voice/', import.meta.url).pathname
await mkdir(out, { recursive: true })
const rows = (JSON.parse(await readFile(new URL('./out/deepseek.v3.2.json', import.meta.url), 'utf8')) as { rows: { final: string }[] }).rows
const lines = rows.slice(44, 50).map((r) => r.final)
const VARIANTS: { id: string; engine: Engine; voice: VoiceId; rate: string }[] = [
  { id: 'joanna-neural-100', engine: 'neural', voice: 'Joanna', rate: '100%' }, // what ships today
  { id: 'joanna-neural-90', engine: 'neural', voice: 'Joanna', rate: '90%' },
  { id: 'ruth-generative-100', engine: 'generative', voice: 'Ruth', rate: '100%' },
  { id: 'danielle-generative-100', engine: 'generative', voice: 'Danielle', rate: '100%' },
  { id: 'matthew-generative-100', engine: 'generative', voice: 'Matthew', rate: '100%' },
  { id: 'gregory-longform-100', engine: 'long-form', voice: 'Gregory', rate: '100%' },
]
const polly = new PollyClient({ region: 'us-east-1' })
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const speechEnd = async (f: string) => {
  const { stderr } = await execa('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-af', 'silencedetect=noise=-45dB:d=0.05', '-f', 'null', '-'])
  const dur = Number(/Duration: (\d+):(\d+):([\d.]+)/.exec(stderr)!.slice(1).reduce((a, x) => a * 60 + Number(x), 0))
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]))
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))
  const lead = starts[0] !== undefined && starts[0] < 0.02 ? ends[0] ?? 0 : 0
  const tail = starts.length > ends.length ? starts.at(-1)! : dur
  return { dur, lead, speech: tail - lead }
}
let chars = 0
const report: Record<string, unknown>[] = []
for (const v of VARIANTS) {
  const files: string[] = []
  let words = 0, speech = 0, file = 0
  for (const [k, text] of lines.entries()) {
    const ssml = `<speak><break time="150ms"/><prosody rate="${v.rate}">${esc(text)}</prosody></speak>`
    chars += text.length
    const r = await polly.send(new SynthesizeSpeechCommand({ Engine: v.engine, VoiceId: v.voice, OutputFormat: 'mp3', TextType: 'ssml', Text: ssml, LanguageCode: 'en-US' }))
    const f = `${out}${v.id}-${k}.mp3`
    await writeFile(f, await r.AudioStream!.transformToByteArray())
    const m = await speechEnd(f)
    words += text.split(/\s+/).length; speech += m.speech; file += m.dur
    files.push(f)
  }
  // joined with 0.6 s silence, for listening
  const list = files.flatMap((f) => ['-i', f])
  const filter = files.map((_, k) => `[${k}:a]apad=pad_dur=0.6[a${k}]`).join(';') + ';' + files.map((_, k) => `[a${k}]`).join('') + `concat=n=${files.length}:v=0:a=1[o]`
  await execa('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...list, '-filter_complex', filter, '-map', '[o]', '-b:a', '64k', `${out}${v.id}.mp3`])
  await execa('rm', files)
  report.push({ variant: v.id, words, speechS: +speech.toFixed(2), fileS: +file.toFixed(2), wordsPerSecSpeech: +(words / speech).toFixed(2), wordsPerSecFile: +(words / file).toFixed(2) })
}
console.table(report)
console.log('characters billed per variant ≈', chars / VARIANTS.length)
await writeFile(`${out}voice.json`, JSON.stringify({ lines, report, chars }, null, 1))
