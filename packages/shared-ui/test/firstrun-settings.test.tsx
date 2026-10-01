import React, { useState } from 'react'
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer'
import { promptText, type Prefs } from '@described/contracts'
import { Root } from '../src/index'
import { _setScreenReader } from '../src/a11y'
import { interceptKey } from '../src/focus/keys'
import { About } from '../src/screens/About'
import { FirstRun } from '../src/screens/FirstRun'
import { Home } from '../src/screens/Home'
import { Settings, settingsRows } from '../src/screens/Settings'
import { Title } from '../src/screens/Title'
import { strings } from '../src/strings'
import { tokens } from '../src/theme/tokens'
import { a11yCalls, back } from './stubs/react-native'
import { catalog, title } from './fixtures'

const basePrefs: Prefs = { adDefault: true, extendedMode: true, voice: 'Joanna', captionKind: 'sdh', captionScale: 100, captionStyle: 'box', firstRunDone: true }
const ok = (data: unknown) => Promise.resolve({ json: async () => ({ success: true, data }) } as Response)
const about = { titles: [{ name: 'Sintel', attribution: title.attribution }] }
/** Fetch routed by path; records every PUT /me/prefs body in order. */
function api(prefs: Partial<Prefs> = {}) {
  const state = { puts: [] as Partial<Prefs>[], aboutDown: false, putDown: false, down: false, served: { ...basePrefs, ...prefs } }
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace('http://api', '')
    if (state.down) return Promise.reject(new Error('network'))
    if (path === '/me/prefs' && init?.method === 'PUT') {
      if (state.putDown) return Promise.reject(new Error('network'))
      state.puts.push(JSON.parse(String(init.body))); return ok({})
    }
    if (path === '/catalog') return ok(catalog)
    if (path === '/me/prefs') return ok(state.served)
    if (path === '/about') return state.aboutDown ? Promise.reject(new Error('network')) : ok(about)
    if (path.startsWith('/titles/')) return ok(title)
    return ok({})
  }))
  return state
}
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
const focusables = (r: TestRenderer.ReactTestRenderer) => r.root.findAll((n) => (n.type as unknown) === 'FocusableView')
const label = (n: ReactTestInstance) => n.props['aria-label'] as string
const labels = (r: TestRenderer.ReactTestRenderer) => focusables(r).map(label)
const find = (r: TestRenderer.ReactTestRenderer, l: string) => focusables(r).find((n) => label(n).startsWith(l))!
const press = (r: TestRenderer.ReactTestRenderer, l: string) => act(() => find(r, l).props.onSelect())
const focus = (r: TestRenderer.ReactTestRenderer, l: string) => act(() => find(r, l).props.onFocus())
const key = (k: 'left' | 'right', repeat = false) => { let consumed = false; act(() => { consumed = interceptKey(k, repeat) }); return consumed }
const text = (r: TestRenderer.ReactTestRenderer) => JSON.stringify(r.toJSON())
const defaults = (r: TestRenderer.ReactTestRenderer) => r.root.findAll((n) => (n.type as unknown) === 'DefaultFocus' && n.props.enable === true).map((d) => label(d.findByType('FocusableView' as never)))
const mounted: TestRenderer.ReactTestRenderer[] = []
function create(el: React.ReactElement) {
  let r!: TestRenderer.ReactTestRenderer
  act(() => { r = TestRenderer.create(el) })
  mounted.push(r)
  return r
}
async function mount(props: Partial<React.ComponentProps<typeof Root>> = {}) {
  const r = create(<Root apiBaseUrl="http://api" scale={0.5} {...props} />)
  await flush()
  return r
}
afterEach(() => { mounted.splice(0).forEach((r) => act(() => r.unmount())); vi.unstubAllGlobals(); _setScreenReader(false) })
const P = strings.firstRun.panels

