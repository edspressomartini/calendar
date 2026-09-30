import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  nextAccountColour,
  parseSettings,
} from '../../src/main/storage/schema.ts'
import type { AccountConfig } from '../../src/shared/types/account.ts'

/**
 * Upgrading the app must never cost the user their accounts (docs/spec.md §8.2).
 */

const account: AccountConfig = {
  id: 'someone@example.com',
  provider: 'google',
  label: 'Personal',
  colour: 'sky',
  calendarIds: ['primary'],
}

describe('parseSettings', () => {
  it('keeps accounts when the stored file predates a new setting', () => {
    const older: Record<string, unknown> = { ...DEFAULT_SETTINGS, accounts: [account] }
    delete older['dayStartHour']
    delete older['dayEndHour']

    const parsed = parseSettings(older)

    expect(parsed.accounts).toHaveLength(1)
    expect(parsed.accounts[0]?.id).toBe('someone@example.com')
    expect(parsed.dayStartHour).toBe(DEFAULT_SETTINGS.dayStartHour)
  })

  it('drops settings that no longer exist rather than failing the whole parse', () => {
    const parsed = parseSettings({
      ...DEFAULT_SETTINGS,
      accounts: [account],
      somethingRemovedInAnOlderVersion: true,
    })

    expect(parsed.accounts).toHaveLength(1)
    expect(parsed).not.toHaveProperty('somethingRemovedInAnOlderVersion')
  })

  it('gives a file written before the widget was scalable a sane size', () => {
    const older: Record<string, unknown> = { ...DEFAULT_SETTINGS, accounts: [account] }
    delete older['widgetTextScale']
    delete older['todoPlacement']

    const parsed = parseSettings(older)

    expect(parsed.widgetTextScale).toBe(DEFAULT_SETTINGS.widgetTextScale)
    expect(parsed.todoPlacement).toBe('below')
    expect(parsed.accounts).toHaveLength(1)
  })

  it('preserves values that are still valid', () => {
    const parsed = parseSettings({
      ...DEFAULT_SETTINGS,
      viewMode: 'split',
      syncIntervalMinutes: 1,
      accounts: [account],
    })

    expect(parsed.viewMode).toBe('split')
    expect(parsed.syncIntervalMinutes).toBe(1)
  })

  it('falls back to defaults when a value is genuinely invalid', () => {
    const parsed = parseSettings({ ...DEFAULT_SETTINGS, syncIntervalMinutes: 999 })
    expect(parsed).toEqual(DEFAULT_SETTINGS)
  })

  it('falls back for a file that is not an object at all', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('nonsense')).toEqual(DEFAULT_SETTINGS)
  })
})

describe('nextAccountColour', () => {
  it('walks the rotation as accounts are added', () => {
    expect(nextAccountColour([])).toBe('sky')
    expect(nextAccountColour([account])).toBe('violet')
  })
})
