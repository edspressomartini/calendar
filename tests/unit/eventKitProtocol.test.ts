import { describe, expect, it } from 'vitest'
import {
  eventKitAuthorizationSchema,
  eventKitCalendarSchema,
  eventKitEventSchema,
  eventKitMessageSchema,
} from '../../src/main/calendar/providers/eventkit/EventKitProtocol.ts'

const event = {
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
}

describe('eventKitEventSchema', () => {
  it('accepts a well-formed event', () => {
    expect(eventKitEventSchema.parse(event)).toEqual(event)
  })

  it('rejects an unknown field, so a helper change cannot pass silently', () => {
    expect(eventKitEventSchema.safeParse({ ...event, attendees: [] }).success).toBe(false)
  })

  it('accepts a title longer than the display cap, which the mapper truncates', () => {
    const long = { ...event, title: 'x'.repeat(201) }
    expect(eventKitEventSchema.safeParse(long).success).toBe(true)
  })

  it('rejects a title beyond the ingest bound', () => {
    const absurd = { ...event, title: 'x'.repeat(4_001) }
    expect(eventKitEventSchema.safeParse(absurd).success).toBe(false)
  })
})

describe('eventKitCalendarSchema', () => {
  it('accepts a calendar title longer than the display cap', () => {
    const calendar = { id: 'cal-1', title: 'x'.repeat(201), isDefault: false }
    expect(eventKitCalendarSchema.safeParse(calendar).success).toBe(true)
  })
})

describe('eventKitAuthorizationSchema', () => {
  /**
   * The helper answers `authorize` with the status it holds *after* asking,
   * which is how a prompt that never appeared is told apart from a Deny. The
   * two must not share a name.
   */
  it('carries a prompt that could not be shown as its own status', () => {
    const parsed = eventKitAuthorizationSchema.parse({ status: 'promptUnavailable' })
    expect(parsed.status).toBe('promptUnavailable')
  })

  it('accepts every settled status', () => {
    for (const status of ['granted', 'denied', 'restricted', 'writeOnly']) {
      expect(eventKitAuthorizationSchema.safeParse({ status }).success).toBe(true)
    }
  })

  /**
   * `notDetermined` is a status the store holds, never an answer to having
   * asked: by the time the helper replies it has either read a settled status
   * or made the request, so the undetermined case has become
   * `promptUnavailable`. Leaving it on the wire left a name whose only use was
   * being folded into `denied` on arrival.
   */
  it('does not accept notDetermined, which is no longer an answer', () => {
    expect(eventKitAuthorizationSchema.safeParse({ status: 'notDetermined' }).success).toBe(false)
  })
})

describe('eventKitMessageSchema', () => {
  it('reads a successful reply', () => {
    const parsed = eventKitMessageSchema.parse({ id: 7, ok: true, result: { status: 'granted' } })
    expect(parsed).toEqual({ id: 7, ok: true, result: { status: 'granted' } })
  })

  it('reads a failed reply', () => {
    const parsed = eventKitMessageSchema.parse({ id: 7, ok: false, error: { kind: 'denied' } })
    expect(parsed).toEqual({ id: 7, ok: false, error: { kind: 'denied' } })
  })

  it('reads a change push, which carries no id', () => {
    expect(eventKitMessageSchema.parse({ event: 'changed' })).toEqual({ event: 'changed' })
  })

  it('rejects a reply that is neither ok nor an error', () => {
    expect(eventKitMessageSchema.safeParse({ id: 7 }).success).toBe(false)
  })
})
