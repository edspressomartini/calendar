import type { ACCOUNT_COLOURS, CALENDAR_ACCESS_REFUSALS } from '../constants.ts'
import type { AccountId, CalendarId, ProviderKind } from './calendar.ts'

export type AccountColour = (typeof ACCOUNT_COLOURS)[number]

/** Why macOS would not hand over the calendar store (§7). */
export type CalendarAccessRefusal = (typeof CALENDAR_ACCESS_REFUSALS)[number]

/**
 * `needsReauth` is terminal until the user acts: the refresh token is dead and
 * retrying would only spin (§7).
 */
export type AccountStatus = 'ready' | 'syncing' | 'offline' | 'needsReauth'

export interface AccountConfig {
  readonly id: AccountId
  readonly provider: ProviderKind
  readonly label: string
  readonly colour: AccountColour
  /** Empty means the primary calendar only (§3). */
  readonly calendarIds: readonly CalendarId[]
}

/** What the settings window is allowed to see about an account. */
export interface AccountView {
  readonly id: AccountId
  readonly provider: ProviderKind
  readonly label: string
  readonly colour: AccountColour
  readonly status: AccountStatus
  readonly calendarIds: readonly CalendarId[]
  readonly lastSyncedAt: string | null
  /** False when the account was connected without the calendar-list scope (§8.3). */
  readonly canListCalendars: boolean
}

/**
 * What a connect or reconnect attempt produced: whatever registered, plus the
 * reason macOS refused when it did.
 *
 * A refusal is reported here rather than thrown because there is no account
 * to carry a `needsReauth` status — nothing was granted — and because the IPC
 * router collapses every thrown error into one opaque message, which the
 * renderer could not tell apart from a failed sign-in (§8.4).
 */
export interface ConnectAccountsResult {
  readonly accounts: readonly AccountView[]
  readonly refusal: CalendarAccessRefusal | null
}
