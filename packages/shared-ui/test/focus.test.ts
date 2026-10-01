import { pickInitialFocus } from '../src/focus/memory'
import { configureRemote, setDpadGate, toDirection } from '../src/focus/remote'
import { addKeyHandler } from '../src/focus/keys'
import { remote } from './stubs/space-navigation'

describe('pickInitialFocus', () => {
  const ids = ['hero:playAd', 'hero:play', 'newly:sintel', 'all:bunny']
  it('restores the remembered id when it is still on screen', () => expect(pickInitialFocus('all:bunny', ids, 'hero:playAd')).toBe('all:bunny'))
  it('falls back when nothing is remembered', () => expect(pickInitialFocus(undefined, ids, 'hero:playAd')).toBe('hero:playAd'))
  it('falls back when the remembered element is gone', () => expect(pickInitialFocus('all:gone', ids, 'hero:playAd')).toBe('hero:playAd'))
  it('never restores a skeleton', () => expect(pickInitialFocus('all:skeleton-0', ids, 'hero:playAd')).toBe('hero:playAd'))
})

describe('remote → spatial navigation', () => {
  it('maps the D-pad and Select; ignores other keys', () => {
    expect(['up', 'down', 'left', 'right', 'select', 'back', 'menu', 'playPause'].map((k) => toDirection(k as never, () => true)))
      .toEqual(['up', 'down', 'left', 'right', 'enter', null, null, null])
  })
  it('the D-pad gate throttles moves; a held Select fires once', () => {
    expect(toDirection('right', () => false)).toBeNull()
    expect(toDirection('select', () => false)).toBe('enter')
    expect(toDirection('select', () => true, true)).toBeNull()
  })
  it('configureRemote subscribes the platform source and unsubscribes with its own handle', () => {
    let emit: (k: never) => void = () => {}
    const unsubscribe = vi.fn()
    configureRemote((onKey) => { emit = onKey as never; return unsubscribe })
    const moves: (string | null)[] = []
    const handle = remote.config!.remoteControlSubscriber((d) => moves.push(d))
    setDpadGate(() => true)
    emit('left' as never); emit('back' as never); emit('select' as never)
    expect(moves).toEqual(['left', 'enter'])
    remote.config!.remoteControlUnsubscriber(handle)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})

describe('key handlers (Settings ◄►)', () => {
  it('a handler that consumes a key keeps it from spatial navigation; removing it restores moves', () => {
    let emit: (k: never, repeat?: boolean) => void = () => {}
    configureRemote((onKey) => { emit = onKey as never; return () => {} })
    const moves: (string | null)[] = []
    remote.config!.remoteControlSubscriber((d) => moves.push(d))
    setDpadGate(() => true)
    const seen: [string, boolean][] = []
    const remove = addKeyHandler((k, repeat) => { seen.push([k, repeat]); return k === 'left' || k === 'right' })
    emit('right' as never); emit('right' as never, true); emit('down' as never)
    expect(moves).toEqual(['down'])
    expect(seen).toEqual([['right', false], ['right', true], ['down', false]])
    remove()
    emit('right' as never)
    expect(moves).toEqual(['down', 'right'])
  })
  it('the newest handler runs first', () => {
    const order: string[] = []
    const a = addKeyHandler(() => { order.push('a'); return false })
    const b = addKeyHandler(() => { order.push('b'); return true })
    configureRemote((onKey) => { onKey('left'); return () => {} })
    remote.config!.remoteControlSubscriber(() => {})
    expect(order).toEqual(['b'])
    a(); b()
  })
})
