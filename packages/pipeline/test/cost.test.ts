import { bedrockUsd, estimateUsd, MEASURED_TITLES, measuredPerMinute, meter, metered, NARRATIVE_PER_MIN, pollyUsd, transcribeUsd, VERIFY_PER_MIN } from '../src/cost'

describe('cost', () => {
  it('prices Converse usage per model, including cross-Region ids', () => {
    expect(bedrockUsd('qwen.qwen3-vl-235b-a22b', { inputTokens: 1e6, outputTokens: 1e6 })).toBeCloseTo(0.53 + 2.66)
    expect(bedrockUsd('amazon.nova-lite-v1:0', { inputTokens: 1e6 })).toBeCloseTo(0.06)
    expect(bedrockUsd('us.amazon.nova-lite-v1:0', { outputTokens: 1e6 })).toBeCloseTo(0.24)
    expect(bedrockUsd('amazon.nova-lite-v1:0', undefined)).toBe(0)
    expect(bedrockUsd('deepseek.v3.2', { inputTokens: 1e6, outputTokens: 1e6 })).toBeCloseTo(0.62 + 1.85) // the narrative pass (0017)
    expect(bedrockUsd('amazon.nova-pro-v1:0', { inputTokens: 1e6, outputTokens: 1e6 })).toBeCloseTo(0.8 + 3.2) // its fallback
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
  it('a 60 s title: the mean of the five measured ($0.0546) plus verify and the narrative pass ($0.0213) = $0.0759', () => {
    const e = estimateUsd(60)
    expect(e.transcribe).toBeCloseTo(0.024, 6)
    expect(e.verify).toBeCloseTo(VERIFY_PER_MIN, 9)
    expect(e.narrative).toBeCloseTo(0.0188 / 14.8, 6) // the spike's full-length Sintel pass: $0.0188 for 888 s
    expect(e.total).toBeCloseTo(0.2731 / 5 + 0.020 + 0.0188 / 14.8, 6)
    expect(e.low).toBeCloseTo(0.0514 + 0.020 + 0.0188 / 14.8, 6)
    expect(e.high).toBeCloseTo(0.0586 + 0.020 + 0.0188 / 14.8, 6)
  })
  it('an hour of film: ≈ $4.55 ($4.36–4.79); Transcribe keeps its 15 s minimum', () => {
    const h = estimateUsd(3600)
    expect(h.transcribe).toBeCloseTo(1.44, 6)
    expect(h.total).toBeCloseTo(1.44 + 60 * (0.03062 + VERIFY_PER_MIN + NARRATIVE_PER_MIN), 6)
    expect(h.total.toFixed(2)).toBe('4.55')
    expect(h.low.toFixed(2)).toBe('4.36')
    expect(h.high.toFixed(2)).toBe('4.79')
    expect(estimateUsd(5).transcribe).toBeCloseTo(transcribeUsd(15), 9)
    expect(estimateUsd(0).total).toBeCloseTo(transcribeUsd(0), 9)
  })
  it('a generative voice (Ruth) prices Polly at $30 instead of $16 per 1M characters', () => {
    const n = estimateUsd(600), g = estimateUsd(600, { engine: 'generative' })
    expect(g.polly).toBeCloseTo(n.polly * 30 / 16, 9)
    expect(g.total - n.total).toBeCloseTo(n.polly * 14 / 16, 9)
    expect(g.low - n.low).toBeCloseTo(n.polly * 14 / 16, 9)
    expect(pollyUsd(1e6, 'generative')).toBe(30)
  })
})
