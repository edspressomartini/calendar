import { describe, expect, it } from 'vitest'
import { formatTrayTitle } from '../../src/main/tray/TrayController.ts'
import type { AgendaItem, AgendaSnapshot } from '../../src/shared/types/agenda.ts'

function item(overrides: Partial<AgendaItem> = {}): AgendaItem {
  return {
    id: 'evt',
    accountId: 'work',
    colour: 'sky',
    title: 'Standup',
    start: '2026-09-25T10:00:00.000Z',
    end: '2026-09-25T10:15:00.000Z',
    isAllDay: false,
    status: 'upcoming',
    startsInMinutes: 4,
    minutesRemaining: 19,
    canJoin: false,
    ...overrides,
  }
}

function snapshot(nextUp: AgendaItem | null): AgendaSnapshot {
  return {
    now: '2026-09-25T09:56:00.000Z',
    window: { start: '2026-09-25T06:00:00.000Z', end: '2026-09-25T21:00:00.000Z' },
    secondaryTimeZone: null,
    timed: nextUp ? [nextUp] : [],
    allDay: [],
    accounts: [],
    nextUp,
    viewMode: 'merged',
    todoPlacement: 'below',
    privacyMode: false,
  }
}

/** The notch hides long menu-bar items, so this stays short (docs/spec.md §6). */
describe('formatTrayTitle', () => {
  it('counts down to the next meeting', () => {
    expect(formatTrayTitle(snapshot(item()), false)).toBe('Standup · 4m')
  })

  it('says "now" when it is starting', () => {
    expect(formatTrayTitle(snapshot(item({ startsInMinutes: 0 })), false)).toBe('Standup · now')
  })

  it('shows time left for a meeting in progress', () => {
    const live = item({ status: 'live', startsInMinutes: -5, minutesRemaining: 12 })
    expect(formatTrayTitle(snapshot(live), false)).toBe('Standup · 12m left')
  })

  it('shows only the countdown when titles are hidden', () => {
    expect(formatTrayTitle(snapshot(item()), true)).toBe('4m')
  })

  it('shows nothing once the day is done', () => {
    expect(formatTrayTitle(snapshot(null), false)).toBe('')
  })

  it('truncates a long title', () => {
    const long = item({ title: 'Quarterly planning workshop with everyone' })
    expect(formatTrayTitle(snapshot(long), false)).toBe('Quarterly planni · 4m')
  })
})
