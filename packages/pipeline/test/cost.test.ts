import { bedrockUsd, meter, metered, pollyUsd, transcribeUsd } from '../src/cost'

describe('cost', () => {
  it('prices Converse usage per model, including cross-Region ids', () => {
    expect(bedrockUsd('qwen.qwen3-vl-235b-a22b', { inputTokens: 1e6, outputTokens: 1e6 })).toBeCloseTo(0.53 + 2.66)
    expect(bedrockUsd('amazon.nova-lite-v1:0', { inputTokens: 1e6 })).toBeCloseTo(0.06)
    expect(bedrockUsd('us.amazon.nova-lite-v1:0', { outputTokens: 1e6 })).toBeCloseTo(0.24)
    expect(bedrockUsd('amazon.nova-lite-v1:0', undefined)).toBe(0)
  })
  it('counts an unpriced model as $0 with a warning instead of failing the paid call', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(bedrockUsd('unknown.model', { inputTokens: 1e6 })).toBe(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
  it('bills Transcribe per second with a 15 s minimum and Polly per character', () => {
    expect(transcribeUsd(60)).toBeCloseTo(0.024)
    expect(transcribeUsd(3)).toBeCloseTo(0.006)
    expect(pollyUsd(1e6)).toBe(16)
  })
  it('meters one job at a time, also when concurrent jobs interleave, and reports cost on failure', async () => {
    const job = (n: number) => metered(async () => { for (let i = 0; i < n; i++) { await new Promise((r) => setTimeout(r, 1)); meter()!.add(1) } })
    const [a, b] = await Promise.all([job(3), job(5)])
    expect([a.costUsd, b.costUsd]).toEqual([3, 5])
    expect(meter()).toBeUndefined()
    await expect(metered(async () => { meter()!.add(2); throw new Error('x') })).rejects.toMatchObject({ costUsd: 2 })
  })
})