describe('first run', () => {
  it('shows for a new profile; each panel is spoken in the app voice and announced', async () => {
    api({ firstRunDone: false }); const speak = vi.fn(async () => {})
    const r = await mount({ speak })
    expect(text(r)).toContain(P[0]!.title)
    expect(labels(r)).toEqual(['Next tip'])
    expect(speak).toHaveBeenLastCalledWith('http://api/prompts/Joanna/firstRun1.mp3')
    expect(a11yCalls).toContain(promptText.firstRun1)
    press(r, 'Next tip')
    expect(text(r)).toContain(promptText.firstRun2)
    expect(speak).toHaveBeenLastCalledWith('http://api/prompts/Joanna/firstRun2.mp3')
    expect(a11yCalls.at(-1)).toBe(`${promptText.firstRun2} Next tip. ${P[1]!.hint}`)
  })

  it('panel text on screen is exactly the spoken prompt', () => {
    for (const p of P) expect([p.title, p.body].filter(Boolean).join(' ')).toBe(promptText[p.key])
  })

  it('Select advances; Back goes back; Back never leaves the app', async () => {
    api({ firstRunDone: false }); const r = await mount()
    press(r, 'Next tip'); press(r, 'Next tip')
    expect(labels(r)).toEqual(['Keep extended mode on', 'Turn extended mode off'])
    act(() => { expect(back.press()).toBe(true) })
    expect(text(r)).toContain(promptText.firstRun2)
    act(() => { expect(back.press()).toBe(true) })
    expect(text(r)).toContain(P[0]!.title)
  })

  it('Back-Back on panel 1 skips: armed first (shown and announced), then done; extended mode untouched', async () => {
    const s = api({ firstRunDone: false }); const r = await mount()
    act(() => { back.press() })
    expect(text(r)).toContain(strings.firstRun.skipArmed)
    expect(a11yCalls).toContain(strings.firstRun.skipArmed)
    expect(s.puts).toEqual([])
    act(() => { back.press() }); await flush()
    expect(s.puts).toEqual([{ firstRunDone: true }])
    expect(text(r)).toContain(strings.home.newly.toUpperCase())
  })

  it('Select after one Back disarms the skip', async () => {
    const s = api({ firstRunDone: false }); const r = await mount()
    act(() => { back.press() }); press(r, 'Next tip')
    expect(text(r)).not.toContain(strings.firstRun.skipArmed)
    act(() => { back.press() }) // panel 2 → panel 1, not a skip
    expect(text(r)).toContain(P[0]!.title)
    await flush(); expect(s.puts).toEqual([])
  })

  it.each([['Keep extended mode on', true], ['Turn extended mode off', false]])('%s persists the choice and completion', async (choice, ext) => {
    const s = api({ firstRunDone: false }); const r = await mount()
    press(r, 'Next tip'); press(r, 'Next tip'); press(r, choice as string); await flush()
    expect(s.puts).toEqual([{ extendedMode: ext, firstRunDone: true }])
    expect(text(r)).toContain(strings.home.newly.toUpperCase())
  })

  it('never shown again once done', async () => {
    api({ firstRunDone: true }); const speak = vi.fn(async () => {})
    const r = await mount({ speak })
    expect(text(r)).not.toContain(P[0]!.title)
    expect(speak).not.toHaveBeenCalled()
  })

  it('with VoiceView on the text is announced and no clip plays over it', async () => {
    _setScreenReader(true)
    api({ firstRunDone: false }); const speak = vi.fn(async () => {})
    await mount({ speak })
    expect(a11yCalls).toContain(promptText.firstRun1)
    expect(speak).not.toHaveBeenCalled()
  })

  it('Settings → Show the introduction again: resets, shows it now, returns to Settings', async () => {
    const s = api(); const r = await mount()
    press(r, 'Go to Settings')
    focus(r, strings.settings.reset); press(r, strings.settings.reset); await flush()
    expect(s.puts).toEqual([{ firstRunDone: false }])
    expect(text(r)).toContain(P[0]!.title)
    press(r, 'Next tip'); press(r, 'Next tip'); press(r, 'Keep extended mode on'); await flush()
    expect(s.puts.at(-1)).toEqual({ extendedMode: true, firstRunDone: true })
    expect(labels(r)).toContain(strings.a11y.setting(strings.settings.voice, 'Joanna'))
    expect(defaults(r)).toEqual([strings.settings.reset]) // focus memory: back on the row you pressed
  })
})

