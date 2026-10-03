import React from 'react'
import { View } from 'react-native'
import { useFonts } from 'expo-font'
import { Root, configurePlatform, configureRemote, tokens } from '@described/shared-ui'
import { keySource, setKeySkip } from './src/remote'
import { prefetch, speak, stopSpeaking } from './src/audio'
import { deviceId } from './src/deviceId'
import { launchSource } from './src/platform/launch'
import { createMediaSession, keySkipFor } from './src/platform/mediaSession'
import { nativeMediaSession } from './src/platform/nativeMediaSession'
import { playbackReporter } from './src/platform/personalization'
// Fire OS entry. Platform-specific wiring (fonts, keys, audio, IAP, camera) goes here, never in shared-ui.
configureRemote(keySource)
// DESC-008: Alexa transport through the media session, watch activity (no-op until Fire TV catalog integration).
const mediaSession = createMediaSession(nativeMediaSession)
setKeySkip(keySkipFor(mediaSession)) // one path per media key; MEDIA_SESSION_OWNS_KEYS is the device-check switch
configurePlatform({ mediaSession, reporter: playbackReporter })
const id = deviceId()
export default function App() {
  // Family names must match tokens.type.*.family. On error, Root falls back to system sans at the same sizes.
  const [loaded, error] = useFonts({
    'AtkinsonHyperlegible-Regular': require('./assets/fonts/AtkinsonHyperlegible-Regular.ttf'),
    'AtkinsonHyperlegible-Bold': require('./assets/fonts/AtkinsonHyperlegible-Bold.ttf'),
  })
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: tokens.color.ground }} />
  return <Root apiBaseUrl={process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000'} scale={0.5} deviceId={id} fontsLoaded={loaded} speak={speak} stopSpeaking={stopSpeaking} prefetch={prefetch} launches={launchSource} />
}
