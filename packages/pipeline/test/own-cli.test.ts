import { PassThrough } from 'node:stream'
import { confirmOn, resolveInput } from '../src/own-cli'

describe('own-cli resolveInput', () => {
  it('resolves a relative path against INIT_CWD (where pnpm was typed), not packages/pipeline', () => {
    expect(resolveInput('film.mp4', { INIT_CWD: '/home/me/videos' }, '/repo/packages/pipeline')).toBe('/home/me/videos/film.mp4')
    expect(resolveInput('../a/film.mp4', { INIT_CWD: '/home/me/videos' }, '/x')).toBe('/home/me/a/film.mp4')
  })
  it('falls back to the process cwd, and leaves absolute paths and https URLs alone', () => {
    expect(resolveInput('film.mp4', {}, '/repo/packages/pipeline')).toBe('/repo/packages/pipeline/film.mp4')
    expect(resolveInput('/abs/film.mp4', { INIT_CWD: '/home' }, '/x')).toBe('/abs/film.mp4')
    expect(resolveInput('https://example.com/film.mp4', { INIT_CWD: '/home' }, '/x')).toBe('https://example.com/film.mp4')
  })
})

describe('own-cli confirmOn', () => {
  const tty = (answer: string) => { const input = Object.assign(new PassThrough(), { isTTY: true }); setTimeout(() => input.write(`${answer}\n`), 5); return input }
  it('outside a terminal it says no without asking, and tells you to add --yes', async () => {
    const out = new PassThrough()
    let text = ''
    out.on('data', (b) => { text += String(b) })
    const input = Object.assign(new PassThrough(), { isTTY: false })
    expect(await confirmOn(input, out)('Spend? ')).toBe(false)
    expect(text).toMatch(/--yes/)
    expect(text).not.toMatch(/Spend\?/)
  })
  it('in a terminal, y or yes is a yes; anything else, an empty line included, is a no', async () => {
    for (const [a, want] of [['y', true], ['YES', true], ['', false], ['n', false], ['sure', false]] as const) {
      expect(await confirmOn(tty(a), new PassThrough())('Spend? ')).toBe(want)
    }
  })
})
