/*
 * The helper is a separate process and therefore a trust boundary: nothing it
 * sends is used before it is parsed, for the same reason nothing from the
 * renderer is (docs/spec.md §8.5).
 */

import { z } from 'zod'

export const EVENTKIT_REQUEST_TIMEOUT_MS = 10_000

/**
 * `authorize` alone, because it is the one request whose reply waits on a
 * human: the helper blocks inside `requestFullAccessToEvents()` until the
 * macOS prompt is answered. At the ordinary ten seconds, a user who reads the
 * prompt and then clicks Allow is told the connection failed after macOS has
 * already granted access.
 *
 * Five minutes rather than no timeout at all. A prompt nobody answers — the
 * user walked away, or the dialog is behind a full-screen app — would
 * otherwise hold a pending entry and leave the Accounts pane spinning for the
 * life of the process. Five minutes is far past any plausible answer and
 * still settles on its own.
 */
export const EVENTKIT_AUTHORIZE_TIMEOUT_MS = 5 * 60_000

const MAX_TEXT_LENGTH = 4_000

const identifier = z.string().min(1).max(512)

export const eventKitSourceSchema = z.strictObject({
  id: identifier,
  title: z.string().min(1).max(120),
  defaultCalendarId: identifier.nullable(),
})

export const eventKitCalendarSchema = z.strictObject({
  id: identifier,
  // Bounded generously for the same reason as an event title: one over-long
  // calendar name must not fail the whole list.
  title: z.string().max(MAX_TEXT_LENGTH),
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

/**
 * The helper's answer to having asked, which is not the same list as the
 * statuses `EKEventStore` holds.
 *
 * `notDetermined` is not among them. By the time the helper replies it has
 * either read a settled status or made the request, so "not determined yet"
 * has become one of the four settled names or `promptUnavailable`. It used to
 * be here, and its only use on arrival was being folded into `denied`.
 *
 * `promptUnavailable` is a request that could not be made: it threw, or came
 * back false while leaving the status at `notDetermined`. macOS will not show
 * a calendar prompt for an app bundle without
 * `NSCalendarsFullAccessUsageDescription`, which is the ordinary cause. Kept
 * apart from `denied` because nobody refused anything, and telling the user
 * they did — then sending them to System Settings — is false twice over.
 */
export const eventKitAuthorizationSchema = z.strictObject({
  status: z.enum(['granted', 'denied', 'restricted', 'writeOnly', 'promptUnavailable']),
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

/*
 * The list caps. Named rather than inline because three parties need the
 * numbers: the schemas below, the helper's own `boundedForWire` (which trims
 * to them, so an over-long list can never fail the parse of a whole frame),
 * and the provider, which logs a count when a list arrives at exactly its cap
 * so that a trim is visible rather than silent.
 */
export const EVENTKIT_MAX_SOURCES = 50
export const EVENTKIT_MAX_CALENDARS = 500
export const EVENTKIT_MAX_EVENTS = 2_000

export const eventKitSourceListSchema = z.array(eventKitSourceSchema).max(EVENTKIT_MAX_SOURCES)
export const eventKitCalendarListSchema = z
  .array(eventKitCalendarSchema)
  .max(EVENTKIT_MAX_CALENDARS)
export const eventKitEventListSchema = z.array(eventKitEventSchema).max(EVENTKIT_MAX_EVENTS)

export type EventKitSource = z.infer<typeof eventKitSourceSchema>
export type EventKitCalendar = z.infer<typeof eventKitCalendarSchema>
export type EventKitEvent = z.infer<typeof eventKitEventSchema>
export type EventKitAuthorization = z.infer<typeof eventKitAuthorizationSchema>
export type EventKitMessage = z.infer<typeof eventKitMessageSchema>
export type EventKitErrorKind = z.infer<typeof errorKindSchema>
