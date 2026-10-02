import { ANNOUNCE_DEBOUNCE_MS, _setScreenReader, announceFocus } from '../src/a11y'
import { a11yCalls } from './stubs/react-native'

describe('focus announcements', () => {
  beforeEach(() => { vi.useFakeTimers(); _setScreenReader(true) })
  afterEach(() => { vi.useRealTimers(); _setScreenReader(false) })
  it('holding ► speaks only where focus stops', () => {
    const at = { focused: '' }
    for (const name of ['Open A', 'Open B', 'Open C']) { at.focused = name; announceFocus(name, undefined, () => at.focused === name); vi.advanceTimersByTime(60) }
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS)
    expect(a11yCalls).toEqual(['Open C'])
  })
  it('says nothing if focus moved away before the delay', () => {
    let still = true
    announceFocus('Open A', 'Shows details', () => still)
    still = false
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS)
    expect(a11yCalls).toEqual([])
  })
  it('adds the hint; silent when no screen reader', () => {
    announceFocus('Hear a sample', 'Plays about 20 seconds', () => true)
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS)
    _setScreenReader(false)
    announceFocus('Play', undefined, () => true)
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS)
    expect(a11yCalls).toEqual(['Hear a sample. Plays about 20 seconds'])
  })
})
