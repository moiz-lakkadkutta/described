import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { meter, metered, Meter } from '../src/cost'
import type { Step } from '../src/steps'
import type { FitCue } from '../src/steps/05-fit'
import { buildPackets, limitOf, rubricMd, RUBRIC_TEMPLATE, scoresMd, shotsMd, tc, type PacketData } from '../src/eval/packets'
import { BASE_INPUTS, CapExceeded, parseSteps, runGateC, type EvalDeps } from '../src/eval/run'
import { formatSummary, parseScores, summarise, type RaterScores } from '../src/eval/score'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'gate-c-')); noStep.mockClear() })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

/** A source work dir with every input, plus caches and outputs that must never be copied. */
async function sourceDir(slug = 'src-clip') {
  const d = join(root, slug)
  await mkdir(join(d, 'cache', 'describe'), { recursive: true })
  await mkdir(join(d, 'frames'), { recursive: true })
  for (const f of BASE_INPUTS) await writeFile(join(d, f), `input ${f}`)
  await writeFile(join(d, 'source.mp4'), 'source')
  await writeFile(join(d, 'cache', 'describe', 'abc.json'), '{"cached":true}')
  await writeFile(join(d, 'frames', 'shot_0_0.jpg'), 'jpg')
  for (const f of ['described.json', 'cues.json', 'cues.fit.json', 'edit.json', 'verify.json', 'cue_0.mp3', 'cue_0.json', 'premix.wav', 'audio_ad.m4a', 'package.json', 'validate.json'])
    await writeFile(join(d, f), `output ${f}`)
  return d
}
const snapshot = async (d: string) => {
  const out: Record<string, string> = {}
  const walk = async (p: string) => { for (const e of await readdir(p, { withFileTypes: true })) { const f = join(p, e.name); if (e.isDirectory()) await walk(f); else { const s = await stat(f); out[f] = `${s.mtimeMs}:${createHash('sha256').update(await readFile(f)).digest('hex')}` } } }
  await walk(d)
  return out
}
const noStep = vi.fn(async () => { throw new Error('a step ran') })
const deps = (over: Partial<EvalDeps> = {}): EvalDeps => ({ runStep: noStep, metered, meter, log: () => {}, ...over })
const opts = (o: Partial<Parameters<typeof runGateC>[0]> = {}) => ({ workRoot: root, sourceSlug: 'src-clip', evalSlug: 'eval-1', steps: parseSteps('describe,fit,edit,voice'), cap: 0.3, voice: 'Joanna', ...o })

describe('gate-c parseSteps', () => {
  it('takes consecutive evaluation steps in order', () => {
    expect(parseSteps('describe,fit,edit,voice')).toEqual(['describe', 'fit', 'edit', 'voice'])
    expect(parseSteps(' fit , edit ')).toEqual(['fit', 'edit'])
  })
  it('refuses publish and every other non-evaluation step, gaps, wrong order and repeats', () => {
    for (const bad of ['publish', 'voice,mix', 'package', 'speech,describe', 'describe,edit', 'fit,describe', 'fit,fit', ''])
      expect(() => parseSteps(bad)).toThrow()
  })
})

