import { describe, expect, it } from 'vitest'
import {
  CHANNELS,
  CHANNEL_CALLERS,
  PUSH_CHANNELS,
  WINDOW_ROLES,
} from '../../src/shared/ipc/channels.ts'
import {
  REQUEST_SCHEMAS,
  addTodoSchema,
  joinEventSchema,
  moveToDisplaySchema,
  setSelectedCalendarsSchema,
  todoSnapshotSchema,
  updateSettingsSchema,
} from '../../src/shared/ipc/contract.ts'
import { MAX_TODO_TITLE_LENGTH } from '../../src/shared/constants.ts'

/** Types vanish at runtime, so the boundary needs real checks (docs/spec.md §8.5). */
describe('IPC contract', () => {
  it('covers every channel the renderer can invoke', () => {
    const invokable = Object.values(CHANNELS).filter((channel) => !PUSH_CHANNELS.includes(channel))

    for (const channel of invokable) {
      expect(REQUEST_SCHEMAS).toHaveProperty(channel)
    }
  })

  it('gives push channels no request schema, since nothing is sent inbound', () => {
    for (const channel of PUSH_CHANNELS) {
      expect(REQUEST_SCHEMAS).not.toHaveProperty(channel)
    }
  })

  it('declares which window may use each channel', () => {
    for (const channel of Object.values(CHANNELS)) {
      expect(CHANNEL_CALLERS[channel].length).toBeGreaterThan(0)
    }
  })

  it('rejects unexpected properties', () => {
    expect(joinEventSchema.safeParse({ eventId: 'a', extra: 1 }).success).toBe(false)
    expect(
      setSelectedCalendarsSchema.safeParse({ accountId: 'a', calendarIds: [], evil: true }).success,
    ).toBe(false)
  })

  it('rejects wrong types and empty identifiers', () => {
    expect(joinEventSchema.safeParse({ eventId: '' }).success).toBe(false)
    expect(joinEventSchema.safeParse({ eventId: 42 }).success).toBe(false)
    expect(joinEventSchema.safeParse({}).success).toBe(false)
    expect(joinEventSchema.safeParse(null).success).toBe(false)
  })

  it('bounds string length so a hostile renderer cannot send unbounded payloads', () => {
    expect(joinEventSchema.safeParse({ eventId: 'x'.repeat(513) }).success).toBe(false)
  })

  it('bounds the number of calendars', () => {
    const calendarIds = Array.from({ length: 101 }, (_unused, index) => `cal-${index}`)
    expect(setSelectedCalendarsSchema.safeParse({ accountId: 'a', calendarIds }).success).toBe(
      false,
    )
  })

  it('keeps settings within their documented ranges', () => {
    expect(updateSettingsSchema.safeParse({ syncIntervalMinutes: 3 }).success).toBe(true)
    expect(updateSettingsSchema.safeParse({ syncIntervalMinutes: 0 }).success).toBe(false)
    expect(updateSettingsSchema.safeParse({ syncIntervalMinutes: 60 }).success).toBe(false)
    expect(updateSettingsSchema.safeParse({ notificationLeadMinutes: null }).success).toBe(true)
    expect(updateSettingsSchema.safeParse({ notificationLeadMinutes: 99 }).success).toBe(false)
    expect(updateSettingsSchema.safeParse({ theme: 'neon' }).success).toBe(false)
  })

  it('only lets the focusable window capture text', () => {
    expect(WINDOW_ROLES).toContain('quickadd')
    expect(CHANNEL_CALLERS[CHANNELS.todosAdd]).toContain('quickadd')
    // Everything else the quick-add window has no business doing.
    expect(CHANNEL_CALLERS[CHANNELS.todosRemove]).not.toContain('quickadd')
    expect(CHANNEL_CALLERS[CHANNELS.settingsUpdate]).not.toContain('quickadd')
  })

  it('trims and bounds a TODO title, since dictation pads it', () => {
    expect(addTodoSchema.parse({ title: '  Call the bank  ' }).title).toBe('Call the bank')
    expect(addTodoSchema.safeParse({ title: '   ' }).success).toBe(false)
    expect(addTodoSchema.safeParse({ title: 'x'.repeat(MAX_TODO_TITLE_LENGTH + 1) }).success).toBe(
      false,
    )
  })

  it('refuses a TODO snapshot filed under something that is not a day', () => {
    const snapshot = { today: '2026-09-30', overdue: [], current: [], upcoming: [] }
    expect(todoSnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(todoSnapshotSchema.safeParse({ ...snapshot, today: '2026-02-31' }).success).toBe(false)
    expect(todoSnapshotSchema.safeParse({ ...snapshot, today: 'tomorrow' }).success).toBe(false)
  })

  it('keeps the widget text scale inside what stays readable and usable', () => {
    expect(updateSettingsSchema.safeParse({ widgetTextScale: 150 }).success).toBe(true)
    expect(updateSettingsSchema.safeParse({ widgetTextScale: 60 }).success).toBe(false)
    expect(updateSettingsSchema.safeParse({ widgetTextScale: 400 }).success).toBe(false)
    expect(updateSettingsSchema.safeParse({ widgetTextScale: 102.5 }).success).toBe(false)
  })

  it('accepts only the two places the TODO list can go', () => {
    expect(updateSettingsSchema.safeParse({ todoPlacement: 'above' }).success).toBe(true)
    expect(updateSettingsSchema.safeParse({ todoPlacement: 'below' }).success).toBe(true)
    expect(updateSettingsSchema.safeParse({ todoPlacement: 'floating' }).success).toBe(false)
  })

  it('takes only a shortcut main could actually register', () => {
    expect(updateSettingsSchema.safeParse({ quickAddShortcut: 'Command+Shift+K' }).success).toBe(
      true,
    )
    // globalShortcut.register throws on these; the boundary rejects them first.
    expect(updateSettingsSchema.safeParse({ quickAddShortcut: 'K' }).success).toBe(false)
    expect(updateSettingsSchema.safeParse({ quickAddShortcut: 'Shift+K' }).success).toBe(false)
    expect(updateSettingsSchema.safeParse({ quickAddShortcut: '' }).success).toBe(false)
    expect(
      updateSettingsSchema.safeParse({ quickAddShortcut: 'Command+'.repeat(40) }).success,
    ).toBe(false)
  })

  it('rejects an empty settings patch', () => {
    expect(updateSettingsSchema.safeParse({}).success).toBe(false)
  })

  it('validates display moves', () => {
    const display = { id: 1, label: 'Built-in', width: 1512, height: 982 }
    expect(moveToDisplaySchema.safeParse({ display, corner: 'topRight' }).success).toBe(true)
    expect(moveToDisplaySchema.safeParse({ display, corner: 'middle' }).success).toBe(false)
    expect(
      moveToDisplaySchema.safeParse({ display: { ...display, width: -1 }, corner: 'topRight' })
        .success,
    ).toBe(false)
  })
})
