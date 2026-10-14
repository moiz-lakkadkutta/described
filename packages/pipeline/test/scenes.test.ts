import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime'
import { checkScenes, fallbackScenes, groupScenes, groundLabel, readScenes, replyGroups, sceneGroups, sceneOf, type Group } from '../src/steps/04c-scenes'
import { scenesRequest, SCENES_TOOL_SCHEMA } from '../src/scenePrompt'
import { EMPTY_GLOSSARY, loadGlossary } from '../src/glossary'
import type { EditConverse } from '../src/prompts'
import type { Described } from '../src/steps/04-describe'

const fixture = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')) as Described[]
const sintel = fixture('sintel-90-150-r2.described.json'), tos = fixture('tears-of-steel-40-100.described.json')
const gSintel = loadGlossary('sintel-90-150-r2'), gTos = loadGlossary('tears-of-steel-40-100')
type Reply = Awaited<ReturnType<EditConverse>>
const toolReply = (scenes: unknown): EditConverse => async () => ({ output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 't', name: 'emit_scenes', input: { scenes } } }] } }, usage: { inputTokens: 900, outputTokens: 60 } }) as unknown as Reply
const fails: EditConverse = async () => { throw Object.assign(new Error('Model produced invalid sequence as part of ToolUse'), { name: 'ModelErrorException' }) }
const NO_GLOSSARY = [[0, 1, 'snowy mountains'], [2, 2, 'pit'], [3, 14, 'dark room']] // a stone pit is not a room; the model's grouping (or a glossary) joins them
const span = (s: { shots: number[] }) => `${s.shots[0]}–${s.shots.at(-1)}`

