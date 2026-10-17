/*
 * The helper is a separate process and therefore a trust boundary: nothing it
 * sends is used before it is parsed, for the same reason nothing from the
 * renderer is (docs/spec.md §8.5).
 */

import { z } from 'zod'
import { MAX_EVENT_TITLE_LENGTH } from '../../../../shared/constants.ts'

export const EVENTKIT_REQUEST_TIMEOUT_MS = 10_000

const MAX_TEXT_LENGTH = 4_000

const identifier = z.string().min(1).max(512)

export const eventKitSourceSchema = z.strictObject({
  id: identifier,
  title: z.string().min(1).max(120),
  defaultCalendarId: identifier.nullable(),
})

export const eventKitCalendarSchema = z.strictObject({
  id: identifier,
  title: z.string().max(MAX_EVENT_TITLE_LENGTH),
  isDefault: z.boolean(),
})

export const eventKitEventSchema = z.strictObject({
  id: identifier,
  calendarId: identifier,
  externalId: z.string().max(512),
  // Bounded generously, not at the display cap: one over-long title must not
  // fail the whole array and cost the user their agenda. The mapper truncates
  // to MAX_EVENT_TITLE_LENGTH, as the Google path does.
  title: z.string().max(MAX_TEXT_LENGTH),
  start: z.string().min(1).max(40),
  end: z.string().min(1).max(40),
  isAllDay: z.boolean(),
  url: z.string().max(2_048).nullable(),
  location: z.string().max(MAX_TEXT_LENGTH).nullable(),
  notes: z.string().max(MAX_TEXT_LENGTH).nullable(),
  status: z.enum(['none', 'confirmed', 'tentative', 'cancelled']),
  selfDeclined: z.boolean(),
})

export const eventKitAuthorizationSchema = z.strictObject({
  status: z.enum(['granted', 'denied', 'restricted', 'writeOnly', 'notDetermined']),
})

const errorKindSchema = z.enum([
  'denied',
  'restricted',
  'writeOnly',
  'unknown_source',
  'store_failure',
  'bad_request',
])

const replySchema = z.union([
  z.strictObject({ id: z.number().int(), ok: z.literal(true), result: z.unknown() }),
  z.strictObject({
    id: z.number().int(),
    ok: z.literal(false),
    error: z.strictObject({ kind: errorKindSchema }),
  }),
])

const pushSchema = z.strictObject({ event: z.literal('changed') })

export const eventKitMessageSchema = z.union([replySchema, pushSchema])

export const eventKitSourceListSchema = z.array(eventKitSourceSchema).max(50)
export const eventKitCalendarListSchema = z.array(eventKitCalendarSchema).max(500)
export const eventKitEventListSchema = z.array(eventKitEventSchema).max(2_000)

export type EventKitSource = z.infer<typeof eventKitSourceSchema>
export type EventKitCalendar = z.infer<typeof eventKitCalendarSchema>
export type EventKitEvent = z.infer<typeof eventKitEventSchema>
export type EventKitAuthorization = z.infer<typeof eventKitAuthorizationSchema>
export type EventKitMessage = z.infer<typeof eventKitMessageSchema>
export type EventKitErrorKind = z.infer<typeof errorKindSchema>
