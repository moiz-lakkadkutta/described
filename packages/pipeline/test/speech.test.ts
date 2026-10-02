import { mkdtemp, utimes, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { upload, download, NoClient } = vi.hoisted(() => ({ upload: vi.fn(), download: vi.fn(), NoClient: vi.fn(() => { throw new Error('no AWS in tests') }) }))
vi.mock('../src/s3', () => ({ upload, download }))
vi.mock('@aws-sdk/client-transcribe', () => ({
  TranscribeClient: NoClient,
  StartTranscriptionJobCommand: class Start { kind = 'start'; constructor(public input: unknown) {} },
  GetTranscriptionJobCommand: class Get { kind = 'get'; constructor(public input: unknown) {} },
}))
import { mezzMarker, pollTranscription, speechMap, transcribe } from '../src/steps/03-speech'
import { pollyChars } from '../src/steps'
import { metered } from '../src/cost'

const fixture = readFileSync(new URL('./fixtures/sintel-90-150.transcript.json', import.meta.url))
async function workDir() {
  const work = await mkdtemp(join(tmpdir(), 'speech-'))
  await writeFile(join(work, 'mezz.mp4'), 'mezzanine')
  await writeFile(join(work, 'probe.json'), JSON.stringify({ format: { duration: '60' } }))
  return work
}
const ctx = (work: string, signal?: AbortSignal) => ({ slug: 'x', source: '', language: 'en' as const, voice: 'Joanna', work, signal })
/** A fake Transcribe: each Get answers the next status of the named job. */
function fakeTranscribe(statuses: Record<string, string[]>) {
  const started: string[] = []
  const send = vi.fn(async (cmd: { kind: string; input: { TranscriptionJobName: string } }) => {
    const name = cmd.input.TranscriptionJobName
    if (cmd.kind === 'start') { started.push(name); statuses[name] ??= ['IN_PROGRESS', 'COMPLETED']; return {} }
    const q = statuses[name]
    if (!q) throw new Error('BadRequestException: job not found')
    return { TranscriptionJob: { TranscriptionJobStatus: q.length > 1 ? q.shift() : q[0], FailureReason: 'bad audio' } }
  })
  return { tc: { send } as never, send, started }
}

describe('speech', () => {
  beforeEach(() => { vi.useRealTimers(); upload.mockReset(); download.mockReset().mockImplementation(async (_uri: string, file: string) => writeFile(file, fixture)) })
  it('reuses transcript.json made from the same mezzanine and language: no upload, no Transcribe', async () => {
    const work = await workDir()
    await writeFile(join(work, 'transcript.json'), fixture)
    await writeFile(join(work, 'transcript.src'), await mezzMarker(work, 'en'))
    await speechMap(ctx(work))
    expect(NoClient).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
    expect(JSON.parse(readFileSync(join(work, 'gaps.json'), 'utf8')).length).toBeGreaterThan(0)
  })
  it('keys the marker on the mezzanine bytes and the language', async () => {
    const work = await workDir()
    const en = await mezzMarker(work, 'en')
    expect(en).toMatch(/^[0-9a-f]{64}:en$/)
    expect(await mezzMarker(work, 'de')).not.toBe(en)
    await utimes(join(work, 'mezz.mp4'), new Date(), new Date(Date.now() + 5000))
    expect(await mezzMarker(work, 'en')).toBe(en) // a touched file with the same bytes is the same mezzanine
    await writeFile(join(work, 'mezz.mp4'), 'other')
    expect(await mezzMarker(work, 'en')).not.toBe(en)
  })
  it('writes the job name before polling and resumes it on retry: one paid job, billed once', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0 }) as never)
    const work = await workDir()
    const t = fakeTranscribe({})
    download.mockRejectedValueOnce(new Error('S3 503'))
    const first = metered(() => transcribe(ctx(work), 'm1', t.tc))
    await expect(first).rejects.toMatchObject({ costUsd: 0.024 })
    expect(JSON.parse(readFileSync(join(work, 'transcribe.job.json'), 'utf8'))).toMatchObject({ jobName: t.started[0], marker: 'm1', billed: true })
    const second = await metered(() => transcribe(ctx(work), 'm1', t.tc))
    expect(t.started).toHaveLength(1)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(second.costUsd).toBe(0)
    expect(readFileSync(join(work, 'transcript.json'))).toEqual(fixture)
    vi.restoreAllMocks()
  })
  it('records the job name before Start, so a Start whose reply was lost is resumed, not paid twice', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0 }) as never)
    const work = await workDir()
    const t = fakeTranscribe({})
    const real = t.send.getMockImplementation()!
    t.send.mockImplementationOnce(async (cmd) => { await real(cmd); throw new Error('socket hang up') }) // AWS started it; we never heard
    await expect(transcribe(ctx(work), 'm1', t.tc)).rejects.toThrow('socket hang up')
    await transcribe(ctx(work), 'm1', t.tc)
    expect(t.started).toHaveLength(1)
    vi.restoreAllMocks()
  })
  it('starts a new job when the old one FAILED or belongs to another mezzanine, and bills nothing for a FAILED job', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0 }) as never)
    const work = await workDir()
    await writeFile(join(work, 'transcribe.job.json'), JSON.stringify({ jobName: 'old', marker: 'm1' }))
    const t = fakeTranscribe({ old: ['FAILED'] })
    await metered(() => transcribe(ctx(work), 'm1', t.tc))
    expect(t.started).toHaveLength(1)
    await metered(() => transcribe(ctx(work), 'm2', t.tc))
    expect(t.started).toHaveLength(2)
    const failing = fakeTranscribe({})
    failing.send.mockImplementation(async (cmd: { kind: string }) => cmd.kind === 'start' ? {} : { TranscriptionJob: { TranscriptionJobStatus: 'FAILED', FailureReason: 'bad audio' } })
    await expect(metered(() => transcribe(ctx(work), 'm3', failing.tc))).rejects.toMatchObject({ message: 'Transcribe failed: bad audio', costUsd: 0 })
    vi.restoreAllMocks()
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
