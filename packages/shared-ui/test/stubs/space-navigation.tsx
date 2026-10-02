import React from 'react'
// Each focusable renders as a 'FocusableView' host carrying its viewProps and handlers, so tests can read labels
// and fire onFocus/onSelect. `stub.focused` names the label that reports isFocused, so focus visuals render.
// Nodes render as 'Node' hosts; DefaultFocus as a host with `enable`; the lock records its state.
type Fn = () => void
type State = { isFocused: boolean; isActive: boolean; isRootActive: boolean }
export const stub: { focused?: string; locks: number; moves: string[] } = { locks: 0, moves: [] }
const render = (c: React.ReactNode | ((s: State) => React.ReactNode), isFocused = false) => (typeof c === 'function' ? c({ isFocused, isActive: false, isRootActive: true }) : c)
export const SpatialNavigationFocusableView = ({ children, viewProps, onSelect, onFocus, onBlur }: { children: React.ReactNode | ((s: State) => React.ReactNode); viewProps?: { 'aria-label'?: string }; onSelect?: Fn; onFocus?: Fn; onBlur?: Fn }) =>
  React.createElement('FocusableView', { ...viewProps, onSelect, onFocus, onBlur }, render(children, !!stub.focused && viewProps?.['aria-label'] === stub.focused))
export const SpatialNavigationNode = ({ children, orientation, onActive }: { children: React.ReactNode | ((s: State) => React.ReactNode); orientation?: string; onActive?: Fn }) =>
  React.createElement('Node', { orientation, onActive }, render(children))
export const SpatialNavigationScrollView = ({ children }: { children: React.ReactNode }) => React.createElement('ScrollView', null, children)
/** Subscribes to the configured remote while mounted, like the real root (useRemoteControl); moves go to stub.moves. */
export const SpatialNavigationRoot = ({ children }: { children: React.ReactNode }) => {
  React.useEffect(() => {
    const c = remote.config
    if (!c) return
    const handle = c.remoteControlSubscriber((d) => { if (d) stub.moves.push(d) })
    return () => c.remoteControlUnsubscriber(handle)
  }, [])
  return <>{children}</>
}
export const DefaultFocus = ({ children, enable = true }: { children: React.ReactNode; enable?: boolean }) => React.createElement('DefaultFocus', { enable }, children)
export const useLockSpatialNavigation = () => ({ lock: () => { stub.locks++ }, unlock: () => { stub.locks-- } })
export const remote: { config?: { remoteControlSubscriber: (cb: (d: string | null) => void) => unknown; remoteControlUnsubscriber: (s: unknown) => void } } = {}
export const SpatialNavigation = { configureRemoteControl: (c: typeof remote.config) => { remote.config = c } }
