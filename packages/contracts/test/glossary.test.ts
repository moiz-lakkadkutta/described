import { describe, expect, it } from 'vitest'
import { Character, Glossary, NameWindow, nameRevealed, nameWithheld } from '../src/index'

describe('glossary (DESC-029)', () => {
  const emo = { name: 'Emo', look: 'a thin young man with short dark hair', short: 'the thin young man', role: 'the young man the old man leads', revealedAtS: 25.1, nameEvidence: 'Caption c3 "Emo," at 25.07 s' }
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
  it('unnamedIn: optional ranges (fromS < toS, a reason) where the name is never used; a shot is in one when it overlaps it', () => {
    expect(Character.parse(emo).unnamedIn).toBeUndefined()
    const w = { fromS: 315, toS: 331, reason: "the horned dragon's swoop" }
    expect(Character.parse({ ...emo, unnamedIn: [w] }).unnamedIn).toEqual([w])
    expect(() => NameWindow.parse({ ...w, toS: 315 })).toThrow(/fromS must be before toS/)
    expect(() => NameWindow.parse({ fromS: 1, toS: 2, reason: '' })).toThrow()
    expect(() => Glossary.parse({ characters: [{ ...emo, unnamedIn: [{ fromS: 1, toS: 2 }] }] })).toThrow()
    const c = { unnamedIn: [w] }
    expect(nameWithheld(c, 314_999)).toBe(false)
    expect(nameWithheld(c, 315_000)).toBe(true)
    expect(nameWithheld(c, 331_000)).toBe(true)
    expect(nameWithheld(c, 331_001)).toBe(false)
    expect(nameWithheld(c, 312_625, 315_583)).toBe(true) // a shot that runs into the range
    expect(nameWithheld({}, 320_000)).toBe(false)
  })
})
