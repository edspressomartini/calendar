import { describe, expect, it } from 'vitest'
import {
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
