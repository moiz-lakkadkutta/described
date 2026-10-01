// The API runs on the developer's machine over http:// (no deployed HTTPS endpoint yet). Release builds target
// API 28+, which blocks cleartext by default, so the stick would only ever show the offline screen.
// Remove this plugin once the API is served over HTTPS. Media is already HTTPS (CloudFront).
const { withAndroidManifest } = require('expo/config-plugins')
module.exports = function withLocalApi(config) {
  return withAndroidManifest(config, (c) => {
    c.modResults.manifest.application[0].$['android:usesCleartextTraffic'] = 'true'
    return c
  })
}
