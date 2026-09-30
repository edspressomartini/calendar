import { describe, expect, it } from 'vitest'
import {
  addLocalDays,
  daysBetweenDayKeys,
  isLocalDayKey,
  toLocalDayKey,
} from '../../src/shared/time.ts'

/**
 * TODOs are filed by calendar day, so the day key is the only thing standing
 * between "yesterday" and "overdue" (docs/spec.md §6).
 */
describe('local day keys', () => {
  it('formats a local date, not a UTC one', () => {
    // Late evening local time is already tomorrow in UTC.
    expect(toLocalDayKey(new Date(2026, 8, 30, 23, 30))).toBe('2026-09-30')
  })

  it('pads months and days', () => {
    expect(toLocalDayKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('steps across a month boundary', () => {
    expect(addLocalDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addLocalDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('counts whole days even across a clock change', () => {
    // BST ends on 25 October 2026, making that day 25 hours long.
    expect(daysBetweenDayKeys('2026-10-24', '2026-10-26')).toBe(2)
    expect(daysBetweenDayKeys('2026-10-26', '2026-10-24')).toBe(-2)
  })

  it('rejects anything that is not a real calendar day', () => {
    expect(isLocalDayKey('2026-09-30')).toBe(true)
    expect(isLocalDayKey('2026-02-31')).toBe(false)
    expect(isLocalDayKey('2026-9-30')).toBe(false)
    expect(isLocalDayKey('nonsense')).toBe(false)
  })

  it('orders lexicographically, which is what the grouping relies on', () => {
    expect('2026-09-09' < '2026-09-10').toBe(true)
    expect('2026-09-30' < '2026-10-01').toBe(true)
  })
})