describe('gate-c run: input copying', () => {
  it('copies only the step inputs, never caches, frames or outputs, and leaves the source untouched', async () => {
    const src = await sourceDir()
    const before = await snapshot(src)
    const step = vi.fn(async (_s: Step, _c: { work: string }) => {})
    await runGateC(opts(), deps({ runStep: step }))
    const copied = (await readdir(join(root, 'eval-1'))).sort()
    expect(copied).toEqual([...BASE_INPUTS, 'gate-c.json'].sort())
    for (const f of BASE_INPUTS) expect(await readFile(join(root, 'eval-1', f), 'utf8')).toBe(`input ${f}`)
    expect(await snapshot(src)).toEqual(before)
    expect(step.mock.calls.map((c) => c[0])).toEqual(['describe', 'fit', 'edit', 'voice'])
    expect(step.mock.calls[0]![1].work).toBe(join(root, 'eval-1'))
    const manifest = JSON.parse(await readFile(join(root, 'eval-1', 'gate-c.json'), 'utf8'))
    expect(manifest).toMatchObject({ source: 'src-clip', steps: ['describe', 'fit', 'edit', 'voice'], capUsd: 0.3, totalUsd: 0 })
  })
  it('starting later carries only the earlier outputs that step reads', async () => {
    await sourceDir()
    await runGateC(opts({ steps: parseSteps('edit,voice') }), deps({ runStep: async () => {} }))
    const copied = await readdir(join(root, 'eval-1'))
    expect(copied).toEqual(expect.arrayContaining(['described.json', 'cues.fit.json']))
    expect(copied).not.toContain('cues.json')
    expect(copied).not.toContain('cache')
    expect(copied).not.toContain('cue_0.mp3')
  })
  it('refuses an existing eval dir, the source slug itself, a missing input and a non-positive cap', async () => {
    await sourceDir()
    await mkdir(join(root, 'eval-1'))
    await expect(runGateC(opts(), deps())).rejects.toThrow(/exists/)
    await expect(runGateC(opts({ evalSlug: 'src-clip' }), deps())).rejects.toThrow(/differ/)
    await expect(runGateC(opts({ evalSlug: 'eval-2', cap: 0 }), deps())).rejects.toThrow(/cap/)
    await rm(join(root, 'src-clip', 'mezz.mp4'))
    await expect(runGateC(opts({ evalSlug: 'eval-3' }), deps())).rejects.toThrow(/mezz\.mp4/)
    expect(noStep).not.toHaveBeenCalled()
  })
})

describe('gate-c run --dry-run', () => {
  it('lists the copy and the steps, creates nothing, runs no step and spends nothing', async () => {
    const src = await sourceDir()
    const before = await snapshot(src)
    const lines: string[] = []
    const meterSpy = vi.fn(metered) as unknown as EvalDeps['metered'] & { mock: unknown }
    const r = await runGateC(opts({ dryRun: true }), deps({ metered: meterSpy, log: (l) => lines.push(l) }))
    expect(r.totalUsd).toBe(0)
    expect(noStep).not.toHaveBeenCalled()
    expect(meterSpy).not.toHaveBeenCalled()
    expect(existsSync(join(root, 'eval-1'))).toBe(false)
    expect(await snapshot(src)).toEqual(before)
    expect(lines.join('\n')).toMatch(/mezz\.mp4/)
    expect(lines.join('\n')).toMatch(/describe → fit → edit → voice/)
    expect(lines.join('\n')).not.toMatch(/cache\/describe|cue_0/)
  })
})

describe('gate-c run: hard spend cap', () => {
  it('aborts the step on the charge that crosses the cap; no later charge or step happens', async () => {
    await sourceDir()
    const ran: string[] = []
    let charges = 0
    const step = async (s: Step, ctx: { signal?: AbortSignal }) => {
      ran.push(s)
      for (let k = 0; k < 10; k++) {
        if (ctx.signal?.aborted) throw ctx.signal.reason
        meter()!.add(0.1) // one "AWS call"
        charges++
      }
    }
    const err = await runGateC(opts({ cap: 0.25 }), deps({ runStep: step })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CapExceeded)
    expect(ran).toEqual(['describe'])
    expect(charges).toBe(3) // 0.1, 0.2, 0.3 > 0.25 → aborted before the 4th
    expect((err as CapExceeded).spentUsd).toBeCloseTo(0.3)
    const manifest = JSON.parse(await readFile(join(root, 'eval-1', 'gate-c.json'), 'utf8'))
    expect(manifest.error).toMatch(/cap/)
  })
  it('counts earlier steps: the cap is on the run, not on each step (mocked meter)', async () => {
    await sourceDir()
    const fake = new Meter()
    const fakeMetered: EvalDeps['metered'] = async (fn) => { const before = fake.usd; const value = await fn(); return { value, costUsd: fake.usd - before } }
    const ran: string[] = []
    const step = async (s: Step, ctx: { signal?: AbortSignal }) => { ran.push(s); if (ctx.signal?.aborted) throw new Error('aborted'); fake.bedrock('amazon.nova-lite-v1:0', { inputTokens: 1e6 }) } // $0.06 each
    const err = await runGateC(opts({ cap: 0.1 }), deps({ runStep: step, metered: fakeMetered, meter: () => fake })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CapExceeded)
    expect(ran).toEqual(['describe', 'fit']) // 0.06, then 0.12 > 0.10: edit and voice never run
  })
  it('a step error carries the spend so far and stops the run', async () => {
    await sourceDir()
    const step = async (s: Step) => { meter()!.add(0.01); if (s === 'fit') throw new Error('boom') }
    const err = await runGateC(opts(), deps({ runStep: step })).catch((e: unknown) => e) as Error & { costUsd: number }
    expect(err.message).toBe('boom')
    expect(err.costUsd).toBeCloseTo(0.02)
  })
})

