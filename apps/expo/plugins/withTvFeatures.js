// Declares the hardware a TV does not have as optional, so the Amazon Appstore lists the app for Fire TV.
// https://developer.amazon.com/docs/app-submission/device-filtering-and-compatibility.html "Device filtering for Fire TV
//   devices": "you must declare this android.hardware.touchscreen attribute to be false for the Appstore to classify your
//   app as compatible with Fire TV devices."
// https://developer.amazon.com/docs/app-submission/supported-filters-on-the-amazon-appstore.html (<uses-feature> filters)
// https://developer.android.com/training/tv/get-started/create "Declare hardware requirements for TV": touchscreen and
//   faketouch are implied required unless declared otherwise; android.software.leanback required="false" keeps the APK
//   installable on devices that are not TVs.
// The microphone is declared optional as well: the app never records (RECORD_AUDIO is blocked in app.json), and voice
// commands reach it through Fire TV's MediaSession, not the app's own microphone.
const { withAndroidManifest } = require('expo/config-plugins')

const FEATURES = [
  'android.hardware.touchscreen',
  'android.hardware.faketouch',
  'android.hardware.microphone',
  'android.software.leanback',
]

/** Pure transform of the parsed manifest (xml2js shape), exported for tests. Each feature once, required="false". */
function patch(manifest) {
  const m = manifest.manifest
  m['uses-feature'] = m['uses-feature'] || []
  for (const name of FEATURES) {
    const found = m['uses-feature'].find((f) => f.$ && f.$['android:name'] === name)
    if (found) found.$['android:required'] = 'false'
    else m['uses-feature'].push({ $: { 'android:name': name, 'android:required': 'false' } })
  }
  return manifest
}

function withTvFeatures(config) {
  return withAndroidManifest(config, (c) => {
    c.modResults = patch(c.modResults)
    return c
  })
}
module.exports = withTvFeatures
module.exports.patch = patch
module.exports.FEATURES = FEATURES
