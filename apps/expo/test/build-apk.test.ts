import { createRequire } from 'node:module'

// DESC-034: the judges' APK points at the hosted API (https); a developer build still takes http://<mac-ip>:<port>.
const require = createRequire(import.meta.url)
type Opts = { argv?: string[]; env?: Record<string, string>; readOutputs?: () => string }
const { resolveApiUrl } = require('../scripts/build-apk.js') as { resolveApiUrl: (o: Opts) => string }
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
