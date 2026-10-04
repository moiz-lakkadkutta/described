import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkMaster, validateWork, type ManifestProblems } from '../src/validate'

const fixture = (f: string) => join(__dirname, 'fixtures', f)
const master = () => readFile(fixture('master.m3u8'), 'utf8')
const BASE = 'https://cdn.invalid/published/sintel/master.m3u8'
const ALL = { captions: true, sdh: true, descriptions: true }

/** A work dir as 09-package leaves it: hls/master.m3u8, package.json and the three whole-file VTTs. */
async function workDir(masterText: string, tracks = ALL, vtt: Partial<Record<'captions.vtt' | 'sdh.vtt' | 'descriptions.vtt', string>> = {}) {
  const work = await mkdtemp(join(tmpdir(), 'validate-'))
  await mkdir(join(work, 'hls'))
  await writeFile(join(work, 'hls', 'master.m3u8'), masterText)
  await writeFile(join(work, 'package.json'), JSON.stringify({ language: 'en', tracks }))
  for (const f of ['captions.vtt', 'sdh.vtt', 'descriptions.vtt'] as const) {
    if (vtt[f] !== undefined) await writeFile(join(work, f), vtt[f]!)
    else await cp(fixture(`vtt/${f}`), join(work, f))
  }
  return work
}

describe('checkMaster', () => {
  it('checkMaster accepts the sintel master fixture with all three text tracks', async () => {
    expect(checkMaster(await master(), BASE, ALL)).toEqual([])
  })
  it('checkMaster reports a missing describes-video characteristic', async () => {
    const text = (await master()).replace(',CHARACTERISTICS="public.accessibility.describes-video"', '')
    const problems = checkMaster(text, BASE, ALL)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/public\.accessibility\.describes-video/)
  })
  it('checkMaster reports a Rich captions track that was not expected (degraded SDH)', async () => {
    const problems = checkMaster(await master(), BASE, { ...ALL, sdh: false })
    expect(problems).toEqual([expect.stringMatching(/Rich captions.*not expected/)])
  })
  it('checkMaster reports %20 in NAME', async () => {
    const problems = checkMaster((await master()).replace('NAME="Audio description"', 'NAME="Audio%20description"'), BASE, ALL)
    expect(problems).toEqual([expect.stringMatching(/%20.*Audio%20description/)])
  })
  it('reports an expected text track that is missing, and a master with the wrong number of audio renditions', async () => {
    const noDesc = (await master()).split('\n').filter((l) => !l.includes('descriptions.m3u8')).join('\n')
    expect(checkMaster(noDesc, BASE, ALL)).toEqual([expect.stringMatching(/descriptions.*missing/)])
    const oneAudio = (await master()).split('\n').filter((l) => !l.includes('audio_ad.m3u8')).join('\n')
    expect(checkMaster(oneAudio, BASE, ALL)).toEqual(expect.arrayContaining([expect.stringMatching(/2 audio renditions.*1/)]))
  })
  it('reports a playlist that does not parse instead of throwing', () => {
    expect(checkMaster('<html>', BASE, ALL)).toEqual([expect.stringMatching(/EXTM3U/)])
  })
})

describe('validateWork', () => {
  it('passes the fixture work dir and writes validate.json with the tracks and cue counts', async () => {
    const work = await workDir(await master())
    const r = await validateWork(work)
    expect(r).toEqual<ManifestProblems>({ problems: [], audio: ['Original', 'Audio description'], text: ['Captions', 'Rich captions', 'Description text'], vttCues: { 'captions.vtt': 2, 'sdh.vtt': 3, 'descriptions.vtt': 1 } })
    expect(JSON.parse(await readFile(join(work, 'validate.json'), 'utf8'))).toEqual(r)
  })
  it('allows a header-only VTT whose track is not advertised (0 cues)', async () => {
    const noDesc = (await master()).split('\n').filter((l) => !l.includes('descriptions.m3u8')).join('\n')
    const work = await workDir(noDesc, { ...ALL, descriptions: false }, { 'descriptions.vtt': 'WEBVTT\n\n' })
    expect((await validateWork(work)).vttCues['descriptions.vtt']).toBe(0)
  })
  it('validateWork throws listing every problem and writes validate.json with cue counts', async () => {
    const broken = (await master())
      .replace(',CHARACTERISTICS="public.accessibility.describes-video"', '')
      .replace('NAME="Rich captions"', 'NAME="Rich%20captions"')
    const work = await workDir(broken, ALL, { 'descriptions.vtt': 'WEBVTT\n\n', 'sdh.vtt': '1\n00:00:01.000 --> 00:00:02.000\nNo header.\n' })
    const err = await validateWork(work).then(() => null, (e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    const lines = err!.message.split('\n')
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringMatching(/describes-video/),
      expect.stringMatching(/%20/),
      expect.stringMatching(/descriptions\.vtt.*0 cues/),
      expect.stringMatching(/sdh\.vtt.*WEBVTT/),
    ]))
    expect(lines).toHaveLength(4)
    const written = JSON.parse(await readFile(join(work, 'validate.json'), 'utf8')) as ManifestProblems
    expect(written.problems).toEqual(lines)
    expect(written.vttCues).toEqual({ 'captions.vtt': 2, 'sdh.vtt': 1, 'descriptions.vtt': 0 })
  })
  it('reports an empty master playlist and a missing VTT as problems', async () => {
    const work = await workDir('')
    await rm(join(work, 'captions.vtt'))
    const err = await validateWork(work).then(() => null, (e: Error) => e)
    expect(err!.message).toMatch(/EXTM3U/)
    expect(err!.message).toMatch(/captions\.vtt.*missing/)
  })
})
