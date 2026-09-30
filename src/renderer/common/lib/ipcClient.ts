import type {
  AlertBridge,
  QuickAddBridge,
  SettingsBridge,
  WidgetBridge,
} from '../../../shared/ipc/bridge.ts'
import {
  accountListSchema,
  agendaSnapshotSchema,
  appSettingsSchema,
  calendarListSchema,
  displayListSchema,
  todoSnapshotSchema,
} from '../../../shared/ipc/contract.ts'
import type { AgendaSnapshot } from '../../../shared/types/agenda.ts'
import type { TodoSnapshot } from '../../../shared/types/todo.ts'
import type { AccountView } from '../../../shared/types/account.ts'
import type { CalendarSummary } from '../../../shared/types/calendar.ts'
import type { AppSettings, DisplayOption } from '../../../shared/types/settings.ts'

/**
 * Typed wrapper over the preload bridge (docs/spec.md §4).
 *
 * Inbound data is validated here too: main validates what the renderer sends,
 * and the renderer validates what it gets back, so a bug on either side shows
 * up as an error rather than a broken screen.
 */

export function widgetApi(): WidgetBridge {
  const api = window.widgetApi
  if (!api) {
    throw new Error('widget bridge unavailable')
  }
  return api
}

export function settingsApi(): SettingsBridge {
  const api = window.settingsApi
  if (!api) {
    throw new Error('settings bridge unavailable')
  }
  return api
}

export function alertApi(): AlertBridge {
  const api = window.alertApi
  if (!api) {
    throw new Error('alert bridge unavailable')
  }
  return api
}

export function quickAddApi(): QuickAddBridge {
  const api = window.quickAddApi
  if (!api) {
    throw new Error('quick add bridge unavailable')
  }
  return api
}

export function onSnapshot(listener: (snapshot: AgendaSnapshot) => void): () => void {
  return widgetApi().onSnapshot((raw) => {
    const parsed = agendaSnapshotSchema.safeParse(raw)
    if (!parsed.success) {
      return
    }
    listener(parsed.data)
  })
}

/** Both the widget and the quick-add window listen on the same push channel. */
export function onTodos(
  source: Pick<WidgetBridge, 'onTodos'>,
  listener: (snapshot: TodoSnapshot) => void,
): () => void {
  return source.onTodos((raw) => {
    const parsed = todoSnapshotSchema.safeParse(raw)
    if (!parsed.success) {
      return
    }
    listener(parsed.data)
  })
}

export async function fetchAccounts(): Promise<AccountView[]> {
  const raw = await settingsApi().listAccounts()
  return accountListSchema.parse(raw)
}

export async function fetchCalendars(accountId: string): Promise<CalendarSummary[]> {
  const raw = await settingsApi().listCalendars(accountId)
  return calendarListSchema.parse(raw)
}

export async function fetchDisplays(): Promise<DisplayOption[]> {
  const raw = await settingsApi().listDisplays()
  return displayListSchema.parse(raw)
}

export async function fetchSettings(): Promise<AppSettings> {
  const raw = await settingsApi().getSettings()
  return appSettingsSchema.parse(raw)
}
