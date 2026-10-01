import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PromptKey, Voice, promptTextFor, promptTexts, voiceLanguage } from '../src/index'

const BLOCK = JSON.parse(readFileSync(path.resolve(__dirname, '../../../scripts/lint-words.mjs'), 'utf8').match(/const BLOCK = (\[.*?\])/)![1]!) as string[]
describe('prompt text', () => {
  it('every voice has a language and every key a text in it', () => {
    for (const v of Voice.options) for (const k of PromptKey.options) expect(promptTextFor(v, k).length, `${v} ${k}`).toBeGreaterThan(10)
  })
  it('German voices read German, English voices English', () => {
    expect(voiceLanguage.Vicki).toBe('de-DE'); expect(voiceLanguage.Daniel).toBe('de-DE')
    expect(promptTextFor('Vicki', 'firstRun2')).toBe(promptTexts['de-DE'].firstRun2)
    expect(promptTextFor('Joanna', 'firstRun2')).toBe(promptTexts['en-US'].firstRun2)
  })
  it('wording rules: no blocklisted word, German "Sie" (never du), no KI', () => {
    for (const t of [...Object.values(promptTexts['en-US']), ...Object.values(promptTexts['de-DE'])])
      for (const w of [...BLOCK, 'KI', 'aktivieren', 'deaktivieren']) expect(t, t).not.toMatch(new RegExp(`\\b${w}\\b`, 'i'))
    for (const t of Object.values(promptTexts['de-DE'])) expect(t, t).not.toMatch(/\b(du|dein|deine|dich|dir)\b/i)
    expect(promptTexts['de-DE'].firstRun2).toMatch(/\bSie\b/)
  })
})
