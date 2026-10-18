import type {
  AccountId,
  AccountIdentity,
  CalendarEvent,
  CalendarId,
  CalendarSummary,
  ProviderKind,
  TimeRange,
} from '../../shared/types/calendar.ts'

/**
 * The load-bearing abstraction (docs/spec.md §3). Everything vendor-specific —
 * the OAuth dance, response shapes, conference data — stays behind it.
 */
export interface CalendarProvider {
  readonly kind: ProviderKind
  readonly accountId: AccountId

  isAuthenticated(): boolean
  /** False when the calendar-list scope was not granted (§8.3). */
  canListCalendars(): boolean
  listCalendars(): Promise<CalendarSummary[]>
  fetchEvents(calendarIds: readonly CalendarId[], range: TimeRange): Promise<CalendarEvent[]>
  /** Revokes with the vendor where possible, then drops local credentials (§8.2). */
  disconnect(): Promise<void>
}

export interface AuthenticationResult {
  readonly identity: AccountIdentity
  readonly grantedScopes: readonly string[]
  /** Calendars to select by default — the primary one (§3). */
  readonly defaultCalendarIds: readonly CalendarId[]
}

/**
 * Separate from the provider because a provider is bound to a stored
 * credential, which does not exist until the first sign-in succeeds.
 *
 * A list, not one: a single EventKit grant yields one account per calendar
 * source. Google returns a list of one.
 */
export interface AccountAuthenticator {
  readonly kind: ProviderKind
  authenticate(): Promise<AuthenticationResult[]>
}