describe('scene grouping (DESC-029, 04c-scenes)', () => {
  it('the deterministic grouping splits on a change of place, not on cuts between people (Sintel r2, Tears of Steel)', () => {
    expect(fallbackScenes(sintel, gSintel)).toEqual([{ firstShot: 0, lastShot: 1, setting: 'the snowy mountains' }, { firstShot: 2, lastShot: 14, setting: 'the tent' }])
    expect(fallbackScenes(tos, gTos).map((g) => [g.firstShot, g.lastShot, g.setting])).toEqual([[0, 1, 'the canal bridge'], [2, 7, 'the lab'], [8, 8, 'the smoking city'], [9, 15, 'the hideout']])
    // without a glossary: place nouns only, labels from the descriptions' own words
    expect(fallbackScenes(sintel, EMPTY_GLOSSARY).map((g) => [g.firstShot, g.lastShot, g.setting])).toEqual(NO_GLOSSARY)
  })
  it('a time jump opens a scene ("Night.", "40 YEARS LATER")', () => {
    const sh = (index: number, description: string): Described => ({ index, startMs: index * 1000, endMs: index * 1000 + 1000, description, sameAsPrev: false, tokens: 0, outputTokens: 0 })
    expect(fallbackScenes([sh(0, 'A llama by a fence.'), sh(1, 'The llama stares.'), sh(2, 'Night.')], EMPTY_GLOSSARY).map((g) => [g.firstShot, g.lastShot])).toEqual([[0, 1], [2, 2]])
    expect(fallbackScenes([sh(0, 'A man on a bridge.'), sh(1, 'Words appear: 40 YEARS LATER.')], EMPTY_GLOSSARY).map((g) => g.firstShot)).toEqual([0, 1])
  })
  it('checks that the reply covers every shot once, in order', () => {
    const g = (a: number, b: number): Group => ({ firstShot: a, lastShot: b, setting: 'x' })
    const shots = [0, 1, 2, 3].map((index) => ({ index }))
    expect(checkScenes([g(0, 1), g(2, 3)], shots)).toBeUndefined()
    expect(checkScenes([g(0, 1), g(3, 3)], shots)).toMatch(/expected 2/)
    expect(checkScenes([g(0, 1), g(1, 3)], shots)).toMatch(/expected 2/)
    expect(checkScenes([g(0, 2)], shots)).toMatch(/after 2/)
    expect(checkScenes([g(0, 9)], shots)).toMatch(/unknown shot/)
    expect(checkScenes([], shots)).toBe('no scenes')
    expect(replyGroups('```json\n{"scenes":[{"firstShot":"0","lastShot":3,"setting":" tent "}]}\n```')).toEqual([{ firstShot: 0, lastShot: 3, setting: 'tent' }])
    expect(replyGroups('no')).toBeUndefined()
  })
  it('a setting label must use words of that scene\'s descriptions or the glossary places', () => {
    const tent = sintel.filter((s) => s.index >= 2)
    expect(groundLabel('tent interior', tent, EMPTY_GLOSSARY)).toEqual({ evidence: [{ word: 'tent', source: 'description', shot: 9 }, { word: 'interior', source: 'description', shot: 9 }], bad: [] })
    expect(groundLabel('the tent', tent.slice(0, 2), gSintel)).toEqual({ evidence: [{ word: 'tent', source: 'glossary', setting: 'the tent' }], bad: [] })
    expect(groundLabel('ship deck', tos.filter((s) => s.index >= 9 && s.index <= 15), EMPTY_GLOSSARY).bad).toEqual([]) // "Dim ship deck." is in shot 9's description
    expect(groundLabel('a castle', tent, gSintel).bad).toEqual(['castle'])
  })
  it('uses the model\'s grouping when it is valid; an ungrounded label falls back to the deterministic one', async () => {
    const r = await sceneGroups(sintel, gSintel, 'en', toolReply([{ firstShot: 0, lastShot: 1, setting: 'snowy mountains' }, { firstShot: 2, lastShot: 8, setting: 'a castle' }, { firstShot: 9, lastShot: 14, setting: 'tent interior' }]))
    expect(r.source).toBe('model')
    expect(r.scenes.map((s) => [span(s), s.setting, s.settingName, s.returning])).toEqual([['0–1', 'snowy mountains', 'the snowy mountains', false], ['2–8', 'the tent', 'the tent', false], ['9–14', 'tent interior', 'the tent', false]])
    expect(r.labels).toEqual([{ scene: 1, label: 'a castle', reason: 'not in its descriptions or the glossary: castle' }])
    expect(r.usage).toEqual({ inputTokens: 900, outputTokens: 60 })
    expect(sceneOf(r.scenes, 10)?.id).toBe(2)
  })
  it('marks a return to an earlier, not adjacent place', async () => {
    const r = await sceneGroups(tos, gTos, 'en', toolReply([{ firstShot: 0, lastShot: 1, setting: 'the canal bridge' }, { firstShot: 2, lastShot: 7, setting: 'the lab' }, { firstShot: 8, lastShot: 8, setting: 'the smoking city' }, { firstShot: 9, lastShot: 11, setting: 'the hideout' }, { firstShot: 12, lastShot: 12, setting: 'the smoking city' }, { firstShot: 13, lastShot: 15, setting: 'the hideout' }]))
    expect(r.scenes.map((s) => [span(s), s.returning])).toEqual([['0–1', false], ['2–7', false], ['8–8', false], ['9–11', false], ['12–12', true], ['13–15', true]])
  })
  it('falls back to the deterministic grouping when the reply is invalid, or both calls fail', async () => {
    const bad = await sceneGroups(sintel, gSintel, 'en', toolReply([{ firstShot: 0, lastShot: 3, setting: 'x' }]))
    expect(bad).toMatchObject({ source: 'fallback', reason: expect.stringMatching(/in no scene/) })
    expect(bad.scenes.map(span)).toEqual(['0–1', '2–14'])
    const sent: ConverseCommandInput[] = []
    const r = await sceneGroups(sintel, gSintel, 'en', async (i) => { sent.push(i); return fails(i) })
    expect(sent.map((i) => !!i.toolConfig)).toEqual([true, false]) // the forced tool, then plain JSON once
    expect(r).toMatchObject({ source: 'fallback', reason: expect.stringMatching(/json call failed/) })
    const ac = new AbortController(); ac.abort()
    await expect(sceneGroups(sintel, gSintel, 'en', fails, { signal: ac.signal })).rejects.toThrow()
  })
  it('caches a valid reply: a re-run makes no call', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scenes-'))
    let calls = 0
    const send: EditConverse = async (i) => { calls++; return toolReply([{ firstShot: 0, lastShot: 1, setting: 'snowy mountains' }, { firstShot: 2, lastShot: 14, setting: 'the tent' }])(i) }
    await sceneGroups(sintel, gSintel, 'en', send, { cacheDir: dir })
    const again = await sceneGroups(sintel, gSintel, 'en', send, { cacheDir: dir })
    expect(calls).toBe(1)
    expect(again).toMatchObject({ source: 'model', cached: true, usage: { inputTokens: 0, outputTokens: 0 } })
  })
  it('the request lists every shot and the glossary places, with a forced emit_scenes tool and greedy decoding', () => {
    const req = scenesRequest([{ shot: 0, start: 0, description: 'Snowy mountains.' }], gSintel.settings, 'en')
    expect(req.toolConfig?.toolChoice).toEqual({ tool: { name: 'emit_scenes' } })
    expect(req.toolConfig?.tools?.[0]?.toolSpec?.inputSchema?.json).toEqual(SCENES_TOOL_SCHEMA)
    expect(req.additionalModelRequestFields).toEqual({ inferenceConfig: { topK: 1 } })
    const text = (req.messages?.[0]?.content?.[0] as { text: string }).text
    expect(text).toContain('"places":[{"name":"the snowy mountains"')
    expect(req.system?.[0]).toMatchObject({ text: expect.stringContaining('taken only from the descriptions of that scene\'s shots or from the names of the listed places') })
  })
  it('groupScenes writes scenes.json and readScenes reads it back', async () => {
    const work = await mkdtemp(join(tmpdir(), 'scenes-work-'))
    await writeFile(`${work}/described.json`, JSON.stringify(sintel))
    await groupScenes({ slug: 'sintel-90-150-r2', source: '', language: 'en', voice: 'Joanna', work, glossary: gSintel }, fails)
    const file = JSON.parse(await readFile(`${work}/scenes.json`, 'utf8'))
    expect(file.source).toBe('fallback')
    expect((await readScenes(work))!.map(span)).toEqual(['0–1', '2–14'])
    expect(await readScenes(`${work}/none`)).toBeUndefined()
  })
})
