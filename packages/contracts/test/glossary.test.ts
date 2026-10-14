import { describe, expect, it } from 'vitest'
import { Character, Glossary, nameRevealed } from '../src/index'

describe('glossary (DESC-029)', () => {
  const emo = { name: 'Emo', look: 'a thin young man with short dark hair', role: 'the young man the old man leads', revealedAtS: 25.1, nameEvidence: 'Caption c3 "Emo," at 25.07 s' }
  it('parses characters and settings; both lists default to empty', () => {
    expect(Glossary.parse({})).toEqual({ characters: [], settings: [] })
    expect(Glossary.parse({ characters: [emo], settings: [{ name: 'the white chamber', look: 'a pale chamber of cables' }] }).settings[0]).toEqual({ name: 'the white chamber', look: 'a pale chamber of cables' })
    expect(() => Character.parse({ ...emo, look: '' })).toThrow()
    expect(Character.parse({ ...emo, revealedAtS: null }).revealedAtS).toBeNull()
  })
  it('reveals a name at revealedAtS (segment seconds), never when it is null; a negative time is before the segment', () => {
    expect(nameRevealed(emo, 25_000)).toBe(false)
    expect(nameRevealed(emo, 25_100)).toBe(true)
    expect(nameRevealed({ revealedAtS: -17 }, 0)).toBe(true)
    expect(nameRevealed({ revealedAtS: null }, 1e9)).toBe(false)
  })
})