/** Settings with real state, as Root holds it. */
function Harness({ initial = basePrefs, onChange = () => {}, onHearVoice = () => {} }: { initial?: Prefs; onChange?: (p: Partial<Prefs>) => void; onHearVoice?: (v: Prefs['voice']) => void }) {
  const [prefs, setPrefs] = useState(initial)
  return <Settings prefs={prefs} onChange={(p) => { onChange(p); setPrefs((c) => ({ ...c, ...p })) }} onHearVoice={onHearVoice} onResetFirstRun={() => {}} onAbout={() => {}} />
}
const S = strings.settings
const row = (r: TestRenderer.ReactTestRenderer, id: string) => focusables(r).find((n) => n.props.testID === `settings:${id}`)!
const value = (r: TestRenderer.ReactTestRenderer, id: string) => row(r, id).props.accessibilityValue?.text as string

describe('settings', () => {
  it('rows in spec order, first row focused', () => {
    const r = create(<Harness />)
    expect(focusables(r).map((n) => n.props.testID)).toEqual(['adDefault', 'voice', 'hearIt', 'extended', 'capSize', 'capStyle', 'reset', 'about'].map((id) => `settings:${id}`))
    expect(defaults(r)).toEqual([`${S.adDefault}: On`])
  })

  it.each([
    ['adDefault', ['Off', 'On']],
    ['voice', ['Daniel', 'Matthew', 'Vicki', 'Joanna']],
    ['extended', ['Off', 'On']],
    ['capSize', ['125%', '150%', '200%', '100%']],
    ['capStyle', ['Shadow', 'Box']],
  ])('%s: ► steps forward and wraps, ◄ steps back, each change announced', (id, seq) => {
    const r = create(<Harness />)
    const start = value(r, id)
    act(() => row(r, id).props.onFocus())
    for (const v of seq) {
      expect(key('right')).toBe(true)
      expect(value(r, id)).toBe(v)
      expect(a11yCalls.at(-1)).toMatch(new RegExp(`: ${v}$`))
    }
    expect(value(r, id)).toBe(start)
    key('left')
    expect(value(r, id)).toBe(seq.at(-2))
  })

  it('Select steps forward too; the label carries the new value', () => {
    const r = create(<Harness />)
    press(r, `${S.capSize}:`)
    expect(labels(r)).toContain(`${S.capSize}: 125%`)
    expect(a11yCalls.at(-1)).toBe(`${S.capSize}: 125%`)
  })

  it('a held key changes the value once; keys pass through when no value row has focus', () => {
    const onChange = vi.fn()
    const r = create(<Harness onChange={onChange} />)
    expect(key('left')).toBe(false) // nothing focused yet: ◄ may open the rail
    focus(r, `${S.voice}:`)
    key('right'); expect(key('right', true)).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(1)
    focus(r, strings.a11y.hearVoice('Daniel'))
    expect(key('left')).toBe(false) // action row: ◄ reaches the rail
    act(() => find(r, strings.a11y.hearVoice('Daniel')).props.onBlur())
    expect(key('right')).toBe(false)
  })

  it('Hear it plays the selected voice', () => {
    const onHearVoice = vi.fn()
    const r = create(<Harness onHearVoice={onHearVoice} />)
    focus(r, `${S.voice}:`); key('left')
    press(r, strings.a11y.hearVoice('Vicki'))
    expect(onHearVoice).toHaveBeenCalledWith('Vicki')
  })

  it('stops taking keys when it unmounts', () => {
    const r = create(<Harness />)
    focus(r, `${S.voice}:`)
    act(() => r.unmount()); mounted.pop()
    expect(key('right')).toBe(false)
  })
})

