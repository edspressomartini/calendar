/** The normalised calendar domain. No provider's vocabulary leaks in here (§3). */

import type { PROVIDER_KINDS } from '../constants.ts'

export type ProviderKind = (typeof PROVIDER_KINDS)[number]

export type AccountId = string
export type CalendarId = string
export type EventId = string

/** Half-open [start, end), both ISO 8601 with offset. */
export interface TimeRange {
  readonly start: string
  readonly end: string
}

/** Who a provider authenticated as. Derived from the primary calendar, so no
 * identity scope is requested (§8.2). */
export interface AccountIdentity {
  readonly providerAccountId: string
  readonly label: string
}

export interface CalendarSummary {
  readonly id: CalendarId
  readonly title: string
  readonly primary: boolean
}

/**
 * One event instance. Recurring events are already expanded by the provider.
 * `conferenceUrl` stays in main and never crosses IPC (§8.5).
 */
export interface CalendarEvent {
  readonly id: EventId
  readonly accountId: AccountId
  readonly calendarId: CalendarId
  /** Shared by the same meeting in two accounts — used to dedupe (§7). */
  readonly iCalUID: string
  readonly title: string
  readonly start: string
  readonly end: string
  readonly isAllDay: boolean
  readonly conferenceUrl?: string
}
