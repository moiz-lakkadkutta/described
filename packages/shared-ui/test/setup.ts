import { _resetFocusMemory } from 'kit-focus-memory'
import { stub } from './stubs/space-navigation'
import { animCalls, a11yCalls } from './stubs/react-native'
import { kit } from './stubs/kit'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// Every test starts with no focus memory, no focused element and no recorded animation or announcement.
beforeEach(() => { _resetFocusMemory(); stub.focused = undefined; stub.moves.length = 0; animCalls.length = 0; a11yCalls.length = 0; kit.reset() })
const error = console.error
beforeAll(() => { console.error = (...a: unknown[]) => { if (!String(a[0]).includes('react-test-renderer is deprecated')) error(...a) } })
afterAll(() => { console.error = error })
