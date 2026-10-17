import type { Mock } from 'vitest'
import { describe, expect, it, vi } from 'vitest'
import { EventKitAuthorizer } from '../../src/main/calendar/providers/eventkit/EventKitAuthorizer.ts'
import {
  EventKitProvider,
  eventKitAccountId,
  eventKitSourceId,
} from '../../src/main/calendar/providers/eventkit/EventKitProvider.ts'
import type { EventKitRequester } from '../../src/main/calendar/providers/eventkit/EventKitHelperProcess.ts'
import {
  EVENTKIT_AUTHORIZE_TIMEOUT_MS,
  EVENTKIT_REQUEST_TIMEOUT_MS,
  eventKitAuthorizationSchema,
  eventKitCalendarListSchema,
  eventKitEventListSchema,
  eventKitSourceListSchema,
  type EventKitEvent,
} from '../../src/main/calendar/providers/eventkit/EventKitProtocol.ts'
import { silentLogger } from '../mocks/logger.ts'

/**
 * The requester interface is deliberately narrow, so a fake is a plain object
 * and no cast is needed.
 *
 * The spy comes back beside the fake rather than being read off it, because
 * asserting on `helper.request` would be passing an unbound method around.
 */
function helperReturning(...results: unknown[]): { helper: EventKitRequester; request: Mock } {
  const request = vi.fn()
  for (const result of results) {
    request.mockResolvedValueOnce(result)
  }
  return { helper: { request }, request }
}

/** Typed as the wire shape, so a fixture cannot drift from the schema. */
function anEvent({ id, calendarId }: Pick<EventKitEvent, 'id' | 'calendarId'>): EventKitEvent {
  return {
    id,
    calendarId,
    externalId: `uid-${id}`,
    title: `Event ${id}`,
    start: '2026-10-17T09:00:00+01:00',
    end: '2026-10-17T09:15:00+01:00',
    isAllDay: false,
    url: null,
    location: null,
    notes: null,
    status: 'confirmed',
    selfDeclined: false,
  }
}

describe('eventKitAccountId', () => {
  it('namespaces the source identifier', () => {
    expect(eventKitAccountId('ABC')).toBe('eventkit:ABC')
  })

  it('round-trips back to the source identifier', () => {
    expect(eventKitSourceId(eventKitAccountId('ABC'))).toBe('ABC')
  })
})

describe('EventKitProvider', () => {
  it('maps the helper events for its own account', async () => {
    const { helper } = helperReturning([
      {
        id: 'E1',
        calendarId: 'cal-1',
        externalId: 'uid-1',
        title: 'Standup',
        start: '2026-10-17T09:00:00+01:00',
        end: '2026-10-17T09:15:00+01:00',
        isAllDay: false,
        url: null,
        location: null,
        notes: null,
        status: 'confirmed',
        selfDeclined: false,
      },
    ])
    const provider = new EventKitProvider('eventkit:src', 'src', helper, silentLogger())

    const events = await provider.fetchEvents(['cal-1'], {
      start: '2026-10-17T00:00:00+01:00',
      end: '2026-10-18T00:00:00+01:00',
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ accountId: 'eventkit:src', title: 'Standup' })
  })

  it('keeps every event exactly once when the reply spans several calendars', async () => {
    const { helper } = helperReturning([
      anEvent({ id: 'E1', calendarId: 'cal-1' }),
      anEvent({ id: 'E2', calendarId: 'cal-2' }),
      anEvent({ id: 'E3', calendarId: 'cal-1' }),
    ])
    const provider = new EventKitProvider('eventkit:src', 'src', helper, silentLogger())

    const events = await provider.fetchEvents(['cal-1', 'cal-2'], {
      start: '2026-10-17T00:00:00+01:00',
      end: '2026-10-18T00:00:00+01:00',
    })

    expect(events.map((event) => event.id)).toEqual([
      'eventkit:src:cal-1:E1',
      'eventkit:src:cal-1:E3',
      'eventkit:src:cal-2:E2',
    ])
  })

  it('asks the helper for its own source, using the ops the helper answers', async () => {
    const { helper, request } = helperReturning([], [])
    const provider = new EventKitProvider('eventkit:src', 'src', helper, silentLogger())

    await provider.fetchEvents(['cal-1'], {
      start: '2026-10-17T00:00:00+01:00',
      end: '2026-10-18T00:00:00+01:00',
    })
    await provider.listCalendars()

    expect(request.mock.calls).toEqual([
      [
        'events',
        {
          sourceId: 'src',
          calendarIds: ['cal-1'],
          start: '2026-10-17T00:00:00+01:00',
          end: '2026-10-18T00:00:00+01:00',
        },
        eventKitEventListSchema,
      ],
      ['calendars', { sourceId: 'src' }, eventKitCalendarListSchema],
    ])
  })

  /**
   * An empty selection is the user having unticked every box, which must
   * mean no events rather than every event in the source. Answered without
   * the helper, so unticking the last box cannot even spawn it.
   */
  it('reads nothing when no calendar is selected', async () => {
    const { helper, request } = helperReturning()
    const provider = new EventKitProvider('eventkit:src', 'src', helper, silentLogger())

    const events = await provider.fetchEvents([], {
      start: '2026-10-17T00:00:00+01:00',
      end: '2026-10-18T00:00:00+01:00',
    })

    expect(events).toEqual([])
    expect(request).not.toHaveBeenCalled()
  })

  it('lists its source calendars and reports the default as primary', async () => {
    const { helper } = helperReturning([{ id: 'cal-1', title: 'Home', isDefault: true }])
    const provider = new EventKitProvider('eventkit:src', 'src', helper, silentLogger())

    await expect(provider.listCalendars()).resolves.toEqual([
      { id: 'cal-1', title: 'Home', primary: true },
    ])
  })

  it('disconnects without calling the helper, because there is nothing to revoke', async () => {
    const { helper, request } = helperReturning()
    const provider = new EventKitProvider('eventkit:src', 'src', helper, silentLogger())

    await expect(provider.disconnect()).resolves.toBeUndefined()
    expect(request).not.toHaveBeenCalled()
  })
})

