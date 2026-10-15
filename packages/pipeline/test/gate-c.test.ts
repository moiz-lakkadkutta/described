import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { meter, metered, Meter } from '../src/cost'
import type { Ctx, Step } from '../src/steps'
import type { FitCue } from '../src/steps/05-fit'
import { buildPackets, limitOf, loadPacketData, nextSpeech, rubricMd, RUBRIC_TEMPLATE, scoresMd, shotsMd, skipShots, tc, type PacketData } from '../src/eval/packets'
import { BASE_INPUTS, CapExceeded, effectiveModels, evalCtx, evalGlossary, EVAL_STEPS, parseSteps, pipelineQualitySteps, runGateC, runSettings, type EvalDeps } from '../src/eval/run'
import { defaultCredit, preparePlan, prepareGateC, PREPARE_STEPS, type PrepareDeps } from '../src/eval/prepare'
import { editModelId, LITE } from '../src/prompts'
import { verifyModelId } from '../src/steps/04b-verify'
import { chmod } from 'node:fs/promises'
import { formatSummary, needsAttention, parseCorrections, parseEventsLost, parseScores, parseShotList, readExpected, readPacket, readRaters, scoreDir, summarise, type RaterScores } from '../src/eval/score'
import { VAD } from '../src/voiceActivity'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'gate-c-')); noStep.mockClear(); noRegap.mockClear() })
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })

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
const fakeVad = { source: 'transcribe+vad' as const, options: VAD, transcribeGaps: [], unlabelledSpeech: [{ startMs: 1000, endMs: 1600 }], gaps: [], gapMs: { transcribe: 10_000, final: 8600, lost: 1400 } }
const noRegap = vi.fn(async (_work: string) => fakeVad)
const deps = (over: Partial<EvalDeps> = {}): EvalDeps => ({ runStep: noStep, metered, meter, log: () => {}, regap: noRegap, ...over })
const opts = (o: Partial<Parameters<typeof runGateC>[0]> = {}) => ({ workRoot: root, sourceSlug: 'src-clip', evalSlug: 'eval-1', steps: parseSteps('describe,scenes,fit,edit,voice'), cap: 0.3, language: 'en' as const, voice: 'Joanna', ...o })

