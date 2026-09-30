import type { AccountColour, AccountStatus } from './account.ts'
import type { AccountId, EventId } from './calendar.ts'
import type { TodoPlacement, ViewMode } from './settings.ts'

export type EventStatus = 'past' | 'live' | 'imminent' | 'upcoming'

/**
 * The renderer's view of an event. Deliberately smaller than `CalendarEvent`:
 * no URL, no description, no attendees (§8.5).
 */
export interface AgendaItem {
  readonly id: EventId
  readonly accountId: AccountId
  readonly colour: AccountColour
  readonly title: string
  readonly start: string
  readonly end: string
  readonly isAllDay: boolean
  readonly status: EventStatus
  /** Negative once the event has started. */
  readonly startsInMinutes: number
  readonly minutesRemaining: number
  /** True when main holds an allowlisted meeting link for this event (§8.6). */
  readonly canJoin: boolean
}

export interface AgendaAccount {
  readonly id: AccountId
  readonly label: string
  readonly colour: AccountColour
  readonly status: AccountStatus
  readonly lastSyncedAt: string | null
}

/**
 * Everything the widget, the tray and the notifier render from. Produced in main
 * on every clock tick and every completed sync (§5).
 */
export interface AgendaSnapshot {
  readonly now: string
  /** The span the timeline draws, resolved in main so it owns time (§5). */
  readonly window: { readonly start: string; readonly end: string }
  /** Extra zone to label the time gutter with, or null for local time only. */
  readonly secondaryTimeZone: string | null
  readonly timed: readonly AgendaItem[]
  readonly allDay: readonly AgendaItem[]
  readonly accounts: readonly AgendaAccount[]
  readonly nextUp: AgendaItem | null
  readonly viewMode: ViewMode
  /** Layout, not data: where the TODO list sits relative to the timeline (§6). */
  readonly todoPlacement: TodoPlacement
  readonly privacyMode: boolean
}
