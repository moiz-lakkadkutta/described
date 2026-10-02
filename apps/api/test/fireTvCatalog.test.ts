import request from 'supertest'
import { escapeXml, renderFireTvCatalog, type FeedTitle } from '../src/lib/fireTvCatalog'
const findMany = vi.fn()
vi.mock('../src/lib/db', () => ({ db: { title: { findMany: (...a: unknown[]) => findMany(...a) } } }))
const { createApp } = await import('../src/app')

const sintel: FeedTitle = { slug: 'sintel-90-210', name: 'Sintel', year: 2010, durationS: 888, synopsis: 'A girl & her "dragon" <Scales>.', posterUrl: 'https://cdn.example/p.jpg?a=1&b=2' }
const bare: FeedTitle = { slug: 'big-buck-bunny', name: 'Big Buck Bunny', year: null, durationS: null, synopsis: null, posterUrl: null }

describe('renderFireTvCatalog', () => {
  const xml = renderFireTvCatalog([sintel, bare])
  it('is a CDF catalog with one Movie per title, sorted by slug', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true)
    expect(xml).toContain('<Catalog xmlns="http://www.amazon.com/FireTv/2014-04-11/ingestion" version="FireTv-v1.3">')
    expect(xml).toContain('<Partner>Described</Partner>')
    expect(xml.match(/<Movie>/g)).toHaveLength(2)
    expect(xml.indexOf('<ID>big-buck-bunny</ID>')).toBeLessThan(xml.indexOf('<ID>sintel-90-210</ID>'))
  })
  it('carries the deep links for each title', () => {
    expect(xml).toContain('<!-- launch: described://play/sintel-90-210 · details: described://title/sintel-90-210 -->')
  })
  it('maps the fields and omits the ones a title lacks', () => {
    expect(xml).toContain('<Title locale="en-US">Sintel</Title>')
    expect(xml).toContain('<FreeOffer>')
    expect(xml).toContain('<Territories>US</Territories>')
    expect(xml).toContain('<ReleaseDate>2010-01-01T00:00:00</ReleaseDate>')
    expect(xml).toContain('<RuntimeMinutes>15</RuntimeMinutes>')
    const bunny = xml.slice(xml.indexOf('<ID>big-buck-bunny'), xml.indexOf('</Movie>'))
    expect(bunny).not.toMatch(/Synopsis|ReleaseDate|RuntimeMinutes|ImageUrl/)
  })
  it('escapes text and attribute values', () => {
    expect(xml).toContain('<Synopsis>A girl &amp; her &quot;dragon&quot; &lt;Scales&gt;.</Synopsis>')
    expect(xml).toContain('<ImageUrl>https://cdn.example/p.jpg?a=1&amp;b=2</ImageUrl>')
    expect(escapeXml("it's\u0001")).toBe('it&apos;s')
  })
  it('drops unpaired surrogates and keeps real pairs', () => {
    expect(escapeXml('a\uD83Db')).toBe('ab') // lone high
    expect(escapeXml('a\uDE00b')).toBe('ab') // lone low
    expect(escapeXml('end\uD83D')).toBe('end')
    expect(escapeXml('\uDE00\uD83D')).toBe('') // reversed pair: both lone
    expect(escapeXml('dragon 🐉 & co')).toBe('dragon 🐉 &amp; co')
    expect(escapeXml('x￾y￿')).toBe('xy')
  })
  it('takes partner, locale and territories', () => {
    const x = renderFireTvCatalog([sintel], { partner: 'Acme <TV>', locale: 'en-GB', territories: ['GB', 'IE'] })
    expect(x).toContain('<Partner>Acme &lt;TV&gt;</Partner>')
    expect(x).toContain('<Title locale="en-GB">')
    expect(x).toContain('<Territories>GB IE</Territories>')
  })
  it('ReleaseDate always has a 4-digit year; impossible years are left out', () => {
    expect(renderFireTvCatalog([{ ...bare, year: 999 }])).toContain('<ReleaseDate>0999-01-01T00:00:00</ReleaseDate>')
    expect(renderFireTvCatalog([{ ...bare, year: 12345 }])).not.toContain('ReleaseDate')
  })
  it('an empty catalog is still well-formed', () => {
    expect(renderFireTvCatalog([])).toContain('<Works>\n  </Works>')
  })
})

describe('GET /catalog/fire-tv.xml', () => {
  it('serves published titles as XML, poster from the CDN key', async () => {
    findMany.mockResolvedValueOnce([{ slug: 'sintel-90-210', name: 'Sintel', year: 2010, durationS: 888, synopsis: null, posterKey: null }])
    const res = await request(createApp()).get('/catalog/fire-tv.xml?partner=Described%20Ltd')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/xml/)
    expect(res.text).toContain('<ID>sintel-90-210</ID>')
    expect(res.text).toContain('<Partner>Described Ltd</Partner>')
    expect(findMany.mock.calls[0]![0].where).toEqual({ status: 'published' })
  })
})