describe('settings in Root: saved and spoken', () => {
  it('◄► changes apply at once; PUTs go one at a time and the last one carries the latest value', async () => {
    const s = api(); const r = await mount()
    press(r, 'Go to Settings')
    focus(r, `${S.capSize}:`)
    key('right'); key('right'); key('left')
    await flush()
    expect(s.puts.at(-1)).toEqual({ captionScale: 125 })
    expect(value(r, 'capSize')).toBe('125%')
    key('right'); await flush()
    expect(s.puts.at(-1)).toEqual({ captionScale: 150 })
  })

  it('a failed save is announced once, kept, and sent with the next save', async () => {
    const s = api(); const r = await mount()
    press(r, 'Go to Settings')
    s.putDown = true
    focus(r, `${S.capSize}:`); key('right'); await flush()
    expect(a11yCalls.filter((c) => c === strings.a11y.notSaved)).toHaveLength(1)
    focus(r, `${S.capStyle}:`); key('right'); await flush()
    expect(a11yCalls.filter((c) => c === strings.a11y.notSaved)).toHaveLength(1) // once per outage
    expect(value(r, 'capSize')).toBe('125%') // the screen keeps your change
    s.putDown = false
    focus(r, `${S.voice}:`); key('right'); await flush()
    expect(s.puts).toEqual([{ captionScale: 125, captionStyle: 'shadow', voice: 'Daniel' }])
    key('right'); await flush()
    expect(s.puts.at(-1)).toEqual({ voice: 'Matthew' }) // saved changes are not sent again
  })

  it('unsaved changes go out on the next successful request', async () => {
    const s = api(); const r = await mount()
    press(r, 'Go to Settings')
    s.putDown = true
    focus(r, `${S.capSize}:`); key('right'); await flush()
    s.putDown = false
    press(r, 'Go to Home'); press(r, 'Open Sintel'); await flush() // GET /titles succeeds
    expect(s.puts).toEqual([{ captionScale: 125 }])
  })

  it('Retry refetches prefs, lays unsaved changes over them, and saves them', async () => {
    const s = api(); const r = await mount()
    press(r, 'Go to Settings')
    s.down = true
    focus(r, `${S.capStyle}:`); key('right'); await flush()
    press(r, 'Go to Home'); press(r, 'Open Sintel'); await flush() // offline screen
    s.down = false
    press(r, strings.a11y.retry); await flush()
    expect(s.puts).toEqual([{ captionStyle: 'shadow' }])
    press(r, 'Go to Settings')
    expect(value(r, 'capStyle')).toBe('Shadow') // not replaced by the server's stale 'box'
  })

  it('Hear it speaks the voice preview clip', async () => {
    api(); const speak = vi.fn(async () => {}); const r = await mount({ speak })
    press(r, 'Go to Settings')
    focus(r, `${S.voice}:`); key('right')
    press(r, strings.a11y.hearVoice('Daniel'))
    expect(speak).toHaveBeenCalledWith('http://api/prompts/Daniel/voicePreview.mp3')
  })

  it('Description on by default: off makes Play (without description) the primary action on Home', async () => {
    api(); const r = await mount()
    expect(defaults(r)).toEqual(['Play Sintel with audio description'])
    press(r, 'Go to Settings')
    press(r, `${S.adDefault}:`); await flush()
    press(r, 'Go to Home')
    expect(defaults(r)).toEqual(['Play Sintel without description'])
  })

  it('About: attribution sentences then licenses; Back returns to Settings on the About row', async () => {
    api(); const r = await mount()
    press(r, 'Go to Settings'); focus(r, strings.a11y.about); press(r, strings.a11y.about); await flush()
    expect(labels(r).filter((l) => !l.startsWith('Go to'))).toEqual([title.attribution, ...strings.about.licenses, strings.a11y.closeAbout])
    expect(defaults(r)).toEqual([title.attribution])
    act(() => { expect(back.press()).toBe(true) })
    expect(defaults(r)).toEqual([strings.a11y.about])
  })

  it('About offline: says so, still lists the licenses', async () => {
    const s = api(); s.aboutDown = true; const r = await mount()
    press(r, 'Go to Settings'); press(r, strings.a11y.about); await flush()
    expect(text(r)).toContain('film credits are missing')
    expect(defaults(r)).toEqual([strings.about.licenses[0]])
  })
})

