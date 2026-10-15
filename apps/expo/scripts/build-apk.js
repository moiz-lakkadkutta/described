// Release APK for sideloading (DESC-034): `pnpm --filter @described/expo build:apk -- --hosted` builds against the hosted API
// (ViewerApiUrl in infra/cdk-outputs-viewer.json, written by `pnpm --filter @described/infra deploy:viewer`);
// `-- --url http://<mac-ip>:4100` builds against your own machine, as README step 5 does by hand.
// No device needed: prebuild, then Gradle's assembleRelease (signed with the debug key, as Expo's prebuild template does,
// which is enough for `adb install`). The API URL is fixed into the JS bundle and, for http, into the cleartext
// allow-list (plugins/withLocalApi.js), so it is exported before prebuild and kept for Gradle's bundle step. Metro's
// transform cache now keys on it (scripts/public-env.js), and the built APK's bundle is checked for it before it is kept.
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const EXPO = path.resolve(__dirname, '..')
const OUTPUTS = path.resolve(EXPO, '../../infra/cdk-outputs-viewer.json')

/**
 * Pure (tested). The API base URL for the build: `--url` wins, then `--hosted` (the viewer stack's output), then
 * EXPO_PUBLIC_API_URL. A function URL ends in "/", and the app appends paths that start with "/", so trailing slashes go.
 * The hosted URL must be https: that build has no cleartext exception at all.
 */
function resolveApiUrl({ argv = [], env = {}, readOutputs = () => fs.readFileSync(OUTPUTS, 'utf8'), stage = env.STAGE || 'dev' } = {}) {
  const at = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
  let url = at('--url')
  const hosted = !url && argv.includes('--hosted')
  if (hosted) {
    let outputs
    try { outputs = JSON.parse(readOutputs()) } catch { throw new Error(`--hosted reads ${OUTPUTS}; deploy the viewer stack first (pnpm --filter @described/infra deploy:viewer)`) }
    url = outputs[`described-viewer-${stage}`] && outputs[`described-viewer-${stage}`].ViewerApiUrl
    if (!url) throw new Error(`no ViewerApiUrl for described-viewer-${stage} in ${OUTPUTS}`)
  }
  url = url || env.EXPO_PUBLIC_API_URL
  if (!url) throw new Error('pass --hosted, --url <api-url>, or set EXPO_PUBLIC_API_URL')
  let u
  try { u = new URL(url) } catch { throw new Error(`not a URL: ${url}`) }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`not an http(s) URL: ${url}`)
  if (hosted && u.protocol !== 'https:') throw new Error(`the hosted API must be https: ${url}`)
  return url.replace(/\/+$/, '')
}

/** The URL App.tsx falls back to when EXPO_PUBLIC_API_URL was not inlined (an emulator talking to a local API). */
const FALLBACK_URL = 'http://10.0.2.2:4000'

/**
 * Pure (tested). What is wrong with the JS bundle (Hermes bytecode or plain JS) taken from the APK, for a build against
 * `url`: it must contain the URL, and must not contain the fallback (unless the fallback is the URL asked for).
 */
function bundleProblems(bundle, url) {
  const text = Buffer.isBuffer(bundle) ? bundle.toString('latin1') : String(bundle)
  const problems = []
  if (!text.includes(url)) problems.push(`the bundle does not contain the API URL ${url}`)
  if (url !== FALLBACK_URL && text.includes(FALLBACK_URL)) problems.push(`the bundle still contains the fallback ${FALLBACK_URL}`)
  return problems
}

function main() {
  const url = resolveApiUrl({ argv: process.argv.slice(2), env: process.env })
  const env = { ...process.env, EXPO_PUBLIC_API_URL: url, CI: '1' }
  const run = (cmd, args, cwd = EXPO) => execFileSync(cmd, args, { cwd, env, stdio: 'inherit' })
  console.log(`API: ${url}`)
  const pkg = path.join(EXPO, 'package.json')
  const before = fs.readFileSync(pkg, 'utf8')
  try { run('npx', ['expo', 'prebuild', '--clean', '--platform', 'android']) } finally {
    if (fs.readFileSync(pkg, 'utf8') !== before) fs.writeFileSync(pkg, before) // prebuild rewrites the scripts
  }
  run('./gradlew', ['assembleRelease'], path.join(EXPO, 'android'))
  const version = JSON.parse(fs.readFileSync(path.join(EXPO, 'app.json'), 'utf8')).expo.version
  const out = path.join(EXPO, 'dist', `described-${version}.apk`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.copyFileSync(path.join(EXPO, 'android/app/build/outputs/apk/release/app-release.apk'), out)
  // Never hand out an APK that talks to the wrong API: read the bundle back out of it.
  const bundle = execFileSync('unzip', ['-p', out, 'assets/index.android.bundle'], { maxBuffer: 1 << 30 })
  const problems = bundleProblems(bundle, url)
  if (problems.length) {
    fs.rmSync(out, { force: true })
    throw new Error(`${problems.join('; ')}. Removed ${out}. Clear Metro's cache (npx expo start --clear) and build again.`)
  }
  console.log(`bundle contains ${url}`)
  const sha = createHash('sha256').update(fs.readFileSync(out)).digest('hex')
  console.log(`APK: ${path.relative(process.cwd(), out)}\nsha256: ${sha}`)
}

module.exports = { resolveApiUrl, bundleProblems, FALLBACK_URL }
if (require.main === module) {
  try { main() } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1) }
}
