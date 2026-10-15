// EXPO_PUBLIC_* values are inlined into the JS by babel-preset-expo in production bundles (inline-env-vars.js), but
// @expo/metro-config's transform cache key (metro-transform-worker getCacheKey) hashes only files and config, never the
// values. A release bundle made once without EXPO_PUBLIC_API_URL left App.tsx cached with the fallback URL, and every later
// `build:apk -- --hosted` reused it. metro.config.js folds these values into `cacheVersion`, which Metro does hash.
// https://docs.expo.dev/guides/environment-variables/ · https://metrobundler.dev/docs/configuration/#cacheversion

/** Pure (tested). A stable key for the EXPO_PUBLIC_* values in `env`: same values, same key, whatever the order. */
function publicEnvKey(env = {}) {
  return Object.keys(env).filter((k) => k.startsWith('EXPO_PUBLIC_')).sort().map((k) => `${k}=${env[k]}`).join('\n')
}

module.exports = { publicEnvKey }
