// Node stand-in for react-native in apps/expo tests (the kit's platform module imports it too, from its own copy).
export const linking = { initial: null as string | null, listeners: new Set<(e: { url: string }) => void>() }
export const Platform = { OS: 'android' }
export const appState = { listeners: new Set<(s: string) => void>(), emit(s: string) { for (const l of appState.listeners) l(s) } }
export const AppState = { addEventListener: (_: string, l: (s: string) => void) => { appState.listeners.add(l); return { remove: () => { appState.listeners.delete(l) } } } }
export const Linking = {
  getInitialURL: async () => linking.initial,
  addEventListener: (_: string, l: (e: { url: string }) => void) => { linking.listeners.add(l); return { remove: () => { linking.listeners.delete(l) } } },
}
export const DeviceEventEmitter = { addListener: () => ({ remove() {} }) }
