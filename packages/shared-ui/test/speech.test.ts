import { createPromptVoice, PROMPT_DEBOUNCE_MS } from '../src/speech'

/** A fake platform voice: each `speak` is a clip that ends when the test says so (or when `stop` cuts it). */
function fakeVoice() {
  const clips: { url: string; end: () => void }[] = []
  let playing: { url: string; end: () => void } | null = null
  const speak = vi.fn((url: string) => new Promise<void>((resolve) => {
    playing?.end() // the platform flushes too
    const clip = { url, end: () => { if (playing === clip) playing = null; resolve() } }
    playing = clip; clips.push(clip)
  }))
  const stop = vi.fn(() => { playing?.end() })
  return { speak, stop, clips, playing: () => playing?.url ?? null }
}

describe('prompt voice: the newest request wins', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('a burst of presses plays only the last clip, after the debounce', async () => {
    const v = fakeVoice(); const voice = createPromptVoice(v.speak, v.stop)
    const results = ['a', 'b', 'c'].map((x) => voice.say(`/prompts/${x}.mp3`))
    await vi.advanceTimersByTimeAsync(PROMPT_DEBOUNCE_MS - 1)
    expect(v.speak).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(v.speak.mock.calls).toEqual([['/prompts/c.mp3']])
    expect(await results[0]).toBe(false); expect(await results[1]).toBe(false)
    v.clips[0]!.end(); expect(await results[2]).toBe(true)
  })

  it('a new request stops the clip in flight at once (flush, not queue)', async () => {
    const v = fakeVoice(); const voice = createPromptVoice(v.speak, v.stop)
    const first = voice.say('/a.mp3'); await vi.advanceTimersByTimeAsync(PROMPT_DEBOUNCE_MS)
    expect(v.playing()).toBe('/a.mp3')
    const second = voice.say('/b.mp3')
    expect(v.playing()).toBeNull() // silenced before the debounce, not after it
    expect(await first).toBe(false) // superseded: callers must not act on it
    await vi.advanceTimersByTimeAsync(PROMPT_DEBOUNCE_MS)
    expect(v.playing()).toBe('/b.mp3')
    v.clips[1]!.end(); expect(await second).toBe(true)
  })

  it('an older clip settling after a newer one started is reported stale', async () => {
    // A platform whose clips settle out of order: the old promise resolves only after the new clip began.
    const resolvers: (() => void)[] = []
    const speak = vi.fn(() => new Promise<void>((r) => { resolvers.push(r) }))
    const voice = createPromptVoice(speak, () => {})
    const older = voice.say('/old.mp3'); await vi.advanceTimersByTimeAsync(PROMPT_DEBOUNCE_MS)
    const newer = voice.say('/new.mp3'); await vi.advanceTimersByTimeAsync(PROMPT_DEBOUNCE_MS)
    resolvers[1]!(); resolvers[0]!()
    expect(await newer).toBe(true); expect(await older).toBe(false)
  })

  it('cancel drops a pending request and stops the clip; nothing starts later', async () => {
    const v = fakeVoice(); const voice = createPromptVoice(v.speak, v.stop)
    const p = voice.say('/a.mp3'); voice.cancel()
    await vi.advanceTimersByTimeAsync(PROMPT_DEBOUNCE_MS * 4)
    expect(v.speak).not.toHaveBeenCalled(); expect(await p).toBe(false)
    expect(v.stop).toHaveBeenCalled()
  })

  it('a failing clip still settles', async () => {
    const voice = createPromptVoice(() => Promise.reject(new Error('404')), () => {})
    const p = voice.say('/missing.mp3'); await vi.advanceTimersByTimeAsync(PROMPT_DEBOUNCE_MS)
    expect(await p).toBe(true)
  })
})
