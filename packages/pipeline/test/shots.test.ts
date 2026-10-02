import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { detectShots } from '../src/steps/02-shots'
import type { Ctx } from '../src/steps/index'

vi.mock('execa', () => ({ execa: vi.fn(async () => ({ stderr: 'pts_time:4.2\npts_time:20.0\n', stdout: '' })) }))

describe('detectShots', () => {
  it('runs one scene-detect ffmpeg pass and writes shots.json, no per-shot clips', async () => {
    const work = await mkdtemp(join(tmpdir(), 'shots-'))
    await writeFile(join(work, 'probe.json'), JSON.stringify({ format: { duration: '30.0' } }))
    await detectShots({ work } as unknown as Ctx)
    expect(vi.mocked(execa)).toHaveBeenCalledTimes(1)
    const shots = JSON.parse(await readFile(join(work, 'shots.json'), 'utf8')) as Array<{ startMs: number; endMs: number }>
    expect(shots[0]!.startMs).toBe(0)
    expect(shots.at(-1)!.endMs).toBe(30000)
    expect((await readdir(work)).sort()).toEqual(['probe.json', 'shots.json'])
  })
})
