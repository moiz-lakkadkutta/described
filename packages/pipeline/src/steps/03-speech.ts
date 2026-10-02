import { StartTranscriptionJobCommand, GetTranscriptionJobCommand, TranscribeClient } from '@aws-sdk/client-transcribe'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { download, upload } from '../s3'
import type { Ctx } from './index'
import { meter, transcribeUsd } from '../cost'
export interface Word { start: number; end: number; text: string; speaker?: string }
export interface Gap { startMs: number; endMs: number }

/** Transcribe (word timestamps + speaker labels) → dialogue spans → gaps ≥ 1.2 s with 200 ms margins. */
export async function speechMap(ctx: Ctx) {
  const marker = await mezzMarker(ctx.work, ctx.language)
  if (await readFile(`${ctx.work}/transcript.src`, 'utf8').catch(() => '') === marker && await stat(`${ctx.work}/transcript.json`).then(() => true, () => false)) console.log('speech: transcript.json is for this mezzanine and language; Transcribe skipped')
  else { await transcribe(ctx, marker); await writeFile(`${ctx.work}/transcript.src`, marker) }
  const words = wordsFromTranscribe(JSON.parse(await readFile(`${ctx.work}/transcript.json`, 'utf8')))
  const probe = JSON.parse(await readFile(`${ctx.work}/probe.json`, 'utf8')) as { format: { duration: string } }
  if (words.length === 0) console.warn('no speech in clip — the whole duration is one gap') // no dialogue (e.g. Sintel 0:00–1:00): words.json = [], gaps = whole clip
  await writeFile(`${ctx.work}/words.json`, JSON.stringify(words))
  await writeFile(`${ctx.work}/gaps.json`, JSON.stringify(gapsFromWords(words, Math.round(parseFloat(probe.format.duration) * 1000)), null, 2))
}

/** Identifies what a transcript was made from: sha256 of the mezzanine bytes + language. A retry or re-run with both unchanged does not pay Transcribe again. */
export async function mezzMarker(work: string, language: string): Promise<string> {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(`${work}/mezz.mp4`)) h.update(chunk as Buffer)
  return `${h.digest('hex')}:${language}`
}

/** {work}/transcribe.job.json: the Transcribe job started for a marker, written before polling, so a retry resumes it instead of paying for another. */
interface StartedJob { jobName: string; marker: string; billed?: boolean }
type Transcribe = Pick<TranscribeClient, 'send'>
const status = async (tc: Transcribe, jobName: string, abortSignal?: AbortSignal) => {
  const r = await tc.send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }), { abortSignal })
  return { status: r.TranscriptionJob?.TranscriptionJobStatus as string | undefined, failureReason: r.TranscriptionJob?.FailureReason }
}

/**
 * The paid part: upload the mezzanine and start one Transcribe job — or resume the one a previous attempt started for the same
 * marker while it is QUEUED, IN_PROGRESS or COMPLETED — then poll and download its transcript to {work}/transcript.json.
 * Cost is recorded once per Transcribe job: when it completes, or when we stop waiting on it (it still bills); never when it FAILED.
 */
export async function transcribe(ctx: Ctx, marker: string, tc: Transcribe = new TranscribeClient({ region: process.env.AWS_REGION ?? 'eu-central-1' })) {
  const bucket = process.env.S3_BUCKET_MEDIA!
  const key = `work/${ctx.slug}/mezz.mp4`
  const jobFile = `${ctx.work}/transcribe.job.json`
  let job = JSON.parse(await readFile(jobFile, 'utf8').catch(() => 'null')) as StartedJob | null
  if (job?.marker !== marker || !['QUEUED', 'IN_PROGRESS', 'COMPLETED'].includes((await status(tc, job.jobName, ctx.signal).catch(() => ({ status: undefined }))).status ?? '')) {
    await upload(`${ctx.work}/mezz.mp4`, `s3://${bucket}/${key}`, { ContentType: 'video/mp4' })
    job = { jobName: `${ctx.slug}-${Date.now()}`, marker }
    await writeFile(jobFile, JSON.stringify(job)) // before Start: a Start that reached AWS but whose reply was lost is still resumed
    await tc.send(new StartTranscriptionJobCommand({ TranscriptionJobName: job.jobName, Media: { MediaFileUri: `s3://${bucket}/${key}` }, LanguageCode: ctx.language === 'de' ? 'de-DE' : 'en-US', Settings: { ShowSpeakerLabels: true, MaxSpeakerLabels: 6 }, OutputBucketName: bucket, OutputKey: `work/${ctx.slug}/transcript.json` }), { abortSignal: ctx.signal })
  } else console.log(`speech: resuming Transcribe job ${job.jobName}`)
  const started = job
  const bill = async () => {
    if (started.billed) return
    const probe = JSON.parse(await readFile(`${ctx.work}/probe.json`, 'utf8')) as { format: { duration: string } }
    meter()?.add(transcribeUsd(parseFloat(probe.format.duration)))
    started.billed = true
    await writeFile(jobFile, JSON.stringify(started))
  }
  try { await waitForTranscription(() => status(tc, started.jobName, ctx.signal), { jobName: started.jobName, signal: ctx.signal }) } catch (e) { if (!(e instanceof TranscribeFailed)) await bill(); throw e }
  await bill()
  await download(`s3://${bucket}/work/${ctx.slug}/transcript.json`, `${ctx.work}/transcript.json`)
}

export class TranscribeFailed extends Error {}

/** A minute of clip transcribes in well under a minute; 30 min means the job is stuck. */
export const TRANSCRIBE_TIMEOUT_MS = 30 * 60_000
/**
 * Polls until COMPLETED; throws TranscribeFailed on FAILED (with FailureReason), or after timeoutMs, or when signal (the job's
 * deadline) aborts. Clock and sleep are injectable for tests.
 * Status values and FailureReason — https://docs.aws.amazon.com/transcribe/latest/APIReference/API_TranscriptionJob.html
 */
export async function waitForTranscription(
  getStatus: () => Promise<{ status?: string; failureReason?: string }>,
  { jobName = 'transcription job', timeoutMs = TRANSCRIBE_TIMEOUT_MS, pollMs = 5000, now = Date.now, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), signal }: { jobName?: string; timeoutMs?: number; pollMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void>; signal?: AbortSignal } = {},
): Promise<void> {
  const deadline = now() + timeoutMs
  for (;;) {
    signal?.throwIfAborted()
    const { status, failureReason } = await getStatus()
    if (status === 'COMPLETED') return
    if (status === 'FAILED') throw new TranscribeFailed(`Transcribe ${jobName} FAILED: ${failureReason ?? '(no FailureReason)'}`)
    if (now() >= deadline) throw new Error(`Transcribe ${jobName} not finished after ${timeoutMs / 60_000} min (last status ${status})`)
    await sleep(pollMs)
  }
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
