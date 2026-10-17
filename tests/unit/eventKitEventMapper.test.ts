import { describe, expect, it } from 'vitest'
import {
  mapEventKitEvent,
  mapEventKitEvents,
} from '../../src/main/calendar/providers/eventkit/eventKitEventMapper.ts'
import type { EventKitEvent } from '../../src/main/calendar/providers/eventkit/EventKitProtocol.ts'
import { MAX_EVENT_TITLE_LENGTH } from '../../src/shared/constants.ts'

const context = { accountId: 'eventkit:icloud', calendarId: 'cal-1' }

function event(patch: Partial<EventKitEvent> = {}): EventKitEvent {
  return {
    id: 'ABC-123',
    calendarId: 'cal-1',
    externalId: 'uid@icloud.com',
    title: 'Standup',
    start: '2026-10-17T09:00:00+01:00',
    end: '2026-10-17T09:15:00+01:00',
    isAllDay: false,
    url: null,
    location: null,
    notes: null,
    status: 'confirmed',
    selfDeclined: false,
    ...patch,
  }
}

describe('mapEventKitEvent', () => {
  it('normalises timestamps to UTC and namespaces the id', () => {
    const mapped = mapEventKitEvent(event(), context)
    expect(mapped).toMatchObject({
      id: 'eventkit:icloud:cal-1:ABC-123',
      accountId: 'eventkit:icloud',
      iCalUID: 'uid@icloud.com',
      start: '2026-10-17T08:00:00.000Z',
      isAllDay: false,
    })
  })

  it('drops a cancelled event', () => {
    expect(mapEventKitEvent(event({ status: 'cancelled' }), context)).toBeNull()
  })

  it('drops an event you declined', () => {
    expect(mapEventKitEvent(event({ selfDeclined: true }), context)).toBeNull()
  })

  it('drops an event with an unparseable timestamp', () => {
    expect(mapEventKitEvent(event({ start: 'tomorrow-ish' }), context)).toBeNull()
  })

  it('falls back to a placeholder title and caps a long one', () => {
    expect(mapEventKitEvent(event({ title: '   ' }), context)?.title).toBe('(no title)')
    expect(mapEventKitEvent(event({ title: 'x'.repeat(300) }), context)?.title.length).toBeLessThan(
      300,
    )
  })

  it('prefers the url field for a meeting link', () => {
    const mapped = mapEventKitEvent(event({ url: 'https://meet.google.com/abc-defg-hij' }), context)
    expect(mapped?.conferenceUrl).toBe('https://meet.google.com/abc-defg-hij')
  })

  it('finds a link in the notes when there is no url', () => {
    const mapped = mapEventKitEvent(
      event({ notes: 'Dial in: https://acme.zoom.us/j/123456789 see you there' }),
      context,
    )
    expect(mapped?.conferenceUrl).toBe('https://acme.zoom.us/j/123456789')
  })

  it('refuses a link on a host that is not allowed', () => {
    const mapped = mapEventKitEvent(event({ url: 'https://evil.example/join' }), context)
    expect(mapped?.conferenceUrl).toBeUndefined()
  })

  it('keeps an all-day event marked as all-day', () => {
    const mapped = mapEventKitEvent(
      event({
        isAllDay: true,
        start: '2026-10-17T00:00:00+01:00',
        end: '2026-10-18T00:00:00+01:00',
      }),
      context,
    )
    expect(mapped?.isAllDay).toBe(true)
  })

  // The protocol lets a 4000-character title through on the understanding that
  // the cap lives here, so the exact length is pinned rather than bounded.
  it('truncates a title to exactly the display cap', () => {
    const mapped = mapEventKitEvent(event({ title: 'x'.repeat(4_000) }), context)
    expect(MAX_EVENT_TITLE_LENGTH).toBe(200)
    expect(mapped?.title).toBe('x'.repeat(MAX_EVENT_TITLE_LENGTH))
  })

  it('normalises the end timestamp and carries the calendar id', () => {
    const mapped = mapEventKitEvent(event(), context)
    expect(mapped?.end).toBe('2026-10-17T08:15:00.000Z')
    expect(mapped?.calendarId).toBe('cal-1')
  })

  it('takes the calendar id from the context, not from the helper', () => {
    const mapped = mapEventKitEvent(event({ calendarId: 'a-different-calendar' }), context)
    expect(mapped?.calendarId).toBe('cal-1')
    expect(mapped?.id).toBe('eventkit:icloud:cal-1:ABC-123')
  })

  it('drops an event whose end is unparseable', () => {
    expect(mapEventKitEvent(event({ end: 'whenever' }), context)).toBeNull()
  })

  it('finds a link in the location when there is no url or note', () => {
    const mapped = mapEventKitEvent(
      event({ location: 'Room 3 or https://teams.microsoft.com/l/meetup-join/19%3aabc' }),
      context,
    )
    expect(mapped?.conferenceUrl).toBe('https://teams.microsoft.com/l/meetup-join/19%3aabc')
  })

  it('carries neither the location nor the notes into the mapped event', () => {
    const mapped = mapEventKitEvent(
      event({
        location: 'Dr Tarr, 14 Acacia Avenue',
        notes: 'Discuss the redundancy list before https://acme.zoom.us/j/1',
      }),
      context,
    )

    expect(mapped).not.toBeNull()
    expect(Object.keys(mapped ?? {}).sort()).toEqual([
      'accountId',
      'calendarId',
      'conferenceUrl',
      'end',
      'iCalUID',
      'id',
      'isAllDay',
      'start',
      'title',
    ])
    expect(JSON.stringify(mapped)).not.toContain('Acacia')
    expect(JSON.stringify(mapped)).not.toContain('redundancy')
  })

  it('omits conferenceUrl entirely rather than setting it undefined', () => {
    const mapped = mapEventKitEvent(event(), context)
    expect(mapped).not.toBeNull()
    expect(Object.hasOwn(mapped ?? {}, 'conferenceUrl')).toBe(false)
  })

  it('keeps a tentative event', () => {
    expect(mapEventKitEvent(event({ status: 'tentative' }), context)).not.toBeNull()
  })
})

describe('mapEventKitEvents', () => {
  it('keeps only the events worth showing, in order', () => {
    const mapped = mapEventKitEvents(
      [
        event({ id: 'keep-1' }),
        event({ id: 'drop-cancelled', status: 'cancelled' }),
        event({ id: 'drop-declined', selfDeclined: true }),
        event({ id: 'drop-undated', start: 'soon' }),
        event({ id: 'keep-2' }),
      ],
      context,
    )

    expect(mapped.map((item) => item.id)).toEqual([
      'eventkit:icloud:cal-1:keep-1',
      'eventkit:icloud:cal-1:keep-2',
    ])
  })

  it('returns an empty list for an empty input', () => {
    expect(mapEventKitEvents([], context)).toEqual([])
  })
})
