import { z } from 'zod'
import {
  ACCOUNT_COLOURS,
  MAX_EVENT_TITLE_LENGTH,
  MAX_NOTIFICATION_LEAD_MINUTES,
  MAX_SHORTCUT_LENGTH,
  MAX_SYNC_INTERVAL_MINUTES,
  MAX_TODOS,
  MAX_TODO_TITLE_LENGTH,
  MAX_WIDGET_TEXT_SCALE,
  MIN_SYNC_INTERVAL_MINUTES,
  MIN_WIDGET_TEXT_SCALE,
} from '../constants.ts'
import { CHANNELS } from './channels.ts'
import { isValidAccelerator } from '../shortcuts.ts'
import { isLocalDayKey } from '../time.ts'
import { isValidTimeZone } from '../timezone.ts'

/**
 * One schema per channel. Types vanish at runtime, so main validates every
 * inbound payload against these, and the renderer validates what it receives
 * back (docs/spec.md §8.5).
 */

const identifier = z.string().min(1).max(512)
const label = z.string().min(1).max(120)
const isoTimestamp = z.string().min(1).max(40)
const colour = z.enum(ACCOUNT_COLOURS)
const noPayload = z.undefined()

/** Only zones the runtime actually knows; anything else is rejected (§8.5). */
const timeZoneName = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, { message: 'unknown time zone' })

export const accountIdPayloadSchema = z.strictObject({ accountId: identifier })
export const connectAccountSchema = z.strictObject({ provider: z.literal('google') })

export const updateAccountSchema = z.strictObject({
  accountId: identifier,
  label: label.optional(),
  colour: colour.optional(),
})

const widgetTextScale = z.number().int().min(MIN_WIDGET_TEXT_SCALE).max(MAX_WIDGET_TEXT_SCALE)
const todoPlacement = z.enum(['above', 'below'])

/** Rejected here rather than at globalShortcut.register, which throws. */
const quickAddShortcut = z
  .string()
  .max(MAX_SHORTCUT_LENGTH)
  .refine(isValidAccelerator, { message: 'not a usable shortcut' })

export const setSelectedCalendarsSchema = z.strictObject({
  accountId: identifier,
  calendarIds: z.array(identifier).max(100),
})

