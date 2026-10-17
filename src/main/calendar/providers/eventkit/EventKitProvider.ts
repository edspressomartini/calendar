import type {
  AccountId,
  CalendarEvent,
  CalendarId,
  CalendarSummary,
  ProviderKind,
  TimeRange,
} from '../../../../shared/types/calendar.ts'
import type { AppLogger } from '../../../infra/logger.ts'
import type { CalendarProvider } from '../../CalendarProvider.ts'
import { mapEventKitEvents } from './eventKitEventMapper.ts'
import type { EventKitRequester } from './EventKitHelperProcess.ts'
import {
  eventKitCalendarListSchema,
  eventKitEventListSchema,
  type EventKitEvent,
} from './EventKitProtocol.ts'

const ACCOUNT_ID_PREFIX = 'eventkit:'

export function eventKitAccountId(sourceId: string): AccountId {
  return `${ACCOUNT_ID_PREFIX}${sourceId}`
}

/** The inverse, for rebuilding a provider from a saved account (§4). */
export function eventKitSourceId(accountId: AccountId): string {
  if (!accountId.startsWith(ACCOUNT_ID_PREFIX)) {
    return accountId
  }
  return accountId.slice(ACCOUNT_ID_PREFIX.length)
}

/**
 * One macOS calendar source — iCloud, an Exchange account — behind the
 * provider interface (docs/spec.md §3). There is no credential and no
 * network: everything comes from the shared helper process.
 */
export class EventKitProvider implements CalendarProvider {
  readonly kind: ProviderKind = 'eventkit'

  constructor(
    readonly accountId: AccountId,
    private readonly sourceId: string,
    private readonly helper: EventKitRequester,
    private readonly logger: AppLogger,
  ) {}

  isAuthenticated(): boolean {
    return true
  }

  canListCalendars(): boolean {
    return true
  }

  async listCalendars(): Promise<CalendarSummary[]> {
    const calendars = await this.helper.request(
      'calendars',
      { sourceId: this.sourceId },
      eventKitCalendarListSchema,
    )
    return calendars.map((calendar) => ({
      id: calendar.id,
      title: calendar.title,
      primary: calendar.isDefault,
    }))
  }

  async fetchEvents(
    calendarIds: readonly CalendarId[],
    range: TimeRange,
  ): Promise<CalendarEvent[]> {
    const raw = await this.helper.request(
      'events',
      {
        sourceId: this.sourceId,
        calendarIds: [...calendarIds],
        start: range.start,
        end: range.end,
      },
      eventKitEventListSchema,
    )
    this.logger.debug('read events from the calendar store', { events: raw.length })

    // Grouped because a MappingContext carries one calendar, and the helper
    // answers for every calendar of the source in one reply.
    const events: CalendarEvent[] = []
    for (const [calendarId, forCalendar] of groupByCalendar(raw)) {
      events.push(...mapEventKitEvents(forCalendar, { accountId: this.accountId, calendarId }))
    }
    return events
  }

  /** Nothing to revoke: the grant belongs to the app, not to this account. */
  async disconnect(): Promise<void> {
    await Promise.resolve()
  }
}

/** Every event lands in exactly one group, so none is lost and none is doubled. */
function groupByCalendar(
  events: readonly EventKitEvent[],
): ReadonlyMap<CalendarId, EventKitEvent[]> {
  const grouped = new Map<CalendarId, EventKitEvent[]>()
  for (const event of events) {
    const existing = grouped.get(event.calendarId)
    if (existing) {
      existing.push(event)
      continue
    }
    grouped.set(event.calendarId, [event])
  }
  return grouped
}
