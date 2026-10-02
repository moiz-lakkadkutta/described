import { DEEP_LINK_SCHEME, MAX_START_S, parseDeepLink, playLink, titleLink } from '../src/index'

describe('deep links', () => {
  it('builds the two link shapes', () => {
    expect(titleLink('sintel-90-210')).toBe('described://title/sintel-90-210')
    expect(playLink('sintel-90-210')).toBe('described://play/sintel-90-210')
    expect(playLink('sintel-90-210', 754.9)).toBe('described://play/sintel-90-210?t=754')
    expect(playLink('sintel-90-210', 0)).toBe('described://play/sintel-90-210')
  })
  it('round-trips what it builds', () => {
    expect(parseDeepLink(titleLink('sintel-90-210'))).toEqual({ kind: 'title', slug: 'sintel-90-210' })
    expect(parseDeepLink(playLink('sintel-90-210'))).toEqual({ kind: 'play', slug: 'sintel-90-210' })
    expect(parseDeepLink(playLink('sintel-90-210', 754))).toEqual({ kind: 'play', slug: 'sintel-90-210', startAtS: 754 })
  })
  it('tolerates case, a trailing slash, extra query keys and a fragment', () => {
    expect(parseDeepLink('Described://TITLE/Sintel-90-210/')).toEqual({ kind: 'title', slug: 'sintel-90-210' })
    expect(parseDeepLink('described://play/sintel-90-210?src=search&t=12.5#x')).toEqual({ kind: 'play', slug: 'sintel-90-210', startAtS: 12.5 })
  })
  it('ignores a bad or zero start time instead of rejecting the link', () => {
    expect(parseDeepLink('described://play/sintel?t=abc')).toEqual({ kind: 'play', slug: 'sintel' })
    expect(parseDeepLink('described://play/sintel?t=-5')).toEqual({ kind: 'play', slug: 'sintel' })
    expect(parseDeepLink('described://play/sintel?t=0')).toEqual({ kind: 'play', slug: 'sintel' })
    expect(parseDeepLink('described://play/sintel?t=%E0%A4%A')).toEqual({ kind: 'play', slug: 'sintel' })
  })
  it('a non-finite ?t= is ignored and a huge one is capped at 24 h', () => {
    expect(parseDeepLink(`described://play/sintel?t=${'9'.repeat(400)}`)).toEqual({ kind: 'play', slug: 'sintel' })
    for (const t of ['Infinity', 'NaN', '1e9', '0x10']) expect(parseDeepLink(`described://play/sintel?t=${t}`)).toEqual({ kind: 'play', slug: 'sintel' })
    expect(parseDeepLink('described://play/sintel?t=999999')).toEqual({ kind: 'play', slug: 'sintel', startAtS: MAX_START_S })
    expect(parseDeepLink('described://play/sintel?t=86400')).toEqual({ kind: 'play', slug: 'sintel', startAtS: 86400 })
  })
  it('rejects links that are not ours', () => {
    for (const u of [null, undefined, '', 'https://title/sintel', `${DEEP_LINK_SCHEME}://home`, 'described://title/', 'described://settings/x',
      'described://title/a/b', 'described://title/../etc', 'described://title/Sin tel', 'described://title/%E0%A4%A', 'amzn://apps/android?p=x']) {
      expect(parseDeepLink(u)).toBeNull()
    }
  })
})
