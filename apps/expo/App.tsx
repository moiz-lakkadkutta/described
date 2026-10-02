import React from 'react'
import { View } from 'react-native'
import { useFonts } from 'expo-font'
import { Root, configureRemote, tokens } from '@described/shared-ui'
import { keySource } from './src/remote'
import { prefetch, speak, stopSpeaking } from './src/audio'
import { deviceId } from './src/deviceId'
// Fire OS entry. Platform-specific wiring (fonts, keys, audio, IAP, camera) goes here, never in shared-ui.
configureRemote(keySource)
const id = deviceId()
export default function App() {
  // Family names must match tokens.type.*.family. On error, Root falls back to system sans at the same sizes.
  const [loaded, error] = useFonts({
    'AtkinsonHyperlegible-Regular': require('./assets/fonts/AtkinsonHyperlegible-Regular.ttf'),
    'AtkinsonHyperlegible-Bold': require('./assets/fonts/AtkinsonHyperlegible-Bold.ttf'),
  })
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: tokens.color.ground }} />
  return <Root apiBaseUrl={process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000'} scale={0.5} deviceId={id} fontsLoaded={loaded} speak={speak} stopSpeaking={stopSpeaking} prefetch={prefetch} />
}
