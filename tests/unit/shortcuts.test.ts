import { describe, expect, it } from 'vitest'
import {
  acceleratorFromChord,
  formatAccelerator,
  isValidAccelerator,
  type KeyChord,
} from '../../src/shared/shortcuts.ts'
import { DEFAULT_QUICK_ADD_SHORTCUT } from '../../src/shared/constants.ts'

function chord(overrides: Partial<KeyChord> = {}): KeyChord {
  return {
    code: 'KeyT',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  }
}

describe('isValidAccelerator', () => {
  it('accepts the default', () => {
    expect(isValidAccelerator(DEFAULT_QUICK_ADD_SHORTCUT)).toBe(true)
  })

  it('accepts letters, digits, function keys and named keys', () => {
    expect(isValidAccelerator('Command+Shift+T')).toBe(true)
    expect(isValidAccelerator('Command+1')).toBe(true)
    expect(isValidAccelerator('Control+F12')).toBe(true)
    expect(isValidAccelerator('Alt+Space')).toBe(true)
  })

  it('refuses a bare key, which would swallow it everywhere', () => {
    expect(isValidAccelerator('T')).toBe(false)
  })

  it('refuses Shift alone, which is only typing a capital', () => {
    expect(isValidAccelerator('Shift+T')).toBe(false)
  })

  it('refuses unknown modifiers, repeats and unknown keys', () => {
    expect(isValidAccelerator('Hyper+T')).toBe(false)
    expect(isValidAccelerator('Command+Command+T')).toBe(false)
    expect(isValidAccelerator('Command+Enter')).toBe(false)
    expect(isValidAccelerator('Command+F25')).toBe(false)
  })

  it('refuses the empty string and stray separators', () => {
    expect(isValidAccelerator('')).toBe(false)
    expect(isValidAccelerator('+')).toBe(false)
    expect(isValidAccelerator('Command+')).toBe(false)
  })
})

describe('formatAccelerator', () => {
  it('writes modifiers as symbols, in the order macOS uses', () => {
    expect(formatAccelerator('Command+Shift+T')).toBe('⇧⌘T')
    expect(formatAccelerator('Control+Alt+T')).toBe('⌃⌥T')
  })

  it('leaves anything it cannot parse alone', () => {
    expect(formatAccelerator('nonsense')).toBe('nonsense')
  })
})

describe('acceleratorFromChord', () => {
  it('builds an accelerator from the keys held down', () => {
    expect(acceleratorFromChord(chord({ metaKey: true, shiftKey: true }))).toBe('Command+Shift+T')
  })

  it('reads the physical key, not the character Option would produce', () => {
    // Option+T types "†"; event.key would carry that, event.code stays KeyT.
    expect(acceleratorFromChord(chord({ ctrlKey: true, altKey: true }))).toBe('Control+Alt+T')
  })

  it('maps digits and named keys', () => {
    expect(acceleratorFromChord(chord({ code: 'Digit4', metaKey: true }))).toBe('Command+4')
    expect(acceleratorFromChord(chord({ code: 'Space', altKey: true }))).toBe('Alt+Space')
  })

  it('returns null while only modifiers are held', () => {
    expect(acceleratorFromChord(chord({ code: 'ShiftLeft', shiftKey: true }))).toBeNull()
    expect(acceleratorFromChord(chord({ code: 'MetaLeft', metaKey: true }))).toBeNull()
  })

  it('returns null for a combination it would not claim globally', () => {
    expect(acceleratorFromChord(chord({ shiftKey: true }))).toBeNull()
    expect(acceleratorFromChord(chord())).toBeNull()
  })
})