describe('gate-c parseSteps', () => {
  it('takes consecutive evaluation steps in order', () => {
    expect(parseSteps('describe,scenes,fit,edit,voice')).toEqual(['describe', 'scenes', 'fit', 'edit', 'voice'])
    expect(parseSteps(' fit , edit ')).toEqual(['fit', 'edit'])
  })
  it('refuses publish and every other non-evaluation step, gaps, wrong order and repeats', () => {
    for (const bad of ['publish', 'voice,mix', 'package', 'speech,describe', 'describe,edit', 'fit,describe', 'fit,fit', ''])
      expect(() => parseSteps(bad)).toThrow()
  })
  it('refuses voice as the first step (06-voice rewrites cues.json); voice runs only after edit', () => {
    expect(() => parseSteps('voice')).toThrow(/cannot start at voice/)
    expect(parseSteps('edit,voice')).toEqual(['edit', 'voice'])
  })
  it('EVAL_STEPS is exactly the pipeline from describe to voice (a new step there, e.g. DESC-029 scenes, must be decided on)', () => {
    expect([...EVAL_STEPS]).toEqual(pipelineQualitySteps())
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
    expect(step.mock.calls.map((c) => c[0])).toEqual(['describe', 'scenes', 'fit', 'edit', 'voice'])
    expect(step.mock.calls[0]![1].work).toBe(join(root, 'eval-1'))
    const manifest = JSON.parse(await readFile(join(root, 'eval-1', 'gate-c.json'), 'utf8'))
    expect(manifest).toMatchObject({ source: 'src-clip', steps: ['describe', 'scenes', 'fit', 'edit', 'voice'], capUsd: 0.3, totalUsd: 0, language: 'en', voice: 'Joanna' })
    expect(manifest.versions).toEqual(expect.objectContaining({ VERIFY_PROMPT_VERSION: expect.any(Number), DESCRIBE_CACHE_VERSION: expect.any(Number) }))
    expect(Object.keys(manifest.env)).toEqual(expect.arrayContaining(['DESCRIBE_MODEL_ID', 'VERIFY_MODEL_ID', 'EDIT_MODEL_ID', 'DESCRIBE_EDIT', 'DESCRIBE_VERIFY', 'DESCRIBE_CONCURRENCY']))
    expect(typeof manifest.dirty).toBe('boolean')
    expect(manifest.models.map((m: { role: string }) => m.role)).toEqual(['describe', 'verify', 'scenes', 'shorten (fit, edit)', 'edit'])
  })
  // DESC-032 / decision 0014: a source dir made before the voice-activity check has Transcribe-only gaps; the copy's are rebuilt.
  it('rebuilds the copy\'s gaps (regap) after the copy and before the first step, and records gapsSource', async () => {
    await sourceDir()
    const order: string[] = []
    const regap = vi.fn(async (w: string) => { order.push(`regap ${w}`); return fakeVad })
    await runGateC(opts({ steps: parseSteps('fit,edit') }), deps({ regap, runStep: async (s) => { order.push(`step ${s}`) } }))
    expect(order).toEqual([`regap ${join(root, 'eval-1')}`, 'step fit', 'step edit'])
    expect(JSON.parse(await readFile(join(root, 'eval-1', 'gate-c.json'), 'utf8'))).toMatchObject({ gapsSource: 'transcribe+vad', unlabelledSpeech: 1, gapsMs: { lost: 1400 } })
  })
  it('--keep-gaps keeps the copied gaps; a dry run rebuilds nothing', async () => {
    await sourceDir()
    await runGateC(opts({ keepGaps: true }), deps({ runStep: async () => {} }))
    expect(noRegap).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(join(root, 'eval-1', 'gate-c.json'), 'utf8'))).toMatchObject({ gapsSource: 'copied (--keep-gaps)' })
    await runGateC(opts({ evalSlug: 'eval-2', dryRun: true }), deps())
    expect(noRegap).not.toHaveBeenCalled()
  })
  it('a regap that fails stops the run before any step, with the error in the manifest', async () => {
    await sourceDir()
    await expect(runGateC(opts(), deps({ regap: async () => { throw new Error('words.json: bad JSON') } }))).rejects.toThrow(/bad JSON/)
    expect(noStep).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(join(root, 'eval-1', 'gate-c.json'), 'utf8'))).toMatchObject({ error: 'words.json: bad JSON' })
  })
  it('a copy that fails part-way removes the half-copied eval dir', async () => {
    await sourceDir()
    await chmod(join(root, 'src-clip', 'mezz.mp4'), 0o000)
    await expect(runGateC(opts(), deps({ runStep: async () => {} }))).rejects.toThrow()
    await chmod(join(root, 'src-clip', 'mezz.mp4'), 0o644)
    expect(existsSync(join(root, 'eval-1'))).toBe(false)
  })
  it('starting later carries only the earlier outputs that step reads', async () => {
    await sourceDir()
    await runGateC(opts({ steps: parseSteps('edit,voice') }), deps({ runStep: async () => {} }))
    const copied = await readdir(join(root, 'eval-1'))
    expect(copied).toEqual(expect.arrayContaining(['described.json', 'cues.fit.json']))
    expect(copied).not.toContain('cues.json') // edit writes it from cues.fit.json
    expect(copied).not.toContain('cache')
    expect(copied).not.toContain('cue_0.mp3')
  })
  // DESC-029: fit and edit read the scenes; fit re-groups when scenes.json is missing or stale, so it is copied only when present.
  it('starting at fit or edit carries scenes.json when the source has one', async () => {
    await sourceDir()
    await writeFile(join(root, 'src-clip', 'scenes.json'), '{"scenes":[]}')
    await runGateC(opts({ steps: parseSteps('fit,edit') }), deps({ runStep: async () => {} }))
    expect(await readdir(join(root, 'eval-1'))).toEqual(expect.arrayContaining(['described.json', 'scenes.json']))
  })
  it('the steps run with the SOURCE slug\'s glossary: the eval slug is a copy with no entry of its own', async () => {
    await sourceDir('sintel-90-210')
    const seen: (string[] | undefined)[] = []
    const step = async (_: Step, ctx: Ctx) => { seen.push(ctx.glossary?.characters.map((c) => c.name)) }
    await runGateC(opts({ sourceSlug: 'sintel-90-210', evalSlug: 'sintel-90-210-g10', steps: parseSteps('describe,scenes') }), deps({ runStep: step }))
    expect(seen).toEqual([['Sintel', 'Shaman', 'Scales'], ['Sintel', 'Shaman', 'Scales']])
    expect(evalGlossary('sintel-90-210').characters.map((c) => c.name)).toEqual(['Sintel', 'Shaman', 'Scales']) // docs/eval/gate-c-glossary.json
    expect(evalGlossary('tears-of-steel-40-100').characters.map((c) => c.name)).toContain('Thom') // titles.json
    expect(evalCtx(root, 'eval-1', 'en', 'Joanna', '', evalGlossary('sintel-90-210')).glossary?.settings.map((s) => s.name)).toEqual(['the snowy mountains', 'the tent', 'the town'])
    expect(evalCtx(root, 'eval-1', 'en', 'Joanna').glossary).toBeUndefined()
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

describe('gate-c run: model prices', () => {
  it('lists the models each step will call, as the steps resolve them', () => {
    vi.stubEnv('DESCRIBE_MODEL_ID', 'us.qwen.qwen3-vl-235b-a22b')
    vi.stubEnv('VERIFY_MODEL_ID', 'x.verify')
    vi.stubEnv('EDIT_MODEL_ID', 'x.edit')
    const m = effectiveModels(['describe', 'fit', 'edit', 'voice'])
    expect(m).toEqual([{ role: 'describe', id: 'us.qwen.qwen3-vl-235b-a22b' }, { role: 'verify', id: verifyModelId('us.qwen.qwen3-vl-235b-a22b') }, { role: 'shorten (fit, edit)', id: LITE() }, { role: 'edit', id: editModelId() }])
    vi.stubEnv('VERIFY_MODEL_ID', undefined)
    vi.stubEnv('EDIT_MODEL_ID', undefined)
    vi.stubEnv('DESCRIBE_VERIFY', '0')
    vi.stubEnv('DESCRIBE_EDIT', '0')
    expect(effectiveModels(['describe', 'fit', 'edit']).map((x) => x.role)).toEqual(['describe', 'shorten (fit, edit)'])
    vi.stubEnv('NOVA_LITE_MODEL_ID', 'us.amazon.nova-lite-v1:0')
    expect(effectiveModels(['fit'])).toEqual([{ role: 'shorten (fit, edit)', id: 'us.amazon.nova-lite-v1:0' }])
  })
  it('refuses a model with no price before anything is copied (the meter would count it as $0)', async () => {
    await sourceDir()
    vi.stubEnv('EDIT_MODEL_ID', 'amazon.nova-pro-v1:0')
    await expect(runGateC(opts(), deps())).rejects.toThrow(/no price .*amazon\.nova-pro-v1:0 \(edit\)/)
    expect(existsSync(join(root, 'eval-1'))).toBe(false)
    await expect(runGateC(opts({ steps: parseSteps('describe,scenes,fit'), dryRun: true }), deps())).resolves.toBeTruthy() // edit not run: its model does not matter
    vi.stubEnv('DESCRIBE_MODEL_ID', 'us.anthropic.unknown')
    await expect(runGateC(opts({ steps: parseSteps('describe'), dryRun: true }), deps())).rejects.toThrow(/describe/)
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
    expect(lines.join('\n')).toMatch(/describe → scenes → fit → edit → voice/)
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
    expect((err as Error).message).toMatch(/cap \$0\.250/)
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
    expect(ran).toEqual(['describe', 'scenes']) // 0.06, then 0.12 > 0.10: fit, edit and voice never run
  })
  it('a step error carries the spend so far and stops the run', async () => {
    await sourceDir()
    const step = async (s: Step) => { meter()!.add(0.01); if (s === 'fit') throw new Error('boom') }
    const err = await runGateC(opts(), deps({ runStep: step })).catch((e: unknown) => e) as Error & { costUsd: number }
    expect(err.message).toBe('boom')
    expect(err.costUsd).toBeCloseTo(0.03) // describe, scenes, then fit
  })
})

describe('gate-c packets: rubric', () => {
  it('quotes decision 0009\'s "fits" rule verbatim', async () => {
    const decision = await readFile(join(__dirname, '../../../docs/decisions/0009-gate-c-fits.md'), 'utf8')
    const rule = /A \*\*placed\*\* cue fits when[\s\S]*?at most 25 words\./.exec(decision)![0]
    const norm = (s: string) => s.replace(/\s+/g, ' ')
    const rubric = rubricMd(await readFile(RUBRIC_TEMPLATE, 'utf8'), 3, 29)
    expect(norm(rubric)).toContain(norm(rule))
    expect(rule).toContain('"Fits" also means before unlabelled speech (decision 0014)')
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
    expect(md).toContain('Limit: 3850 ms · clip end: 2300 ms (limit + 200 ms = 4050) · speech end: 2100 ms · next speech: 6200 ms (word) · next placed cue: 4000 ms')
    expect(md).toContain('speech end: 5500 ms') // not measured: the clip end
    expect(md).toContain('**Not voiced** (placed by fit but dropped by the voice step')
    expect(md).toContain('"Door shuts."')
    expect(md).toContain('(spk_0): "Hello"')
    expect(tc(0, 90_000)).toBe('1:30.000')
  })
  // DESC-032 / decision 0014: speech Transcribe missed is shown per shot and counts as the next speech for "fits".
  it('lists unlabelled speech near each shot and takes it as the next speech when it comes before the next word', () => {
    const md = shotsMd({ ...data, unlabelled: [{ startMs: 1800, endMs: 2400 }] }, new Map([[0, 1600], [1, undefined]]), { title: 'T', offsetMs: 90_000 })
    expect(md).toContain('- Unlabelled speech (not transcribed) near the shot (±2 s): 1:31.800 – 1:32.400 (1800–2400 ms)')
    expect(md).toContain('speech end: 2100 ms · next speech: 1800 ms (unlabelled speech) · next placed cue: 4000 ms')
    expect(md).toContain('speech end: 5500 ms · next speech: 6200 ms (word)') // shot 1's cue starts after it: the word is next
    expect(md.split('## Shot 2')[1]).not.toContain('Unlabelled speech') // 8000–9000 ms is more than 2 s away
    expect(shotsMd(data, new Map(), { title: 'T', offsetMs: 0 })).not.toContain('Unlabelled speech') // a dir without gaps.vad.json
  })
  it('nextSpeech: a segment running at the cue start counts (its start, before the cue); the earlier of word and segment', () => {
    const words = [{ start: 5, end: 5.4, text: 'Hi' }]
    expect(nextSpeech(words, [{ startMs: 900, endMs: 1500 }], 1000)).toEqual({ ms: 900, kind: 'unlabelled speech' })
    expect(nextSpeech(words, [{ startMs: 900, endMs: 1000 }], 1000)).toEqual({ ms: 5000, kind: 'word' }) // ended at the cue start
    expect(nextSpeech(words, [{ startMs: 6000, endMs: 7000 }], 1000)).toEqual({ ms: 5000, kind: 'word' })
    expect(nextSpeech([], [{ startMs: 6000, endMs: 7000 }, { startMs: 3000, endMs: 3500 }], 1000)).toEqual({ ms: 3000, kind: 'unlabelled speech' })
    expect(nextSpeech([], [], 1000)).toBeUndefined()
  })
  it('loadPacketData reads unlabelled speech from gaps.vad.json, and [] without it', async () => {
    const w = join(root, 'pk')
    await mkdir(w)
    for (const [f, v] of Object.entries({ 'shots.json': [], 'described.json': [], 'gaps.json': [], 'cues.json': [] })) await writeFile(join(w, f), JSON.stringify(v))
    expect((await loadPacketData(w)).unlabelled).toEqual([])
    await writeFile(join(w, 'gaps.vad.json'), JSON.stringify({ source: 'transcribe+vad', unlabelledSpeech: [{ startMs: 1, endMs: 600 }] }))
    expect((await loadPacketData(w)).unlabelled).toEqual([{ startMs: 1, endMs: 600 }])
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

describe('gate-c score: consistency and packet.json', () => {
  const sheet = (rows: string[]) => `| Shot | Faithful | On time | Style | Clean | Fits | Usable | Note |\n|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`
  it('"usable: yes" with a failed criterion is inconsistent: unrated, and warned about', () => {
    const rows = parseScores(sheet(['| 0 | fail | pass | pass | pass | pass | yes | wrong colour |', '| 1 | pass | pass | pass | pass | pass | no | other |']))
    expect(rows[0]).toMatchObject({ usable: null, inconsistent: true })
    expect(rows[1]!.usable).toBe(false)
    const s = summarise([{ rater: 'rater1', rows }])
    expect(s.perRater[0]!.inconsistent).toEqual([0])
    expect(formatSummary(s).join('\n')).toMatch(/warning: rater1 marked shots 0 usable with a failed criterion/)
  })
  it('takes the shots from packet.json and names missing or unknown rows', async () => {
    for (const r of ['rater1', 'rater2', 'rater3']) await mkdir(join(root, r))
    const full = sheet(['| 0 | pass | pass | pass | pass | pass | yes | |', '| 1 | pass | pass | pass | pass | pass | yes | |', '| 2 | pass | pass | pass | pass | pass | yes | |'])
    await writeFile(join(root, 'rater1', 'scores.md'), full)
    await writeFile(join(root, 'rater2', 'scores.md'), full)
    await writeFile(join(root, 'rater3', 'scores.md'), sheet(['| 0 | pass | pass | pass | pass | pass | yes | |', '| 7 | pass | pass | pass | pass | pass | yes | |']))
    await writeFile(join(root, 'packet.json'), JSON.stringify({ shotIndices: [0, 1, 2] }))
    const raters = await readRaters(root)
    expect(() => summarise(raters, [0, 1, 2])).toThrow(/rater3\/scores.md .*missing rows for shots 1, 2; rows for unknown shots 7/)
    expect(await readExpected(root)).toEqual([0, 1, 2])
    expect(summarise(raters.slice(0, 2), await readExpected(root)).majority).toEqual([0, 1, 2])
  })
})

describe('gate-c packets: end to end with a fake ffmpeg', () => {
  it('builds identical rater folders with only the rater files, and packet.json outside them', async () => {
    const work = join(root, 'secret-run-slug')
    await mkdir(work)
    const shots = [{ index: 0, startMs: 0, endMs: 3000 }, { index: 1, startMs: 3000, endMs: 6000 }]
    await writeFile(join(work, 'shots.json'), JSON.stringify(shots))
    await writeFile(join(work, 'described.json'), JSON.stringify(shots.map((s) => ({ ...s, description: `d${s.index}`, sameAsPrev: false, tokens: 0, outputTokens: 0 }))))
    await writeFile(join(work, 'gaps.json'), JSON.stringify([{ startMs: 0, endMs: 2500 }]))
    await writeFile(join(work, 'words.json'), '[]')
    await writeFile(join(work, 'cues.json'), JSON.stringify([{ startMs: 100, endMs: 1900, text: 'A man walks.', extended: false, wordCount: 3, shotIndex: 0, limitMs: 2500 }]))
    const calls: string[][] = []
    const ffmpeg = async (args: string[]) => { calls.push(args); await writeFile(args.at(-1)!, `img ${args.join(' ').length}`) }
    const out = join(root, 'packets')
    const r = await buildPackets({ work, outDir: out, raters: 3, offsetMs: 90_000 }, { ffmpeg, speechMs: async () => 1500, log: () => {} })
    expect(r.shots).toBe(2)
    expect((await readdir(out)).sort()).toEqual(['packet.json', 'rater1', 'rater2', 'rater3'])
    const { treeHash } = await import('../src/eval/packets')
    const hashes = await Promise.all([1, 2, 3].map((k) => treeHash(join(out, `rater${k}`))))
    expect(new Set(hashes).size).toBe(1)
    expect((await readdir(join(out, 'rater1'))).sort()).toEqual(['RUBRIC.md', 'frames', 'scores.md', 'sheets', 'shots.md'])
    expect((await readdir(join(out, 'rater1', 'frames'))).length).toBe(10)
    for (const f of ['RUBRIC.md', 'shots.md', 'scores.md']) expect(await readFile(join(out, 'rater1', f), 'utf8')).not.toMatch(/secret-run-slug|packet\.json/)
    expect(await readFile(join(out, 'rater1', 'shots.md'), 'utf8')).toContain('speech end: 1600 ms')
    expect(JSON.parse(await readFile(join(out, 'packet.json'), 'utf8'))).toMatchObject({ shotIndices: [0, 1], raters: 3, sha256: hashes[0], voicedShots: [0] })
    expect(calls.length).toBe(2 * 6) // 5 frames + 1 sheet per shot
  })
})

describe('gate-c prepare', () => {
  const pdeps = (over: Partial<PrepareDeps> = {}) => {
    const calls: string[] = []
    const d: PrepareDeps = {
      ...deps({ runStep: async (s) => { calls.push(`step ${s}`); if (s === 'speech') meter()!.add(0.048) } }),
      env: { S3_BUCKET_MEDIA: 'bkt' },
      cut: async (i, out, span) => { calls.push(`cut ${i} ${span.startS}-${span.endS}`); await writeFile(out, 'cut') },
      download: async (uri, f) => { calls.push(`download ${uri}`); await writeFile(f, 'dl') },
      upload: async (f, uri) => { calls.push(`upload ${uri}`) },
      catalogueSlugs: async () => ['sintel-90-150-r2', 'tears-of-steel-40-100'],
      titleInDb: async () => false,
      s3Keys: async (prefix) => { calls.push(`list ${prefix}`); return [] },
      ...over,
    }
    return { d, calls }
  }
  const popts = (o: Partial<Parameters<typeof prepareGateC>[0]> = {}) => ({ workRoot: root, input: 'https://example.org/film.mov', slug: 'tos-390-510', start: '6:30', end: '8:30', cap: 0.1, language: 'en' as const, voice: 'Joanna', ...o })
  it('prices Transcribe before anything runs and refuses a span the cap cannot cover', () => {
    expect(preparePlan(popts())).toMatchObject({ startS: 390, endS: 510, seconds: 120, kind: 'https' })
    expect(preparePlan(popts()).estimateUsd).toBeCloseTo(0.048)
    expect(() => preparePlan(popts({ cap: 0.04 }))).toThrow(/over the cap \$0\.040/)
    expect(() => preparePlan(popts({ end: '6:00' }))).toThrow(/after --start/)
    expect(() => preparePlan(popts({ end: '30:00', cap: 5 }))).toThrow(/min/)
    expect(() => preparePlan(popts({ slug: 'Bad Slug' }))).toThrow(/slug/)
  })
  it('--dry-run cuts, uploads, lists and runs nothing, and says S3 was not checked', async () => {
    const { d, calls } = pdeps()
    const lines: string[] = []
    const r = await prepareGateC(popts({ dryRun: true }), { ...d, log: (l) => lines.push(l) })
    expect(r.totalUsd).toBe(0)
    expect(calls).toEqual([])
    expect(lines.join('\n')).toMatch(/S3 not checked/)
    expect(existsSync(join(root, 'tos-390-510'))).toBe(false)
  })
  it('cuts, uploads under work/<slug>/ (never sources/), runs only probe → shots → speech, and records the run', async () => {
    const { d, calls } = pdeps()
    const r = await prepareGateC(popts({ input: 's3://bkt/sources/full.mp4' }), d)
    expect(calls).toEqual(['list work/tos-390-510/', 'download s3://bkt/sources/full.mp4', `cut ${join(root, 'tos-390-510', 'download.mp4')} 390-510`, 'upload s3://bkt/work/tos-390-510/source.mp4', 'step probe', 'step shots', 'step speech'])
    expect(r.totalUsd).toBeCloseTo(0.048)
    expect([...PREPARE_STEPS]).toEqual(['probe', 'shots', 'speech'])
    const dir = await readdir(join(root, 'tos-390-510'))
    expect(dir).toEqual(['gate-c.json']) // the cut and the download are removed; probe fetches the upload
    expect(JSON.parse(await readFile(join(root, 'tos-390-510', 'gate-c.json'), 'utf8'))).toMatchObject({ source: 's3://bkt/work/tos-390-510/source.mp4', startS: 390, endS: 510 })
  })
  it('needs S3_BUCKET_MEDIA; a failed cut leaves no work dir; an existing slug is refused', async () => {
    await expect(prepareGateC(popts(), pdeps({ env: {} }).d)).rejects.toThrow(/S3_BUCKET_MEDIA/)
    await expect(prepareGateC(popts(), pdeps({ cut: async () => { throw new Error('ffmpeg died') } }).d)).rejects.toThrow(/ffmpeg died/)
    expect(existsSync(join(root, 'tos-390-510'))).toBe(false)
    await mkdir(join(root, 'tos-390-510'))
    await expect(prepareGateC(popts(), pdeps().d)).rejects.toThrow(/exists/)
  })
  it('refuses a catalogue slug (titles.json, even on a dry run; Title rows) and a slug with objects under S3 work/<slug>/, before any upload', async () => {
    await expect(prepareGateC(popts({ slug: 'tears-of-steel-40-100', dryRun: true }), pdeps().d)).rejects.toThrow(/catalogue title/)
    const db = pdeps({ env: { S3_BUCKET_MEDIA: 'bkt', DATABASE_URL: 'postgresql://x' }, titleInDb: async (s) => s === 'tos-390-510' })
    await expect(prepareGateC(popts(), db.d)).rejects.toThrow(/Title row/)
    const s3 = pdeps({ s3Keys: async () => ['work/tos-390-510/mezz.mp4'] })
    await expect(prepareGateC(popts(), s3.d)).rejects.toThrow(/work\/tos-390-510\/mezz\.mp4 already in S3/)
    expect([...db.calls, ...s3.calls].filter((c) => /^(cut|upload|download|step)/.test(c))).toEqual([])
    expect(existsSync(join(root, 'tos-390-510'))).toBe(false)
  })
  it('records a credit: given, or the Blender default for the Tears of Steel download', async () => {
    expect(defaultCredit('https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov')).toBe('Tears of Steel © 2012 Blender Foundation, mango.blender.org, CC-BY 3.0')
    expect(defaultCredit('https://example.org/x.mp4')).toBeUndefined()
    await prepareGateC(popts({ input: 'https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov' }), pdeps().d)
    expect(JSON.parse(await readFile(join(root, 'tos-390-510', 'gate-c.json'), 'utf8')).credit).toBe('Tears of Steel © 2012 Blender Foundation, mango.blender.org, CC-BY 3.0')
    await prepareGateC(popts({ slug: 'other-1', credit: 'Film © Someone, CC-BY 4.0' }), pdeps().d)
    expect(JSON.parse(await readFile(join(root, 'other-1', 'gate-c.json'), 'utf8')).credit).toBe('Film © Someone, CC-BY 4.0')
  })
  it('the credit travels: run copies it from the prepared dir, packets print it in shots.md', async () => {
    await sourceDir()
    await writeFile(join(root, 'src-clip', 'gate-c.json'), JSON.stringify({ credit: 'Film © X, CC-BY 3.0' }))
    await runGateC(opts(), deps({ runStep: async () => {} }))
    expect(JSON.parse(await readFile(join(root, 'eval-1', 'gate-c.json'), 'utf8')).credit).toBe('Film © X, CC-BY 3.0')
    const md = shotsMd({ shots: [], described: [], gaps: [], words: [], cues: [], fitCues: [] }, new Map(), { title: 'T', offsetMs: 0, credit: 'Film © X, CC-BY 3.0' })
    expect(md).toContain('Credit: Film © X, CC-BY 3.0')
  })
})

// DESC-030 follow-ups: same-as-previous shots are not rated (decision 0003: usable / (shots − same-as-previous)), the dirty flag,
// the dry-run settings, "skip" rows and the scorer's corrections.md.
const fixture = async (f: string) => JSON.parse(await readFile(join(__dirname, 'fixtures', `tos-390-510-g10.${f}.json`), 'utf8'))
const tosData = async (): Promise<PacketData> => ({
  shots: await fixture('shots'), described: await fixture('described'), gaps: await fixture('gaps'), words: await fixture('words'),
  cues: await fixture('cues'), fitCues: await fixture('cues.fit'),
})
const section = (md: string, i: number) => md.split(/^## /m).find((s) => s.startsWith(`Shot ${i}\n`))!

describe('gate-c packets: same-as-previous shots are not rated', () => {
  it('tos-390-510-g10 shot 16 (empty, marked same-as-previous, not voiced) is the only skip shot', async () => {
    expect(skipShots(await tosData())).toEqual([16])
  })
  it('shots.md labels it "Same as previous shot — not rated", never "no room in the dialogue gaps"', async () => {
    const md = shotsMd(await tosData(), new Map(), { title: 'T', offsetMs: 390_000 })
    const s16 = section(md, 16)
    expect(s16).toContain('Same as previous shot — not rated')
    expect(s16).not.toMatch(/no room in the dialogue gaps|Rate the text/)
    expect(section(md, 17)).not.toContain('not rated')
  })
  it('only sameAsPrev with no cue is skipped; a voiced or fit-placed shot is rated; an empty description NOT marked same-as-previous is rated (a pipeline failure)', () => {
    const d: PacketData = {
      shots: [0, 1, 2, 3].map((i) => ({ index: i, startMs: i * 1000, endMs: i * 1000 + 1000 })),
      described: [
        { index: 0, startMs: 0, endMs: 0, description: 'A man.', sameAsPrev: false, tokens: 0, outputTokens: 0 },
        { index: 1, startMs: 0, endMs: 0, description: '  ', sameAsPrev: false, tokens: 0, outputTokens: 0 },
        { index: 2, startMs: 0, endMs: 0, description: 'A man.', sameAsPrev: true, tokens: 0, outputTokens: 0 },
        { index: 3, startMs: 0, endMs: 0, description: 'He sits.', sameAsPrev: true, tokens: 0, outputTokens: 0 },
      ],
      gaps: [], words: [],
      cues: [{ startMs: 3000, endMs: 3500, text: 'He sits.', extended: false, wordCount: 2, shotIndex: 3 }],
      fitCues: [],
    }
    expect(skipShots(d)).toEqual([2])
    const md = shotsMd(d, new Map(), { title: 'T', offsetMs: 0 })
    expect(section(md, 1)).toContain('**Not voiced: empty description**')
    expect(section(md, 1)).not.toMatch(/not rated|no room in the dialogue gaps/)
    expect(scoresMd(d.shots, skipShots(d))).toContain('| 1 | | | | | | | |')
  })
  it('the rubric says one thing about same-as-previous: not rated when nothing is voiced, a continuation with text is rated, raters may override', async () => {
    const r = await readFile(RUBRIC_TEMPLATE, 'utf8')
    expect(r).toMatch(/Same as previous shot — not rated/)
    expect(r).toMatch(/continuation with text[^.]*is rated/i)
    expect(r).toMatch(/Not voiced: empty description/)
    expect(r).not.toMatch(/same as previous[^\n]*Rate it against its own\s+frames like any other shot\. A shot/i)
  })
  it('scores.md pre-fills a skip row, and the total is out of the rated shots', async () => {
    const d = await tosData()
    const md = scoresMd(d.shots, [16])
    expect(md).toContain('| 16 | n/a | n/a | n/a | n/a | n/a | skip | Same as previous shot — not rated |')
    expect(md).toContain('Usable: __ / 30')
    const rows = parseScores(md)
    expect(rows.find((r) => r.shot === 16)).toMatchObject({ usable: null, skip: true })
    expect(summarise([{ rater: 'rater1', rows }], { shotIndices: d.shots.map((s) => s.index), skipShots: [16] }).perRater[0]!.unrated).not.toContain(16)
  })
  it('packet.json records skipShots', async () => {
    const work = join(root, 'w')
    await mkdir(work)
    const shots = [{ index: 0, startMs: 0, endMs: 3000 }, { index: 1, startMs: 3000, endMs: 6000 }]
    await writeFile(join(work, 'shots.json'), JSON.stringify(shots))
    await writeFile(join(work, 'described.json'), JSON.stringify(shots.map((s) => ({ ...s, description: s.index ? '' : 'd0', sameAsPrev: s.index === 1, tokens: 0, outputTokens: 0 }))))
    await writeFile(join(work, 'gaps.json'), JSON.stringify([{ startMs: 0, endMs: 6000 }]))
    await writeFile(join(work, 'cues.json'), JSON.stringify([{ startMs: 100, endMs: 1900, text: 'A man walks.', extended: false, wordCount: 3, shotIndex: 0, limitMs: 6000 }]))
    const out = join(root, 'packets')
    await buildPackets({ work, outDir: out, raters: 1 }, { ffmpeg: async (a) => { await writeFile(a.at(-1)!, 'img') }, speechMs: async () => 1000, log: () => {} })
    expect(JSON.parse(await readFile(join(out, 'packet.json'), 'utf8'))).toMatchObject({ shotIndices: [0, 1], skipShots: [1] })
    expect(await readPacket(out)).toEqual({ shotIndices: [0, 1], skipShots: [1], voicedShots: [0] })
  })
})

describe('gate-c score: skip rows and skipShots', () => {
  const sheet = (rows: string[]) => `| Shot | Faithful | On time | Style | Clean | Fits | Usable | Note |\n|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`
  const ok = (i: number) => `| ${i} | pass | pass | pass | pass | pass | yes | |`
  it('only exactly "skip" or "skip (empty)" in the Usable column is a skip', () => {
    const rows = parseScores(sheet([ok(0), '| 1 | skip (empty) | n/a | n/a | n/a | n/a | skip (empty) | text to rate is empty |', '| 2 | n/a | n/a | n/a | n/a | n/a | skip | |', '| 3 | skip (empty) | | | | | **Skip** | x |',
      '| 4 | skip (empty) | | | | | | only a criterion says skip |', '| 5 | pass | pass | pass | pass | pass | skipped | |', '| 6 | pass | pass | pass | pass | pass | skip it | |']))
    expect(rows.map((r) => [r.usable, r.skip ?? false])).toEqual([[true, false], [null, true], [null, true], [null, true], [null, false], [null, false], [null, false]])
  })
  it('skipShots leave the denominator; a skip row is not unrated; a rating given anyway is ignored', () => {
    const r1 = parseScores(sheet([ok(0), '| 1 | | | | | | skip | |', '| 2 | fail | pass | pass | pass | pass | no | wrong |']))
    const r2 = parseScores(sheet([ok(0), ok(1), ok(2)]))
    const s = summarise([{ rater: 'rater1', rows: r1 }, { rater: 'rater2', rows: r2 }, { rater: 'rater3', rows: r1 }], { shotIndices: [0, 1, 2], skipShots: [1] })
    expect(s.skipped).toEqual([1])
    expect(s.rated).toEqual([0, 2])
    expect(s.perRater.map((r) => [r.usable, r.unrated])).toEqual([[1, []], [2, []], [1, []]])
    expect(s.majority).toEqual([0])
    const text = formatSummary(s).join('\n')
    expect(text).toContain('majority-usable (≥ 2 of 3 raters usable): 1 / 2 = 50.0 %')
    expect(text).toMatch(/same as previous, not rated \(decision 0003\): shot 1/)
    expect(text).not.toMatch(/UNRATED/)
  })
  it('a skip on a shot NOT in skipShots counts as not usable, is warned about and fails the command', () => {
    const skipRow = parseScores(sheet([ok(0), '| 1 | | | | | | skip (empty) | empty? |']))
    const yes = parseScores(sheet([ok(0), ok(1)]))
    const no = parseScores(sheet([ok(0), '| 1 | fail | pass | pass | pass | pass | no | x |']))
    const s = summarise([{ rater: 'rater1', rows: skipRow }, { rater: 'rater2', rows: yes }, { rater: 'rater3', rows: no }], { shotIndices: [0, 1], skipShots: [] })
    expect(s.rated).toEqual([0, 1])
    expect(s.perRater[0]).toMatchObject({ usable: 1, unrated: [], skippedByRater: [1] })
    expect(s.majority).toEqual([0])
    expect(formatSummary(s).join('\n')).toMatch(/warning: rater1 marked shot 1 skip, but it is not a same-as-previous shot.*counted not usable/)
    expect(needsAttention(s)).toBe(true)
  })
  it('abuse: one "yes" and two "skip" on a rated shot is NOT majority-usable and NOT all-usable', () => {
    const y = parseScores(sheet([ok(0), ok(1)]))
    const k = parseScores(sheet([ok(0), '| 1 | | | | | | skip | |']))
    const s = summarise([{ rater: 'rater1', rows: y }, { rater: 'rater2', rows: k }, { rater: 'rater3', rows: k }], { shotIndices: [0, 1] })
    expect(s.majority).toEqual([0])
    expect(s.allUsable).toEqual([0])
    expect(s.rated).toEqual([0, 1])
    expect(formatSummary(s).join('\n')).toContain('majority-usable (≥ 2 of 3 raters usable): 1 / 2 = 50.0 %')
  })
  it('abuse: every rater skipping a shot that is not in skipShots keeps it in the denominator, not usable and flagged', () => {
    const rows = parseScores(sheet([ok(0), '| 1 | | | | | | skip | |']))
    const s = summarise([{ rater: 'rater1', rows }, { rater: 'rater2', rows }, { rater: 'rater3', rows }], { shotIndices: [0, 1] })
    expect(s.skipped).toEqual([])
    expect(s.rated).toEqual([0, 1])
    expect(s.majority).toEqual([0])
    expect(s.allSkipped).toEqual([1])
    const text = formatSummary(s).join('\n')
    expect(text).toMatch(/warning: every rater marked shot 1 skip.*not in packet\.json skipShots.*counted not usable/)
    expect(text).not.toMatch(/same as previous, not rated/)
    expect(needsAttention(s)).toBe(true)
  })
  it('a skipShot rated anyway: warned; it counts as rated only when a majority of raters rated it', () => {
    const k = parseScores(sheet([ok(0), '| 1 | | | | | | skip | |']))
    const y = parseScores(sheet([ok(0), ok(1)]))
    const one = summarise([{ rater: 'rater1', rows: y }, { rater: 'rater2', rows: k }, { rater: 'rater3', rows: k }], { shotIndices: [0, 1], skipShots: [1] })
    expect(one.skipped).toEqual([1])
    expect(one.rated).toEqual([0])
    expect(one.perRater[0]!.ratedSkipShot).toEqual([1])
    expect(formatSummary(one).join('\n')).toMatch(/warning: rater1 rated shot 1 \(same as previous, not rated\) anyway; ignored: only 1 of 3 raters rated it/)
    const two = summarise([{ rater: 'rater1', rows: y }, { rater: 'rater2', rows: y }, { rater: 'rater3', rows: k }], { shotIndices: [0, 1], skipShots: [1] })
    expect(two.skipped).toEqual([])
    expect(two.rated).toEqual([0, 1])
    expect(two.overridden).toEqual([1])
    expect(two.majority).toEqual([0, 1]) // 2 of 3 usable; rater3's skip now counts not usable
    expect(formatSummary(two).join('\n')).toMatch(/warning: shot 1 is in skipShots but 2 of 3 raters rated it; counted as rated/)
  })
})

describe('gate-c score: corrections.md', () => {
  const md = '# Corrections\n\n| Shot | Criterion | Verdict | Reason |\n|---|---|---|---|\n| 25 | on time | fail | talks over "Come on!" at 103 s, missed by Transcribe |\n| 2 | Faithful | fail | the coat is grey on frame 4 |\n| 28 | on time | | talks over the yell at 112 s |\n'
  it('parses shot, criterion, verdict (fail when blank) and reason', () => {
    expect(parseCorrections(md)).toEqual([
      { shot: 25, criterion: 'onTime', reason: 'talks over "Come on!" at 103 s, missed by Transcribe' },
      { shot: 2, criterion: 'faithful', reason: 'the coat is grey on frame 4' },
      { shot: 28, criterion: 'onTime', reason: 'talks over the yell at 112 s' },
    ])
    expect(() => parseCorrections('| 3 | colour | fail | x |')).toThrow(/criterion/)
    expect(() => parseCorrections('| 3 | fits | fail | |')).toThrow(/reason/)
  })
  it('abuse: a correction can only fail a criterion; "pass" is refused', () => {
    expect(() => parseCorrections('| 2 | faithful | pass | the colour is right |')).toThrow(/fail-only/)
    expect(() => parseCorrections('| 2 | faithful | yes | x |')).toThrow(/fail-only/)
  })
  it('applies to every rater; score prints the as-rated and the corrected result', async () => {
    const sheet = (rows: string[]) => `| Shot | Faithful | On time | Style | Clean | Fits | Usable | Note |\n|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`
    for (const r of ['rater1', 'rater2', 'rater3']) {
      await mkdir(join(root, r))
      await writeFile(join(root, r, 'scores.md'), sheet(['| 2 | pass | pass | pass | pass | pass | yes | |', '| 25 | pass | pass | pass | pass | pass | yes | |', '| 28 | pass | pass | pass | pass | pass | yes | |']))
    }
    await writeFile(join(root, 'packet.json'), JSON.stringify({ shotIndices: [2, 25, 28] }))
    const before = await readFile(join(root, 'rater1', 'scores.md'), 'utf8')
    const plain = await scoreDir(root)
    expect(plain.lines.join('\n')).not.toMatch(/corrected/i)
    await writeFile(join(root, 'corrections.md'), md)
    const r = await scoreDir(root)
    const text = r.lines.join('\n')
    expect(text).toMatch(/as rated[\s\S]*\nmajority-usable .*: 3 \/ 3 = 100\.0 % — gate ≥ 70 %: PASS/)
    expect(text).toMatch(/corrected \(corrections\.md, 3 corrections\)[\s\S]*CORRECTED \(not the blind result\) majority-usable .*: 0 \/ 3 = 0\.0 % — gate ≥ 70 %: FAIL/)
    expect(r.exitCode).toBe(0) // the exit code follows the as-rated result
    expect(text).toContain('shot 25 on time → fail: talks over "Come on!" at 103 s, missed by Transcribe')
    expect(await readFile(join(root, 'rater1', 'scores.md'), 'utf8')).toBe(before) // the raters' sheets are never written
  })
  it('prints voiced-usable / voiced, the shots not voiced and the plot events lost, as rated and corrected; the gate is unchanged', async () => {
    const sheet = (rows: string[], lost: string) => `| Shot | Faithful | On time | Style | Clean | Fits | Usable | Note |\n|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n\nUsable: 2 / 3\n\nPlot events lost (not voiced and plot-relevant):\n${lost}\n`
    const rows = ['| 2 | pass | pass | pass | fail | pass | no | "Dim." |', '| 25 | pass | n/a | pass | pass | n/a | yes | Not voiced. |', '| 28 | fail | n/a | pass | pass | n/a | no | not a tent |']
    for (const [r, lost] of [['rater1', '- Shot 28: she holds the dragon.\n- Shots 4/7/8 lose the bowl.'], ['rater2', '- Shot 28: she tends the dragon.'], ['rater3', '- (Minor) Shot 25: x']] as const) {
      await mkdir(join(root, r))
      await writeFile(join(root, r, 'scores.md'), sheet(rows, lost))
    }
    expect(parseEventsLost(sheet(rows, '- Shot 28: x\n- Shots 4/7/8 lose the bowl.\n- (Minor) Shot 3: y'))).toEqual([28, 4, 7, 8, 3])
    await writeFile(join(root, 'packet.json'), JSON.stringify({ shotIndices: [2, 25, 28] }))
    const plain = (await scoreDir(root)).lines.join('\n')
    expect(plain).toMatch(/majority-usable .*: 1 \/ 3 = 33\.3 % — gate ≥ 70 %: FAIL/) // the gate as before
    expect(plain).toContain('informational (not the gate): voiced-usable / voiced: 0 / 1 = 0.0 %; not voiced: 2 shots (25, 28); plot events lost (listed by a majority): 1 (shot 28)')
    // packet.json's voicedShots decides, not the raters' "On time: n/a" (old packets without it fall back to n/a, as above)
    await writeFile(join(root, 'packet.json'), JSON.stringify({ shotIndices: [2, 25, 28], voicedShots: [2, 25] }))
    expect((await scoreDir(root)).lines.join('\n')).toContain('voiced-usable / voiced: 1 / 2 = 50.0 %; not voiced: 1 shot (28)')
    await writeFile(join(root, 'packet.json'), JSON.stringify({ shotIndices: [2, 25, 28] }))
    await writeFile(join(root, 'corrections.md'), '| 25 | faithful | fail | wrong colour |\n')
    const both = (await scoreDir(root)).lines.join('\n')
    expect(both.match(/informational \(not the gate\)/g)).toHaveLength(2) // as rated and corrected
    expect(both).toContain('informational (not the gate): voiced-usable / voiced: 0 / 1 = 0.0 %; not voiced: 2 shots (25, 28); plot events lost (listed by a majority): 1 (shot 28)')
  })
  it('--skip scores an old packet.json that lacks skipShots', async () => {
    const sheet = (rows: string[]) => `| Shot | Faithful | On time | Style | Clean | Fits | Usable | Note |\n|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`
    await mkdir(join(root, 'rater1'))
    await writeFile(join(root, 'rater1', 'scores.md'), sheet(['| 0 | pass | pass | pass | pass | pass | yes | |', '| 1 | | | | | | | |']))
    await writeFile(join(root, 'packet.json'), JSON.stringify({ shotIndices: [0, 1] }))
    expect((await scoreDir(root)).exitCode).toBe(1)
    const r = await scoreDir(root, { skip: [1] })
    expect(r.exitCode).toBe(0)
    expect(r.lines.join('\n')).toContain('majority-usable (≥ 1 of 1 raters usable): 1 / 1 = 100.0 %')
    await writeFile(join(root, 'packet.json'), JSON.stringify({ shotIndices: [0, 1], skipShots: [] }))
    await expect(scoreDir(root, { skip: [1] })).rejects.toThrow(/already has skipShots/)
    expect(parseShotList('16, 3')).toEqual([3, 16])
    expect(() => parseShotList('x')).toThrow()
  })
})

describe('gate-c run: settings', () => {
  it('dirty counts only tracked modifications (untracked files never make a run dirty)', () => {
    const calls: string[][] = []
    const git = (args: string[]) => { calls.push(args); return args[0] === 'status' ? '' : 'abc\n' }
    expect(runSettings(['describe'], 'en', 'Joanna', {}, git)).toMatchObject({ commit: 'abc', dirty: false })
    expect(calls).toContainEqual(['status', '--porcelain', '--untracked-files=no'])
    expect(runSettings(['describe'], 'en', 'Joanna', {}, (a) => (a[0] === 'status' ? ' M src/x.ts\n' : 'abc')).dirty).toBe(true)
  })
  it('the dry run prints verify on/off, the glossary status, the language and the voice', async () => {
    await sourceDir('sintel-90-210')
    const lines: string[] = []
    await runGateC(opts({ sourceSlug: 'sintel-90-210', evalSlug: 'sintel-90-210-g99', dryRun: true }), deps({ log: (l) => lines.push(l) }))
    let text = lines.join('\n')
    expect(text).toMatch(/verify: on/)
    expect(text).toMatch(/glossary: found for sintel-90-210/)
    expect(text).toMatch(/language: en, voice: Joanna/)
    await sourceDir()
    vi.stubEnv('DESCRIBE_VERIFY', '0')
    lines.length = 0
    await runGateC(opts({ dryRun: true, language: 'de', voice: 'Vicki' }), deps({ log: (l) => lines.push(l) }))
    text = lines.join('\n')
    expect(text).toMatch(/verify: off/)
    expect(text).toMatch(/glossary: none for src-clip/)
    expect(text).toMatch(/language: de, voice: Vicki/)
  })
})
