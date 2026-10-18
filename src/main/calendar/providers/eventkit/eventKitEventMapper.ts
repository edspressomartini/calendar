import { MAX_EVENT_TITLE_LENGTH } from '../../../../shared/constants.ts'
import type { CalendarEvent } from '../../../../shared/types/calendar.ts'
import { resolveConferenceUrl } from '../../conferenceLinks.ts'
import type { MappingContext } from '../google/googleEventMapper.ts'
import type { EventKitEvent } from './EventKitProtocol.ts'

/**
 * EventKit's shape to ours (docs/spec.md §3, §7).
 *
 * The helper sends location and notes solely so a meeting link can be found.
 * They are read here and dropped: nothing downstream ever sees them.
 */

/** Returns null for events that should not be shown at all. */
export function mapEventKitEvent(
  raw: EventKitEvent,
  context: MappingContext,
): CalendarEvent | null {
  if (raw.status === 'cancelled' || raw.selfDeclined) {
    return null
  }

  const start = readTimestamp(raw.start)
  const end = readTimestamp(raw.end)
  if (!start || !end) {
    return null
  }

  const conferenceUrl = resolveConferenceUrl({
    structured: [raw.url],
    text: [raw.location, raw.notes],
  })

  return {
    id: `${context.accountId}:${context.calendarId}:${raw.id}`,
    accountId: context.accountId,
    calendarId: context.calendarId,
    iCalUID: raw.externalId,
    title: readTitle(raw.title),
    start,
    end,
    isAllDay: raw.isAllDay,
    ...(conferenceUrl ? { conferenceUrl } : {}),
  }
}

export function mapEventKitEvents(
  items: readonly EventKitEvent[],
  context: MappingContext,
): CalendarEvent[] {
  const mapped: CalendarEvent[] = []
  for (const item of items) {
    const event = mapEventKitEvent(item, context)
    if (event) {
      mapped.push(event)
    }
  }
  return mapped
}

/** Titles come from anyone who can send you an invite, so they are bounded (§8.1). */
function readTitle(title: string): string {
  const trimmed = title.trim()
  if (trimmed.length === 0) {
    return '(no title)'
  }
  return trimmed.slice(0, MAX_EVENT_TITLE_LENGTH)
}

/** The helper sends ISO 8601 with an offset, including for all-day events. */
function readTimestamp(value: string): string | null {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    return null
  }
  return new Date(parsed).toISOString()
}