describe('EventKitAuthorizer', () => {
  it('returns one result per source, defaulting to that source default calendar', async () => {
    const { helper, request } = helperReturning({ status: 'granted' }, [
      { id: 'icloud', title: 'iCloud', defaultCalendarId: 'cal-1' },
      { id: 'work', title: 'Work', defaultCalendarId: null },
    ])
    const authorizer = new EventKitAuthorizer(helper, silentLogger())

    const results = await authorizer.authenticate()

    expect(request.mock.calls).toEqual([
      ['authorize', {}, eventKitAuthorizationSchema, EVENTKIT_AUTHORIZE_TIMEOUT_MS],
      ['sources', {}, eventKitSourceListSchema],
    ])

    expect(results).toEqual([
      {
        identity: { providerAccountId: 'eventkit:icloud', label: 'iCloud' },
        grantedScopes: ['eventkit.read'],
        defaultCalendarIds: ['cal-1'],
      },
      {
        identity: { providerAccountId: 'eventkit:work', label: 'Work' },
        grantedScopes: ['eventkit.read'],
        defaultCalendarIds: [],
      },
    ])
  })

  /**
   * The bound is there to release a prompt nobody will ever answer, not to
   * police how long the user thinks about it. Anything near the ordinary
   * request timeout would report failure after macOS had granted access.
   */
  it('waits minutes, not seconds, for the macOS prompt to be answered', () => {
    expect(EVENTKIT_AUTHORIZE_TIMEOUT_MS).toBeGreaterThanOrEqual(5 * 60_000)
    expect(EVENTKIT_AUTHORIZE_TIMEOUT_MS).toBeGreaterThan(EVENTKIT_REQUEST_TIMEOUT_MS)
  })

  it('throws when the user refuses access', async () => {
    const { helper } = helperReturning({ status: 'denied' })
    const authorizer = new EventKitAuthorizer(helper, silentLogger())

    await expect(authorizer.authenticate()).rejects.toMatchObject({ kind: 'denied' })
  })

  it('treats write-only access as refusal, because the app only reads', async () => {
    const { helper } = helperReturning({ status: 'writeOnly' })
    const authorizer = new EventKitAuthorizer(helper, silentLogger())

    await expect(authorizer.authenticate()).rejects.toMatchObject({ kind: 'writeOnly' })
  })

  it('returns no accounts when the Mac has no calendar sources', async () => {
    const { helper } = helperReturning({ status: 'granted' }, [])
    const authorizer = new EventKitAuthorizer(helper, silentLogger())

    await expect(authorizer.authenticate()).resolves.toEqual([])
  })
})