export const displayKeySchema = z.strictObject({
  id: z.number().int(),
  label: z.string().max(200),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

export const moveToDisplaySchema = z.strictObject({
  display: displayKeySchema,
  corner: z.enum(['topRight', 'topLeft', 'bottomRight', 'bottomLeft', 'remembered']),
})

export const updateSettingsSchema = z
  .strictObject({
    viewMode: z.enum(['merged', 'split']),
    theme: z.enum(['system', 'light', 'dark']),
    syncIntervalMinutes: z
      .number()
      .int()
      .min(MIN_SYNC_INTERVAL_MINUTES)
      .max(MAX_SYNC_INTERVAL_MINUTES),
    notificationLeadMinutes: z.number().int().min(0).max(MAX_NOTIFICATION_LEAD_MINUTES).nullable(),
    dayStartHour: z.number().int().min(0).max(23),
    dayEndHour: z.number().int().min(1).max(24),
    secondaryTimeZone: timeZoneName.nullable(),
    widgetTextScale: widgetTextScale,
    todoPlacement: todoPlacement,
    quickAddShortcut: quickAddShortcut,
    hideTitlesInMenuBar: z.boolean(),
    privacyMode: z.boolean(),
    launchAtLogin: z.boolean(),
    alwaysOnTop: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'no settings supplied' })

export const setPinnedSchema = z.strictObject({ pinned: z.boolean() })
export const joinEventSchema = z.strictObject({ eventId: identifier })

/** Dictated text arrives with trailing whitespace, so it is trimmed first. */
export const addTodoSchema = z.strictObject({
  title: z.string().trim().min(1).max(MAX_TODO_TITLE_LENGTH),
})
export const todoIdSchema = z.strictObject({ todoId: identifier })

export const REQUEST_SCHEMAS = {
  [CHANNELS.agendaJoin]: joinEventSchema,
  [CHANNELS.widgetHide]: noPayload,
  [CHANNELS.widgetSetPinned]: setPinnedSchema,
  [CHANNELS.settingsOpen]: noPayload,
  [CHANNELS.accountsList]: noPayload,
  [CHANNELS.accountsConnect]: connectAccountSchema,
  [CHANNELS.accountsReconnect]: accountIdPayloadSchema,
  [CHANNELS.accountsDisconnect]: accountIdPayloadSchema,
  [CHANNELS.accountsUpdate]: updateAccountSchema,
  [CHANNELS.calendarsList]: accountIdPayloadSchema,
  [CHANNELS.calendarsSetSelected]: setSelectedCalendarsSchema,
  [CHANNELS.displaysList]: noPayload,
  [CHANNELS.widgetMoveToDisplay]: moveToDisplaySchema,
  [CHANNELS.settingsGet]: noPayload,
  [CHANNELS.settingsUpdate]: updateSettingsSchema,
  [CHANNELS.syncNow]: noPayload,
  [CHANNELS.alertJoin]: joinEventSchema,
  [CHANNELS.alertDismiss]: noPayload,
  [CHANNELS.alertTest]: noPayload,
  [CHANNELS.todosAdd]: addTodoSchema,
  [CHANNELS.todosToggle]: todoIdSchema,
  [CHANNELS.todosRoll]: todoIdSchema,
  [CHANNELS.todosRollAllOverdue]: noPayload,
  [CHANNELS.todosRemove]: todoIdSchema,
  [CHANNELS.quickAddClose]: noPayload,
} as const

/** What the alert window is told to display. */
export const meetingAlertSchema = z.strictObject({
  eventId: identifier,
  title: z.string().max(MAX_EVENT_TITLE_LENGTH),
  start: isoTimestamp,
  end: isoTimestamp,
  minutesRemaining: z.number().int(),
  canJoin: z.boolean(),
})

/* Outbound shapes. The renderer validates these too, so a bug in main can't
 * quietly feed the UI something unexpected. */

export const agendaItemSchema = z.strictObject({
  id: identifier,
  accountId: identifier,
  colour,
  title: z.string().max(MAX_EVENT_TITLE_LENGTH),
  start: isoTimestamp,
  end: isoTimestamp,
  isAllDay: z.boolean(),
  status: z.enum(['past', 'live', 'imminent', 'upcoming']),
  startsInMinutes: z.number().int(),
  minutesRemaining: z.number().int(),
  canJoin: z.boolean(),
})

export const agendaAccountSchema = z.strictObject({
  id: identifier,
  label,
  colour,
  status: z.enum(['ready', 'syncing', 'offline', 'needsReauth']),
  lastSyncedAt: isoTimestamp.nullable(),
})

export const agendaSnapshotSchema = z.strictObject({
  now: isoTimestamp,
  window: z.strictObject({ start: isoTimestamp, end: isoTimestamp }),
  secondaryTimeZone: timeZoneName.nullable(),
  timed: z.array(agendaItemSchema),
  allDay: z.array(agendaItemSchema),
  accounts: z.array(agendaAccountSchema),
  nextUp: agendaItemSchema.nullable(),
  viewMode: z.enum(['merged', 'split']),
  todoPlacement: todoPlacement,
  quickAddShortcut: quickAddShortcut,
  privacyMode: z.boolean(),
})

export const accountViewSchema = z.strictObject({
  id: identifier,
  provider: z.enum(['google', 'mock']),
  label,
  colour,
  status: z.enum(['ready', 'syncing', 'offline', 'needsReauth']),
  calendarIds: z.array(identifier),
  lastSyncedAt: isoTimestamp.nullable(),
  canListCalendars: z.boolean(),
})

export const calendarSummarySchema = z.strictObject({
  id: identifier,
  title: z.string().max(MAX_EVENT_TITLE_LENGTH),
  primary: z.boolean(),
})

export const displayOptionSchema = z.strictObject({
  key: displayKeySchema,
  isPrimary: z.boolean(),
  isCurrent: z.boolean(),
})

export const widgetPlacementSchema = z.strictObject({
  display: displayKeySchema.nullable(),
  corner: z.enum(['topRight', 'topLeft', 'bottomRight', 'bottomLeft', 'remembered']),
  bounds: z
    .strictObject({
      x: z.number().int(),
      y: z.number().int(),
      width: z.number().int(),
      height: z.number().int(),
    })
    .nullable(),
})

export const accountConfigSchema = z.strictObject({
  id: identifier,
  provider: z.enum(['google', 'mock']),
  label,
  colour,
  calendarIds: z.array(identifier),
})

export const appSettingsSchema = z.strictObject({
  viewMode: z.enum(['merged', 'split']),
  theme: z.enum(['system', 'light', 'dark']),
  syncIntervalMinutes: z
    .number()
    .int()
    .min(MIN_SYNC_INTERVAL_MINUTES)
    .max(MAX_SYNC_INTERVAL_MINUTES),
  notificationLeadMinutes: z.number().int().min(0).max(MAX_NOTIFICATION_LEAD_MINUTES).nullable(),
  dayStartHour: z.number().int().min(0).max(23),
  dayEndHour: z.number().int().min(1).max(24),
  secondaryTimeZone: timeZoneName.nullable(),
  widgetTextScale: widgetTextScale,
  todoPlacement: todoPlacement,
  quickAddShortcut: quickAddShortcut,
  hideTitlesInMenuBar: z.boolean(),
  privacyMode: z.boolean(),
  launchAtLogin: z.boolean(),
  alwaysOnTop: z.boolean(),
  placement: widgetPlacementSchema,
  accounts: z.array(accountConfigSchema),
})

/** Only zones the runtime knows have an equivalent here: a real calendar day. */
const localDayKey = z.string().length(10).refine(isLocalDayKey, { message: 'not a calendar day' })

export const todoSchema = z.strictObject({
  id: identifier,
  title: z.string().min(1).max(MAX_TODO_TITLE_LENGTH),
  day: localDayKey,
  createdAt: isoTimestamp,
  completedAt: isoTimestamp.nullable(),
  rollCount: z.number().int().min(0),
})

export const todoSnapshotSchema = z.strictObject({
  today: localDayKey,
  overdue: z.array(todoSchema).max(MAX_TODOS),
  current: z.array(todoSchema).max(MAX_TODOS),
  upcoming: z.array(todoSchema).max(MAX_TODOS),
})

export const accountListSchema = z.array(accountViewSchema)
export const calendarListSchema = z.array(calendarSummarySchema)
export const displayListSchema = z.array(displayOptionSchema)

export type ConnectAccountRequest = z.infer<typeof connectAccountSchema>
export type AccountIdRequest = z.infer<typeof accountIdPayloadSchema>
export type UpdateAccountRequest = z.infer<typeof updateAccountSchema>
export type SetSelectedCalendarsRequest = z.infer<typeof setSelectedCalendarsSchema>
export type MoveToDisplayRequest = z.infer<typeof moveToDisplaySchema>
export type UpdateSettingsRequest = z.infer<typeof updateSettingsSchema>
export type SetPinnedRequest = z.infer<typeof setPinnedSchema>
export type JoinEventRequest = z.infer<typeof joinEventSchema>
export type AddTodoRequest = z.infer<typeof addTodoSchema>
export type TodoIdRequest = z.infer<typeof todoIdSchema>
export type MeetingAlert = z.infer<typeof meetingAlertSchema>
