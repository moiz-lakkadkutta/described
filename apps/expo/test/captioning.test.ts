import { createCaptioning, fromNative, type NativeCaptioning, type NativeCaptioningState } from '../src/platform/captioning'

// DESC-035: what the DescribedCaptioning module (CaptioningManager) sends → shared-ui's SystemCaptions.
const fireTv: NativeCaptioningState = {
  enabled: true, fontScale: 1.5, locale: 'en-US',
  foregroundColor: 0xffffff00 | 0, backgroundColor: 0xff000000 | 0, windowColor: 0x00000000, edgeType: 2, edgeColor: 0xff000000 | 0, typeface: 'serif',
}

describe('fromNative', () => {
  it('maps every field', () => {
    expect(fromNative(fireTv)).toEqual({
      enabled: true, fontScale: 1.5, locale: 'en-US',
      style: { foregroundColor: -256, backgroundColor: -16777216, windowColor: 0, edgeType: 'dropShadow', edgeColor: -16777216, typeface: 'serif' },
    })
  })
  it('absent values (CaptionStyle.hasXxx false, no locale, default typeface) are null', () => {
    expect(fromNative({ enabled: false, fontScale: 1 })).toEqual({
      enabled: false, fontScale: 1, locale: null,
      style: { foregroundColor: null, backgroundColor: null, windowColor: null, edgeType: null, edgeColor: null, typeface: null },
    })
  })
  it.each([[-1, null], [0, 'none'], [1, 'outline'], [2, 'dropShadow'], [3, 'raised'], [4, 'depressed'], [9, null]])('edge type %i → %s', (n, e) => {
    expect(fromNative({ ...fireTv, edgeType: n }).style.edgeType).toBe(e)
  })
  it('malformed values read as unset; a bad scale is 1', () => {
    const bad = { enabled: 'yes', fontScale: Number.NaN, locale: '', foregroundColor: 1.5, typeface: '' } as unknown as NativeCaptioningState
    expect(fromNative(bad)).toMatchObject({ enabled: false, fontScale: 1, locale: null, style: { foregroundColor: null, typeface: null } })
    expect(fromNative({ enabled: true, fontScale: -2 }).fontScale).toBe(1)
  })
})

describe('createCaptioning', () => {
  it('no module in the build: no binding', () => {
    expect(createCaptioning(null)).toBeUndefined()
  })
  it('reads now, forwards each change, and removes the listener on unsubscribe', () => {
    let listener: ((e: NativeCaptioningState) => void) | undefined
    const remove = vi.fn()
    const native: NativeCaptioning = { get: () => fireTv, addListener: (_e, l) => { listener = l; return { remove } } }
    const b = createCaptioning(native)!
    expect(b.current()?.style.typeface).toBe('serif')
    const got: unknown[] = []
    const off = b.subscribe((s) => got.push(s.enabled))
    listener!({ ...fireTv, enabled: false })
    expect(got).toEqual([false])
    off()
    expect(remove).toHaveBeenCalledTimes(1)
  })
  it('a throwing get() is null (captions keep the app look), never a crash', () => {
    const b = createCaptioning({ get: () => { throw new Error('no context') }, addListener: () => ({ remove() {} }) })!
    expect(b.current()).toBeNull()
  })
})
