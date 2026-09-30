import type { AgendaSnapshot } from '../types/agenda.ts'
import type { AccountView } from '../types/account.ts'
import type { CalendarId, CalendarSummary } from '../types/calendar.ts'
import type { AppSettings, DisplayOption } from '../types/settings.ts'
import type { TodoSnapshot } from '../types/todo.ts'
import type { MeetingAlert, MoveToDisplayRequest, UpdateSettingsRequest } from './contract.ts'

/**
 * The only surfaces a renderer can reach. Each preload exposes exactly one of
 * these — no generic invoke passthrough (docs/spec.md §8.5).
 */

export interface WidgetBridge {
  /** Returns an unsubscribe function. */
  onSnapshot(listener: (snapshot: AgendaSnapshot) => void): () => void
  join(eventId: string): Promise<void>
  hide(): Promise<void>
  setPinned(pinned: boolean): Promise<void>
  openSettings(): Promise<void>
  syncNow(): Promise<void>
  /** Returns an unsubscribe function. */
  onTodos(listener: (snapshot: TodoSnapshot) => void): () => void
  toggleTodo(todoId: string): Promise<void>
  rollTodo(todoId: string): Promise<void>
  rollAllOverdueTodos(): Promise<void>
  removeTodo(todoId: string): Promise<void>
}

/**
 * The quick-add window (§6). It is the only window that can take keyboard
 * focus, so it is the only one that can capture text — typed or dictated.
 */
export interface QuickAddBridge {
  /** Returns an unsubscribe function. */
  onTodos(listener: (snapshot: TodoSnapshot) => void): () => void
  addTodo(title: string): Promise<void>
  close(): Promise<void>
}

export interface SettingsBridge {
  listAccounts(): Promise<AccountView[]>
  connectAccount(): Promise<AccountView[]>
  reconnectAccount(accountId: string): Promise<AccountView[]>
  disconnectAccount(accountId: string): Promise<AccountView[]>
  updateAccount(request: {
    accountId: string
    label?: string
    colour?: string
  }): Promise<AccountView[]>
  listCalendars(accountId: string): Promise<CalendarSummary[]>
  setSelectedCalendars(accountId: string, calendarIds: CalendarId[]): Promise<AccountView[]>
  listDisplays(): Promise<DisplayOption[]>
  moveToDisplay(request: MoveToDisplayRequest): Promise<void>
  getSettings(): Promise<AppSettings>
  updateSettings(patch: UpdateSettingsRequest): Promise<AppSettings>
  syncNow(): Promise<void>
  /** Shows a sample alert, so notification setup can be checked. */
  testAlert(): Promise<void>
}

export interface AlertBridge {
  /** Returns an unsubscribe function. */
  onAlert(listener: (alert: MeetingAlert) => void): () => void
  join(eventId: string): Promise<void>
  dismiss(): Promise<void>
}

declare global {
  interface Window {
    readonly widgetApi?: WidgetBridge
    readonly settingsApi?: SettingsBridge
    readonly alertApi?: AlertBridge
    readonly quickAddApi?: QuickAddBridge
  }
}
