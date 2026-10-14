import { bedrockUsd, estimateUsd, MEASURED_TITLES, measuredPerMinute, meter, metered, pollyUsd, transcribeUsd } from '../src/cost'

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

describe('estimateUsd (DESC-025)', () => {
  it('derives per-minute rates from the five measured DESC-010 titles (docs/titles.md)', () => {
    const r = measuredPerMinute()
    expect(MEASURED_TITLES).toHaveLength(5)
    expect(r.describe).toBeCloseTo(0.0956 / 5, 6) // Qwen3-VL: 0.0177 + 0.0198 + 0.0197 + 0.0218 + 0.0166
    expect(r.nova).toBeCloseTo(0.0016 / 5, 6)
    expect(r.polly).toBeCloseTo(0.0559 / 5, 6)
    // everything but Transcribe, per title: 0.0274 (Sintel) … 0.0346 (Caminandes)
    expect(r.otherLow).toBeCloseTo(0.0274, 6)
    expect(r.otherHigh).toBeCloseTo(0.0346, 6)
    expect(r.describe + r.nova + r.polly).toBeCloseTo(r.otherMean, 9)
  })
  it('a measured 60 s title estimates to the mean of the five ($0.0546)', () => {
    const e = estimateUsd(60)
    expect(e.transcribe).toBeCloseTo(0.024, 6)
    expect(e.total).toBeCloseTo(0.2731 / 5, 6)
    expect(e.low).toBeCloseTo(0.0514, 6)
    expect(e.high).toBeCloseTo(0.0586, 6)
  })
  it('an hour of film: ≈ $3.28 ($3.08–3.52); Transcribe keeps its 15 s minimum', () => {
    const h = estimateUsd(3600)
    expect(h.transcribe).toBeCloseTo(1.44, 6)
    expect(h.total).toBeCloseTo(1.44 + 60 * 0.03062, 6)
    expect(h.total.toFixed(2)).toBe('3.28')
    expect(h.low.toFixed(2)).toBe('3.08')
    expect(h.high.toFixed(2)).toBe('3.52')
    expect(estimateUsd(5).transcribe).toBeCloseTo(transcribeUsd(15), 9)
    expect(estimateUsd(0).total).toBeCloseTo(transcribeUsd(0), 9)
  })
})