describe('adDefault (decision: picks the primary play action and initial focus)', () => {
  const noop = () => {}
  it('Home hero', () => {
    const r = create(<Home catalog={catalog} myList={new Set()} adDefault={false} onOpen={noop} onPlay={noop} onToggleList={noop} />)
    expect(defaults(r)).toEqual(['Play Sintel without description'])
    expect(text(r)).toContain(`▶ ${strings.home.play}`)
    expect(text(r)).not.toContain(`▶ ${strings.home.playWithAd}`)
  })
  it('Title', () => {
    const r = create(<Title title={title} adDefault={false} captionKind="sdh" inList={false} sample="idle" onPlay={noop} onSample={noop} onCaptions={noop} onToggleList={noop} onMore={noop} />)
    expect(defaults(r)).toEqual(['Play Sintel without description'])
    expect(text(r)).toContain(`▶ ${strings.title.playWithout}`)
  })
})

describe('every focusable on First run, Settings and About states its purpose and role', () => {
  const check = (r: TestRenderer.ReactTestRenderer) => {
    const f = focusables(r)
    expect(f.length).toBeGreaterThan(0)
    expect(new Set(f.map(label)).size, 'labels are unique on a screen').toBe(f.length)
    for (const n of f) {
      expect(label(n)?.trim().length, label(n)).toBeGreaterThan(3)
      expect(label(n)).not.toMatch(/^(button|next|ok|focusable)$/i)
      expect(['button', 'adjustable', 'text'], label(n)).toContain(n.props.accessibilityRole)
      if (n.props.accessibilityRole === 'adjustable') {
        expect(n.props.accessibilityHint, label(n)).toBe(strings.a11y.settingHint)
        expect(label(n)).toContain(n.props.accessibilityValue.text)
      }
    }
    return f
  }
  it.each([0, 1, 2])('First run panel %i', (i) => {
    const r = create(<FirstRun speakPrompt={() => {}} onDone={() => {}} onSkip={() => {}} />)
    for (let k = 0; k < i; k++) press(r, 'Next tip')
    for (const n of check(r)) expect(n.props.accessibilityHint, label(n)).toBeTruthy()
  })
  it('Settings (every value of every row)', () => {
    const r = create(<Harness />)
    check(r)
    for (const row of settingsRows({ prefs: basePrefs, onHearVoice: () => {}, onResetFirstRun: () => {}, onAbout: () => {} }).filter((x) => x.step)) {
      act(() => focusables(r).find((n) => n.props.testID === `settings:${row.id}`)!.props.onFocus())
      for (let k = 0; k < 4; k++) { key('right'); check(r) }
    }
  })
  it.each([['loaded', about], ['offline', 'offline' as const]])('About (%s)', (_, data) => { check(create(<About about={data} onClose={() => {}} />)) })
  it('About while loading has nothing focusable', () => {
    expect(focusables(create(<About about={null} onClose={() => {}} />))).toHaveLength(0)
  })
  it('first-run and settings text never drops below the 28 px floor', () => {
    const sizes = [create(<Harness />), create(<FirstRun speakPrompt={() => {}} onDone={() => {}} onSkip={() => {}} />), create(<About about={about} onClose={() => {}} />)]
      .flatMap((r) => r.root.findAll((n) => (n.type as unknown) === 'Text').map((t) => Object.assign({}, ...[t.props.style].flat(3).filter(Boolean)).fontSize as number))
    expect(sizes.length).toBeGreaterThan(10)
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(tokens.type.floor)
  })
})
