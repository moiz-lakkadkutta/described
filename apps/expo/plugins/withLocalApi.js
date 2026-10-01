// The API runs on the developer's machine over http:// (no deployed HTTPS endpoint yet), and release builds target
// API 28+, which blocks cleartext. Allow cleartext for the API host only, through a network security config:
// https://developer.android.com/privacy-and-security/security-config#CleartextTrafficPermitted
// The host is read from EXPO_PUBLIC_API_URL at prebuild time; an https URL adds nothing. Changing the IP needs
// `npx expo prebuild --clean`. Remove this plugin once the API is served over HTTPS (media is already HTTPS).
const fs = require('fs')
const path = require('path')
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins')

const DEFAULT_API = 'http://10.0.2.2:4000' // App.tsx fallback (emulator host)
/** The host to allow, or null when the API URL is not plain http. */
function cleartextHost(url = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API) {
  try { const u = new URL(url); return u.protocol === 'http:' ? u.hostname : null } catch { return null }
}
const securityConfig = (host) => `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">${host}</domain>
  </domain-config>
</network-security-config>
`

function withLocalApi(config) {
  const host = cleartextHost()
  if (!host) return config
  config = withDangerousMod(config, ['android', async (c) => {
    const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'network_security_config.xml'), securityConfig(host))
    return c
  }])
  return withAndroidManifest(config, (c) => {
    c.modResults.manifest.application[0].$['android:networkSecurityConfig'] = '@xml/network_security_config'
    return c
  })
}
module.exports = withLocalApi
module.exports.cleartextHost = cleartextHost
module.exports.securityConfig = securityConfig
