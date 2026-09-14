// Vega-safe imports only. Anything with native code outside Amazon's supported list does not run on Vega.
export default [{
  files: ['src/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['react-native-video', '@amazon-devices/*', 'expo-camera', 'expo-av', 'react-native-webview', 'react-native-iap', '@react-native-async-storage/*'],
        message: 'Not allowed in shared-ui. Use @moizp/vega-media-kit (player/platform) or put platform code in apps/expo or apps/vega.'
      }]
    }]
  }
}]
