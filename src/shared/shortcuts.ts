/**
 * Accelerators for the quick-add global shortcut (docs/spec.md §6).
 *
 * Pure, and shared: the renderer builds one from a keypress, main registers
 * it, and the contract validates it. A global shortcut is taken away from
 * every other app on the machine, so what counts as a legal one is decided
 * here once rather than trusted from the renderer.
 */

/** Electron's spelling. `Alt` is Option on macOS. */
export const SHORTCUT_MODIFIERS = ['Command', 'Control', 'Alt', 'Shift'] as const

export type ShortcutModifier = (typeof SHORTCUT_MODIFIERS)[number]

/**
 * Shift alone is not enough: `Shift+A` is just typing a capital A, and
 * claiming it globally would swallow it everywhere.
 */
const QUALIFYING_MODIFIERS: readonly ShortcutModifier[] = ['Command', 'Control', 'Alt']

/** Letters, digits, function keys and a few named keys Electron accepts. */
const NAMED_KEYS = ['Space', 'Tab', 'Return', 'Escape', 'Backspace', 'Delete'] as const
const KEY_PATTERN = /^(?:[A-Z0-9]|F([1-9]|1\d|2[0-4]))$/

const SEPARATOR = '+'

/** The symbols macOS uses, in the order it writes them. */
const MODIFIER_SYMBOLS: Record<ShortcutModifier, string> = {
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Command: '⌘',
}
const SYMBOL_ORDER: readonly ShortcutModifier[] = ['Control', 'Alt', 'Shift', 'Command']

function isModifier(part: string): part is ShortcutModifier {
  return SHORTCUT_MODIFIERS.some((modifier) => modifier === part)
}

function isKey(part: string): boolean {
  return KEY_PATTERN.test(part) || NAMED_KEYS.some((named) => named === part)
}

/**
 * Accepts only what this app is willing to take from the rest of the system:
 * a single key, at least one of Command, Control or Option, and no repeats.
 */
export function isValidAccelerator(value: string): boolean {
  const parts = value.split(SEPARATOR)
  if (parts.length < 2) {
    return false
  }

  const key = parts[parts.length - 1]
  if (key === undefined || !isKey(key)) {
    return false
  }

  const modifiers = parts.slice(0, -1)
  if (!modifiers.every(isModifier)) {
    return false
  }
  if (new Set(modifiers).size !== modifiers.length) {
    return false
  }
  return modifiers.some((modifier) => QUALIFYING_MODIFIERS.some((needed) => needed === modifier))
}

/** `Command+Shift+T` becomes `⇧⌘T`, which is how macOS writes it. */
export function formatAccelerator(value: string): string {
  if (!isValidAccelerator(value)) {
    return value
  }

  const parts = value.split(SEPARATOR)
  const key = parts[parts.length - 1] ?? ''
  const held = new Set(parts.slice(0, -1))
  const symbols = SYMBOL_ORDER.filter((modifier) => held.has(modifier))
    .map((modifier) => MODIFIER_SYMBOLS[modifier])
    .join('')
  return `${symbols}${key}`
}

/** The parts of a KeyboardEvent this needs, so it stays testable without a DOM. */
export interface KeyChord {
  readonly code: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
}

/**
 * `code` rather than `key`, because Option changes `key` into a symbol:
 * Option+T reports `†`, which is not an accelerator Electron understands.
 */
function keyFromCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter?.[1]) {
    return letter[1]
  }
  const digit = /^Digit(\d)$/.exec(code)
  if (digit?.[1]) {
    return digit[1]
  }
  if (KEY_PATTERN.test(code)) {
    return code
  }
  return NAMED_KEYS.find((named) => named === code) ?? null
}

/**
 * Builds an accelerator from a keypress, or null while the user is still
 * holding modifiers down and has not chosen a key.
 */
export function acceleratorFromChord(chord: KeyChord): string | null {
  const key = keyFromCode(chord.code)
  if (key === null) {
    return null
  }

  const held: ShortcutModifier[] = []
  if (chord.metaKey) {
    held.push('Command')
  }
  if (chord.ctrlKey) {
    held.push('Control')
  }
  if (chord.altKey) {
    held.push('Alt')
  }
  if (chord.shiftKey) {
    held.push('Shift')
  }

  const candidate = [...held, key].join(SEPARATOR)
  return isValidAccelerator(candidate) ? candidate : null
}
