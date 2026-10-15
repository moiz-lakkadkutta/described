// DESC-034 review L4: the Lambda entry point is viewer-only, and a function URL request can never reach the seed op.
export {}
vi.hoisted(() => { process.env.API_MODE = 'full' })
const { importCatalogue } = vi.hoisted(() => ({ importCatalogue: vi.fn() }))
vi.mock('../src/hosted/catalogue', async (orig) => ({ ...(await orig<object>()), importCatalogue }))
vi.mock('../src/lib/db', () => ({ db: {} }))
const { handler } = await import('../src/lambda')

const urlEvent = (method: string, path: string, body?: string) => ({
  version: '2.0', routeKey: '$default', rawPath: path, rawQueryString: '', headers: { host: 'x.lambda-url.us-east-1.on.aws', 'content-type': 'application/json' },
  requestContext: { http: { method, path, protocol: 'HTTP/1.1', sourceIp: '192.0.2.1', userAgent: 't' }, domainName: 'x.lambda-url.us-east-1.on.aws', stage: '$default' },
  isBase64Encoded: false, ...(body === undefined ? {} : { body }),
})
type Res = { statusCode: number; body: string }

describe('lambda handler', () => {
  it('sends a function URL request whose body is {"op":"seed"} to Express, never to the seed op', async () => {
    const r = (await handler(urlEvent('POST', '/', '{"op":"seed","catalogue":{}}'), {} as never)) as Res
    expect(r.statusCode).toBe(404)
    const h = (await handler({ ...urlEvent('GET', '/health'), op: 'seed', catalogue: {} }, {} as never)) as Res
    expect(h.statusCode).toBe(200)
    expect(importCatalogue).not.toHaveBeenCalled()
  })
  it('stays in viewer mode when API_MODE=full', async () => {
    expect(process.env.API_MODE).toBe('full')
    const h = (await handler(urlEvent('GET', '/health'), {} as never)) as Res
    expect(JSON.parse(h.body).data.mode).toBe('viewer')
    expect(((await handler(urlEvent('POST', '/admin/titles', '{}'), {} as never)) as Res).statusCode).toBe(404)
  })
})
