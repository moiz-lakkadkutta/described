// Node stand-in for react-native in apps/expo tests (the kit's platform module imports it too, from its own copy).
export const linking = { initial: null as string | null, listeners: new Set<(e: { url: string }) => void>() }
export const Platform = { OS: 'android' }
export const Linking = {
  getInitialURL: async () => linking.initial,
  addEventListener: (_: string, l: (e: { url: string }) => void) => { linking.listeners.add(l); return { remove: () => { linking.listeners.delete(l) } } },
}
export const DeviceEventEmitter = { addListener: () => ({ remove() {} }) }
