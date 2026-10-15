import { createRequire } from 'node:module'

// DESC-034: the judges' APK points at the hosted API (https); a developer build still takes http://<mac-ip>:<port>.
const require = createRequire(import.meta.url)
type Opts = { argv?: string[]; env?: Record<string, string>; readOutputs?: () => string }
const { resolveApiUrl, bundleProblems, FALLBACK_URL } = require('../scripts/build-apk.js') as {
  resolveApiUrl: (o: Opts) => string
  bundleProblems: (bundle: Buffer | string, url: string) => string[]
  FALLBACK_URL: string
}
const { publicEnvKey } = require('../scripts/public-env.js') as { publicEnvKey: (env?: Record<string, string>) => string }
const localApi = require('../plugins/withLocalApi.js') as { cleartextHost: (u?: string) => string | null }

const FN_URL = 'https://abc123.lambda-url.us-east-1.on.aws/'
const outputs = (url = FN_URL, stage = 'dev') => () => JSON.stringify({ [`described-viewer-${stage}`]: { ViewerApiUrl: url, ApiFunctionName: 'fn' } })

describe('resolveApiUrl', () => {
  it('--hosted reads ViewerApiUrl and drops the trailing slash (the app appends "/catalog")', () => {
    expect(resolveApiUrl({ argv: ['--hosted'], readOutputs: outputs() })).toBe('https://abc123.lambda-url.us-east-1.on.aws')
  })
  it('reads the stage named by STAGE', () => {
    expect(resolveApiUrl({ argv: ['--hosted'], env: { STAGE: 'prod' }, readOutputs: outputs('https://p.lambda-url.us-east-1.on.aws/', 'prod') })).toBe('https://p.lambda-url.us-east-1.on.aws')
  })
  it('refuses a hosted URL that is not https, a missing outputs file, and a stack with no URL', () => {
    expect(() => resolveApiUrl({ argv: ['--hosted'], readOutputs: outputs('http://1.2.3.4/') })).toThrow(/https/)
    expect(() => resolveApiUrl({ argv: ['--hosted'], readOutputs: () => { throw new Error('ENOENT') } })).toThrow(/deploy the viewer stack/)
    expect(() => resolveApiUrl({ argv: ['--hosted'], readOutputs: () => '{}' })).toThrow(/no ViewerApiUrl/)
  })
  it('keeps the local path: --url or EXPO_PUBLIC_API_URL with http://<mac-ip>:<port>', () => {
    expect(resolveApiUrl({ argv: ['--url', 'http://192.168.1.20:4100'] })).toBe('http://192.168.1.20:4100')
    expect(resolveApiUrl({ env: { EXPO_PUBLIC_API_URL: 'http://192.168.1.20:4100/' } })).toBe('http://192.168.1.20:4100')
    expect(resolveApiUrl({ argv: ['--url', 'http://10.0.0.2:4000', '--hosted'], readOutputs: outputs() })).toBe('http://10.0.0.2:4000')
  })
  it('refuses no URL at all and a non-http URL', () => {
    expect(() => resolveApiUrl({})).toThrow(/--hosted/)
    expect(() => resolveApiUrl({ argv: ['--url', 'ftp://x'] })).toThrow(/http/)
  })
  it('an https API adds no cleartext exception to the build', () => {
    expect(localApi.cleartextHost('https://abc123.lambda-url.us-east-1.on.aws')).toBeNull()
  })
})

describe('bundleProblems (the post-build check on assets/index.android.bundle)', () => {
  const url = 'https://abc123.lambda-url.us-east-1.on.aws'
  it('passes a bundle with the URL and no fallback, Hermes bytes or JS text', () => {
    expect(bundleProblems(Buffer.concat([Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0]), Buffer.from(`\0${url}\0Root\0`)]), url)).toEqual([])
    expect(bundleProblems(`apiBaseUrl:"${url}"`, url)).toEqual([])
  })
  it('fails the bundle a stale Metro cache produced: fallback inlined, URL missing', () => {
    expect(bundleProblems(Buffer.from(`apiBaseUrl:'${FALLBACK_URL}'`), url)).toEqual([
      `the bundle does not contain the API URL ${url}`,
      `the bundle still contains the fallback ${FALLBACK_URL}`,
    ])
  })
  it('fails a bundle with both URLs, and allows a build that asks for the fallback itself', () => {
    expect(bundleProblems(`${url} ${FALLBACK_URL}`, url)).toHaveLength(1)
    expect(bundleProblems(FALLBACK_URL, FALLBACK_URL)).toEqual([])
  })
})

describe('publicEnvKey (folded into Metro cacheVersion, so a new API URL is a new transform)', () => {
  it('changes with an EXPO_PUBLIC_* value and ignores everything else and key order', () => {
    const a = publicEnvKey({ EXPO_PUBLIC_API_URL: 'https://a', PATH: '/bin' })
    expect(a).not.toBe(publicEnvKey({ EXPO_PUBLIC_API_URL: 'https://b', PATH: '/bin' }))
    expect(a).not.toBe(publicEnvKey({ PATH: '/bin' }))
    expect(a).toBe(publicEnvKey({ PATH: '/usr/bin', EXPO_PUBLIC_API_URL: 'https://a' }))
    expect(publicEnvKey({ EXPO_PUBLIC_B: '2', EXPO_PUBLIC_A: '1' })).toBe(publicEnvKey({ EXPO_PUBLIC_A: '1', EXPO_PUBLIC_B: '2' }))
  })
})
