import { assign, loadGlossary, matchedCharacters, peopleAndPlaces, shortOf } from '../src/glossary'

/**
 * caminandes-35-95's glossary, checked against the frames (2026-10-15, published HLS, 2 fps over the whole segment): Koro is an
 * orange llama with ginger fur and a cream-white face with dark brown brows; there is no other animal. At 42–52 s Koro lies face
 * down by the tall electric fence, lifts himself up, then a close-up shows his orange fur under the wire. The earlier glossary look
 * ("a tan-and-white llama") did not match that, so the describer called him "the tan-and-white creature" and a reviewer of those
 * frames took the orange fur for a fox (as Qwen3-VL had: "an orange fox tumbles", docs/titles.md).
 */
const cam = loadGlossary('caminandes-35-95')
const koro = cam.characters.find((c) => c.name === 'Koro')!

describe('caminandes-35-95 glossary', () => {
  it('has one character, Koro, described by the colours on screen: orange, not tan-and-white', () => {
    expect(cam.characters.map((c) => c.name)).toEqual(['Koro'])
    expect(koro.look).toMatch(/\borange\b/)
    expect(koro.look).toMatch(/cream-white face/)
    expect(koro.look).not.toMatch(/tan/)
    expect(koro.revealedAtS).toBeNull()
    expect(shortOf(koro)).toBe('the llama')
    expect(peopleAndPlaces(cam, 45_000)).toContain('an orange llama with ginger fur')
  })
  it('binds an orange llama or an orange creature to Koro, and never gives Koro to a fox', () => {
    const llama = 'An orange llama with a cream-white face lies face down by the tall fence.' // 45 s
    const creature = 'The orange creature lifts itself up beside the fence.' // 49 s
    const fox = 'An orange fox tumbles and dashes past a rope.' // the earlier describe's reading of the same shots
    expect(assign('orange llama', cam, llama.toLowerCase())).toBe('Koro')
    expect(assign('orange creature', cam, creature.toLowerCase())).toBe('Koro')
    expect(assign('orange fox', cam, fox.toLowerCase())).toBeUndefined()
    expect([...matchedCharacters([llama], cam)]).toEqual(['Koro'])
    expect([...matchedCharacters([creature], cam)]).toEqual(['Koro'])
    expect([...matchedCharacters([fox], cam)]).toEqual([])
  })
})