describe('gate-c packets: rubric', () => {
  it('quotes decision 0009\'s "fits" rule verbatim', async () => {
    const decision = await readFile(join(__dirname, '../../../docs/decisions/0009-gate-c-fits.md'), 'utf8')
    const rule = /A \*\*placed\*\* cue fits when[\s\S]*?at most 25 words\./.exec(decision)![0]
    const norm = (s: string) => s.replace(/\s+/g, ' ')
    const rubric = rubricMd(await readFile(RUBRIC_TEMPLATE, 'utf8'), 3, 29)
    expect(norm(rubric)).toContain(norm(rule))
    expect(rubric).toMatch(/one of 3 independent raters/)
    expect(rubric).toMatch(/usable \/ 29/)
    expect(rubric).not.toMatch(/\{\{/)
  })
  it('refuses an even number of raters and a non-empty out dir', async () => {
    await expect(buildPackets({ work: root, outDir: join(root, 'p'), raters: 2 })).rejects.toThrow(/odd/)
    await mkdir(join(root, 'p'))
    await writeFile(join(root, 'p', 'x'), '')
    await expect(buildPackets({ work: root, outDir: join(root, 'p'), raters: 3 })).rejects.toThrow(/not empty/)
  })
})

describe('gate-c packets: shots.md', () => {
  const cue = (c: Partial<FitCue>): FitCue => ({ startMs: 0, endMs: 0, text: 'A man walks.', extended: false, wordCount: 3, shotIndex: 0, ...c })
  const data: PacketData = {
    shots: [{ index: 0, startMs: 0, endMs: 4000 }, { index: 1, startMs: 4000, endMs: 8000 }, { index: 2, startMs: 8000, endMs: 9000 }],
    described: [0, 1, 2].map((i) => ({ index: i, startMs: 0, endMs: 0, description: `desc ${i}`, sameAsPrev: false, tokens: 0, outputTokens: 0 })),
    gaps: [{ startMs: 500, endMs: 6000 }],
    words: [{ start: 6.2, end: 6.5, text: 'Hello', speaker: 'spk_0' }],
    cues: [cue({ startMs: 500, endMs: 2300, limitMs: 6000 }), cue({ startMs: 4000, endMs: 5500, limitMs: 6000, shotIndex: 1, text: 'She runs.' })],
    fitCues: [cue({ shotIndex: 2, text: 'Door shuts.' })],
  }
  it('limit is the gap end or the next placed cue − 150 ms', () => {
    expect(limitOf(data.cues[0]!, data.cues)).toBe(3850)
    expect(limitOf(data.cues[1]!, data.cues)).toBe(6000)
  })
  it('gives every fits number, and "Not voiced" with the text to rate', () => {
    const md = shotsMd(data, new Map([[0, 1600], [1, undefined]]), { title: 'T', offsetMs: 90_000 })
    expect(md).toMatch(/^# T — 3 shots/)
    expect(md).toContain('Limit: 3850 ms · clip end: 2300 ms (limit + 200 ms = 4050) · speech end: 2100 ms · next dialogue word: 6200 ms · next placed cue: 4000 ms')
    expect(md).toContain('speech end: 5500 ms') // not measured: the clip end
    expect(md).toContain('**Not voiced** (placed by fit but dropped by the voice step')
    expect(md).toContain('"Door shuts."')
    expect(md).toContain('(spk_0): "Hello"')
    expect(tc(0, 90_000)).toBe('1:30.000')
  })
  it('the score sheet has one row per shot and parses back as unrated', () => {
    const rows = parseScores(scoresMd(data.shots))
    expect(rows.map((r) => r.shot)).toEqual([0, 1, 2])
    expect(rows.every((r) => r.usable === null)).toBe(true)
  })
})

describe('gate-c score', () => {
  const sheet = (rows: string[]) => `# Scores\n\n| Shot | Faithful | On time | Style | Clean | Fits | Usable | Note |\n|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n\nUsable: 2 / 3\n`
  it('parses a filled scores.md: explicit usable, derived usable, n/a, bold, notes with pipes', () => {
    const rows = parseScores(sheet([
      '| 0 | pass | pass | pass | pass | pass | yes | |',
      '| 1 | fail | pass | pass | pass | n/a | | "walks left" is wrong | right |',
      '| 2 | pass | n/a | pass | pass | n/a | | |',
      '| 3 | **pass** | pass | pass | pass | pass | **no** | fits: 7 ms late |',
      '| 4 | pass | | pass | pass | pass | | |',
    ]))
    expect(rows.map((r) => r.usable)).toEqual([true, false, true, false, null])
    expect(rows[1]!.criteria.faithful).toBe(false)
    expect(rows[1]!.note).toBe('"walks left" is wrong | right')
    expect(rows[3]!.note).toBe('fits: 7 ms late')
  })
  const rater = (name: string, usable: boolean[]): RaterScores => ({ rater: name, rows: usable.map((u, shot) => ({ shot, usable: u, criteria: {} as never, note: u ? '' : `n${shot}` })) })
  it('majority with 3 raters: usable when 2 or 3 say usable; all-agree and disagreements', () => {
    const s = summarise([
      rater('rater1', [true, true, true, false, false]),
      rater('rater2', [true, true, false, false, true]),
      rater('rater3', [true, false, false, false, true]),
    ])
    expect(s.perRater.map((r) => r.usable)).toEqual([3, 3, 2])
    expect(s.majority).toEqual([0, 1, 4])
    expect(s.allUsable).toEqual([0])
    expect(s.agreed).toEqual([0, 3])
    expect(s.disagreements.map((d) => [d.shot, d.majority])).toEqual([[1, true], [2, false], [4, true]])
    expect(s.ties).toEqual([])
    const text = formatSummary(s).join('\n')
    expect(text).toContain('majority-usable (≥ 2 of 3 raters usable): 3 / 5 = 60.0 % — gate ≥ 70 %: FAIL')
    expect(text).toContain('rater3: not usable — n1')
  })
  it('with an odd number of raters a tie cannot happen', () => {
    for (const n of [1, 3, 5]) for (let mask = 0; mask < 2 ** n; mask++) {
      const s = summarise(Array.from({ length: n }, (_, r) => rater(`rater${r + 1}`, [Boolean(mask & (1 << r))])))
      expect(s.ties).toEqual([])
      const yes = mask.toString(2).split('').filter((b) => b === '1').length
      expect(s.majority.length).toBe(yes > n - yes ? 1 : 0)
    }
  })
  it('with two raters a split is a tie and not usable (the old "both raters" rule)', () => {
    const s = summarise([rater('rater1', [true, true]), rater('rater2', [true, false])])
    expect(s.majority).toEqual([0])
    expect(s.ties).toEqual([1])
  })
  it('refuses raters who rated different shots; an unrated shot is not usable and is listed', () => {
    expect(() => summarise([rater('rater1', [true, true]), rater('rater2', [true])])).toThrow(/rated shots/)
    const s = summarise([rater('rater1', [true]), { rater: 'rater2', rows: [{ shot: 0, usable: null, criteria: {} as never, note: '' }] }, rater('rater3', [true])])
    expect(s.perRater[1]!.unrated).toEqual([0])
    expect(s.majority).toEqual([0])
  })
})
