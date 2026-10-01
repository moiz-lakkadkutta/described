import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { strings } from '../src/strings'
import { homeModel, titleModel } from '../src/models'
import { tokens } from '../src/theme/tokens'
import { catalog, title } from './fixtures'

const src = path.resolve(__dirname, '../src')
const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) ? [p] : [] })
const BLOCK = JSON.parse(readFileSync(path.resolve(__dirname, '../../../scripts/lint-words.mjs'), 'utf8').match(/const BLOCK = (\[.*?\])/)![1]!) as string[]

/** Every string the copy table can produce (functions called with sample arguments). */
function copy(v: unknown): string[] {
  if (typeof v === 'string') return [v]
  if (typeof v === 'function') return copy((v as (...a: unknown[]) => unknown)('Sintel', 'Joanna'))
  if (v && typeof v === 'object') return Object.values(v).flatMap(copy)
  return []
}

describe('wording (decision 0002)', () => {
  const all = [
    ...copy(strings),
    ...homeModel(catalog, new Set()).actions.flatMap((a) => [a.text, a.label]),
    ...homeModel(catalog, new Set()).rows.flatMap((r) => [r.label, ...r.cards.map((c) => c.label)]),
    ...titleModel(title, { sample: 'idle', inList: true, captionKind: 'captions' }).actions.flatMap((a) => [a.text, a.label, a.hint ?? '']),
  ]
  it.each(BLOCK)('never says "%s"', (w) => { for (const s of all) expect(s, s).not.toMatch(new RegExp(`\\b${w}\\b`, 'i')) })
  it('only the label role is all-caps; no copy is written in capitals', () => { for (const s of all) expect(s === s.toUpperCase() && /[A-Z]{4,}/.test(s), s).toBe(false) })
})

describe('tokens are the only source of colour', () => {
  const colour = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(|['"](black|white|red|green|blue|gray|grey|yellow|orange)['"]/i
  it.each(files(src).filter((f) => !f.includes(`${path.sep}theme${path.sep}`)).map((f) => [path.relative(src, f), f]))('%s', (_, f) => {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => expect(colour.test(line), `${f}:${i + 1}: ${line.trim()}`).toBe(false))
  })
})

describe('platform wiring', () => {
  it('every token font family ships as a TTF in apps/expo (expo-font names must match)', () => {
    for (const fam of new Set(Object.values(tokens.type).flatMap((t) => (typeof t === 'object' ? [t.family] : []))))
      expect(existsSync(path.resolve(__dirname, `../../../apps/expo/assets/fonts/${fam}.ttf`)), fam).toBe(true)
  })
  it('shared-ui imports no native module outside the Vega-supported list', () => {
    const allowed = /^(react|react-native|react-tv-space-navigation|@moizp\/vega-media-kit(\/\w+)?|@described\/contracts)$/
    for (const f of files(src)) for (const m of readFileSync(f, 'utf8').matchAll(/from '([^.][^']*)'/g)) expect(m[1], f).toMatch(allowed)
  })
})
