import Module, { createRequire } from 'node:module'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'

// Every other test swaps react-tv-space-navigation for test/stubs. This one loads the REAL published dist with this
// package's React 19, as Metro does in a release build. The library is webpack-bundled with its own copy of
// react/jsx-runtime: 5.2.0 embeds React 18's, which reads React internals that React 19 removed
// (`TypeError: Cannot read property 'ReactCurrentOwner' of undefined`), and the Fire OS app died at startup.
// react-native itself can't load under Node, so only that import is replaced, by host-string components.
const require = createRequire(import.meta.url)
const host = (name: string) => name
const rn: Record<string, unknown> = {
  Platform: { OS: 'android', isTV: true, select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { create: <T>(s: T) => s, flatten: (s: unknown) => s, absoluteFillObject: {} },
  Dimensions: { get: () => ({ width: 1920, height: 1080 }), addEventListener: () => ({ remove() {} }) },
  Animated: { View: 'Animated.View', Value: class { setValue() {} }, timing: () => ({ start() {} }) },
}
const reactNative = new Proxy(rn, { get: (t, k: string) => (k in t ? t[k] : /^[A-Z]/.test(k) ? host(k) : undefined) })

type Lib = Record<string, unknown> & {
  SpatialNavigationRoot: React.ComponentType<{ children: React.ReactNode }>
  SpatialNavigationFocusableView: React.ComponentType<{ children?: React.ReactNode; viewProps?: object }>
  SpatialNavigation: { configureRemoteControl: (c: object) => void }
}
function loadReal(): Lib {
  const m = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown }
  const original = m._load
  m._load = function (req: string, ...rest: unknown[]) {
    if (req === 'react-native') return reactNative
    if (req === 'react') return React // the same React 19 the screens use
    return original.call(this, req, ...rest)
  }
  try { return require('react-tv-space-navigation') as Lib } finally { m._load = original }
}

describe('react-tv-space-navigation (real dist, React 19)', () => {
  it('runs under React 19 (no embedded React 18 runtime)', () => {
    expect(React.version).toMatch(/^19\./)
    expect(loadReal).not.toThrow()
  })

  it('exports everything shared-ui imports from it', () => {
    const lib = loadReal()
    for (const name of ['SpatialNavigationRoot', 'SpatialNavigationNode', 'SpatialNavigationFocusableView', 'SpatialNavigationScrollView', 'DefaultFocus', 'useLockSpatialNavigation', 'SpatialNavigation'])
      expect(lib[name], name).toBeDefined()
    expect(typeof lib.SpatialNavigation.configureRemoteControl).toBe('function')
  })

  it('renders a focusable inside the root through its own jsx runtime', () => {
    const lib = loadReal()
    lib.SpatialNavigation.configureRemoteControl({ remoteControlSubscriber: () => 1, remoteControlUnsubscriber: () => {} })
    let r!: TestRenderer.ReactTestRenderer
    act(() => {
      r = TestRenderer.create(
        React.createElement(lib.SpatialNavigationRoot, null,
          React.createElement(lib.SpatialNavigationFocusableView, { viewProps: { 'aria-label': 'Play' } }, React.createElement('Text', null, 'Play'))),
      )
    })
    expect(JSON.stringify(r.toJSON())).toContain('Play')
    act(() => r.unmount())
  })
})
