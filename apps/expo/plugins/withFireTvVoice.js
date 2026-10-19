// Lets Fire TV's voice controller (Alexa) target our MediaSession instead of falling back to injected key presses.
// https://developer.amazon.com/docs/fire-tv/mediasession-api-integration.html
// - "Add the Media Session Permission": <uses-permission android:name="com.amazon.permission.media.session.voicecommandcontrol" />
//   comes from app.json android.permissions (Expo writes custom strings as <uses-permission>). Only Fire OS 14 and later
//   do without it; without it Fire OS 7 logs "No target session, trying button press" and sends keys 85 / 87 / 88, so
//   pause and resume toggle and fast forward, rewind and restart do nothing (device run 2026-10-19, check 14).
// - "Add The Opt-In Permission": this plugin adds the meta-data below under <application>, so playback does not resume
//   for a moment ("blip") before a voice pause lands.
const { withAndroidManifest } = require('expo/config-plugins')

const NAME = 'com.amazon.voice.supports_background_media_session'

/** Pure transform of the parsed manifest (xml2js shape), exported for tests. Adds the meta-data once. */
function patch(manifest) {
  const app = manifest.manifest.application[0]
  app['meta-data'] = app['meta-data'] || []
  const found = app['meta-data'].find((m) => m.$ && m.$['android:name'] === NAME)
  if (found) found.$['android:value'] = 'true'
  else app['meta-data'].push({ $: { 'android:name': NAME, 'android:value': 'true' } })
  return manifest
}

function withFireTvVoice(config) {
  return withAndroidManifest(config, (c) => {
    c.modResults = patch(c.modResults)
    return c
  })
}
module.exports = withFireTvVoice
module.exports.patch = patch
module.exports.META_DATA_NAME = NAME
