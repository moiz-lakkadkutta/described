import { mkdtemp, utimes, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const aws = vi.hoisted(() => vi.fn(() => { throw new Error('no AWS in tests') }))
vi.mock('../src/s3', () => ({ upload: aws, download: aws }))
vi.mock('@aws-sdk/client-transcribe', () => ({ TranscribeClient: aws, StartTranscriptionJobCommand: aws, GetTranscriptionJobCommand: aws }))
import { mezzMarker, pollTranscription, speechMap } from '../src/steps/03-speech'
import { pollyChars } from '../src/steps'

describe('speech', () => {
  it('reuses transcript.json made from the same mezzanine: no upload, no Transcribe', async () => {
    const work = await mkdtemp(join(tmpdir(), 'speech-'))
    await writeFile(join(work, 'mezz.mp4'), 'mezzanine')
    await writeFile(join(work, 'probe.json'), JSON.stringify({ format: { duration: '60' } }))
    await writeFile(join(work, 'transcript.json'), readFileSync(new URL('./fixtures/sintel-90-150.transcript.json', import.meta.url)))
    await writeFile(join(work, 'transcript.src'), await mezzMarker(work))
    await speechMap({ slug: 'x', source: '', language: 'en', voice: 'Joanna', work })
    expect(aws).not.toHaveBeenCalled()
    expect(JSON.parse(readFileSync(join(work, 'gaps.json'), 'utf8')).length).toBeGreaterThan(0)
  })
  it('changes the marker when the mezzanine is rewritten', async () => {
    const work = await mkdtemp(join(tmpdir(), 'speech-'))
    await writeFile(join(work, 'mezz.mp4'), 'a')
    const before = await mezzMarker(work)
    await utimes(join(work, 'mezz.mp4'), new Date(), new Date(Date.now() + 5000))
    expect(await mezzMarker(work)).not.toBe(before)
    await writeFile(join(work, 'transcript.json'), '{}')
    await writeFile(join(work, 'transcript.src'), before)
    await expect(speechMap({ slug: 'x', source: '', language: 'en', voice: 'Joanna', work })).rejects.toThrow('no AWS in tests') // stale → would transcribe again
  })
  it('polls Transcribe until COMPLETED, and fails on FAILED, timeout or abort', async () => {
    const seq = (...s: string[]) => { const get = vi.fn(async () => ({ status: s.shift() ?? 'IN_PROGRESS', reason: 'bad audio' })); return get }
    const done = seq('IN_PROGRESS', 'COMPLETED')
    await pollTranscription(done, { intervalMs: 1 })
    expect(done).toHaveBeenCalledTimes(2)
    await expect(pollTranscription(seq('FAILED'), { intervalMs: 1 })).rejects.toThrow('Transcribe failed: bad audio')
    await expect(pollTranscription(seq(), { intervalMs: 5, timeoutMs: 20 })).rejects.toThrow(/still IN_PROGRESS/)
    await expect(pollTranscription(seq(), { intervalMs: 1, signal: AbortSignal.abort() })).rejects.toThrow()
  })
})

describe('polly cost', () => {
  it('counts only cues voiced in this run, so a failed finish still records what it paid for', async () => {
    const work = await mkdtemp(join(tmpdir(), 'voice-'))
    await writeFile(join(work, 'cues.json'), JSON.stringify([{ text: 'Snow falls.' }, { text: 'A girl climbs.' }, { text: 'Night.' }]))
    await writeFile(join(work, 'cue_0.mp3'), '')
    await writeFile(join(work, 'cue_2.mp3'), '')
    await utimes(join(work, 'cue_2.mp3'), new Date(0), new Date(0)) // stale, from an earlier run
    expect(await pollyChars(work, Date.now() - 60_000)).toBe('Snow falls.'.length)
  })
})
