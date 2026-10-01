import { StartTranscriptionJobCommand, GetTranscriptionJobCommand, TranscribeClient } from '@aws-sdk/client-transcribe'
import { readFile, writeFile } from 'node:fs/promises'
import { download, upload } from '../s3'
import type { Ctx } from './index'
import { meter, transcribeUsd } from '../cost'
export interface Word { start: number; end: number; text: string; speaker?: string }
export interface Gap { startMs: number; endMs: number }

/** Transcribe (word timestamps + speaker labels) → dialogue spans → gaps ≥ 1.2 s with 200 ms margins. */
export async function speechMap(ctx: Ctx) {
  const bucket = process.env.S3_BUCKET_MEDIA!
  const key = `work/${ctx.slug}/mezz.mp4`
  await upload(`${ctx.work}/mezz.mp4`, `s3://${bucket}/${key}`, { ContentType: 'video/mp4' })
  const tc = new TranscribeClient({ region: process.env.AWS_REGION ?? 'eu-central-1' })
  const jobName = `${ctx.slug}-${Date.now()}`
  await tc.send(new StartTranscriptionJobCommand({ TranscriptionJobName: jobName, Media: { MediaFileUri: `s3://${bucket}/${key}` }, LanguageCode: ctx.language === 'de' ? 'de-DE' : 'en-US', Settings: { ShowSpeakerLabels: true, MaxSpeakerLabels: 6 }, OutputBucketName: bucket, OutputKey: `work/${ctx.slug}/transcript.json` }))
  for (;;) { const r = await tc.send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName })); const s = r.TranscriptionJob?.TranscriptionJobStatus; if (s === 'COMPLETED') break; if (s === 'FAILED') throw new Error(r.TranscriptionJob?.FailureReason); await new Promise((r) => setTimeout(r, 5000)) }
  await download(`s3://${bucket}/work/${ctx.slug}/transcript.json`, `${ctx.work}/transcript.json`)
  const words = wordsFromTranscribe(JSON.parse(await readFile(`${ctx.work}/transcript.json`, 'utf8')))
  const probe = JSON.parse(await readFile(`${ctx.work}/probe.json`, 'utf8')) as { format: { duration: string } }
  meter()?.add(transcribeUsd(parseFloat(probe.format.duration)))
  if (words.length === 0) console.warn('no speech in clip — the whole duration is one gap') // no dialogue (e.g. Sintel 0:00–1:00): words.json = [], gaps = whole clip
  await writeFile(`${ctx.work}/words.json`, JSON.stringify(words))
  await writeFile(`${ctx.work}/gaps.json`, JSON.stringify(gapsFromWords(words, Math.round(parseFloat(probe.format.duration) * 1000)), null, 2))
}

/** Transcribe emits punctuation as untimed items of its own; it is appended to the previous word so segment() sees sentence ends. */
export function wordsFromTranscribe(t: { results: { items: Array<{ type: string; start_time?: string; end_time?: string; alternatives: Array<{ content: string }>; speaker_label?: string }> } }): Word[] {
  const out: Word[] = []
  for (const i of t.results.items) {
    if (i.type === 'pronunciation') out.push({ start: parseFloat(i.start_time!), end: parseFloat(i.end_time!), text: i.alternatives[0]!.content, speaker: i.speaker_label })
    else if (i.type === 'punctuation' && out.length) out.at(-1)!.text += i.alternatives[0]!.content
  }
  return out
}

/** Gaps between dialogue; narration may speak over music/effects but never over words. */
export function gapsFromWords(words: Word[], durationMs: number, minGapMs = 1200, marginMs = 200): Gap[] {
  const gaps: Gap[] = []
  let cursor = 0
  for (const w of words) {
    const s = Math.round(w.start * 1000) - marginMs
    if (s - cursor >= minGapMs) gaps.push({ startMs: cursor, endMs: s })
    cursor = Math.max(cursor, Math.round(w.end * 1000) + marginMs)
  }
  if (durationMs - cursor >= minGapMs) gaps.push({ startMs: cursor, endMs: durationMs })
  return gaps
}
