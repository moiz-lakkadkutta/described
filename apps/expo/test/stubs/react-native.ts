// Node stand-in for react-native in apps/expo tests (the kit's platform module imports it too, from its own copy).
export const linking = { initial: null as string | null, listeners: new Set<(e: { url: string }) => void>() }
export const Platform = { OS: 'android' }
export const appState = { listeners: new Set<(s: string) => void>(), emit(s: string) { for (const l of appState.listeners) l(s) } }
export const AppState = { addEventListener: (_: string, l: (s: string) => void) => { appState.listeners.add(l); return { remove: () => { appState.listeners.delete(l) } } } }
export const Linking = {
  getInitialURL: async () => linking.initial,
  addEventListener: (_: string, l: (e: { url: string }) => void) => { linking.listeners.add(l); return { remove: () => { linking.listeners.delete(l) } } },
}
export const emitter = { listeners: new Map<string, Set<(e: { keyCode: number }) => void>>(), emit(name: string, e: { keyCode: number }) { for (const l of emitter.listeners.get(name) ?? []) l(e) } }
export const DeviceEventEmitter = {
  addListener: (name: string, l: (e: { keyCode: number }) => void) => {
    const set = emitter.listeners.get(name) ?? new Set(); set.add(l); emitter.listeners.set(name, set)
    return { remove: () => { set.delete(l) } }
  },
}
