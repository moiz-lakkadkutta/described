import React from 'react'
// Each focusable renders as a 'FocusableView' host carrying its viewProps and handlers, so tests can read labels
// and fire onFocus/onSelect. DefaultFocus renders as a host with `enable`.
type Fn = () => void
type State = { isFocused: boolean; isActive: boolean; isRootActive: boolean }
const state: State = { isFocused: false, isActive: false, isRootActive: true }
const render = (c: React.ReactNode | ((s: State) => React.ReactNode)) => (typeof c === 'function' ? c(state) : c)
export const SpatialNavigationFocusableView = ({ children, viewProps, onSelect, onFocus }: { children: React.ReactNode | ((s: State) => React.ReactNode); viewProps?: object; onSelect?: Fn; onFocus?: Fn }) =>
  React.createElement('FocusableView', { ...viewProps, onSelect, onFocus }, render(children))
export const SpatialNavigationNode = ({ children }: { children: React.ReactNode | ((s: State) => React.ReactNode) }) => <>{render(children)}</>
export const SpatialNavigationScrollView = ({ children }: { children: React.ReactNode }) => React.createElement('ScrollView', null, children)
export const SpatialNavigationRoot = ({ children }: { children: React.ReactNode }) => <>{children}</>
export const DefaultFocus = ({ children, enable = true }: { children: React.ReactNode; enable?: boolean }) => React.createElement('DefaultFocus', { enable }, children)
export const remote: { config?: { remoteControlSubscriber: (cb: (d: string | null) => void) => unknown; remoteControlUnsubscriber: (s: unknown) => void } } = {}
export const SpatialNavigation = { configureRemoteControl: (c: typeof remote.config) => { remote.config = c } }
