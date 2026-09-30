import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNELS, WINDOW_ROLES, type WindowRole } from '../shared/ipc/channels.ts'
import type {
  AlertBridge,
  QuickAddBridge,
  SettingsBridge,
  WidgetBridge,
} from '../shared/ipc/bridge.ts'
import type {
  MeetingAlert,
  MoveToDisplayRequest,
  UpdateSettingsRequest,
} from '../shared/ipc/contract.ts'
import type { AgendaSnapshot } from '../shared/types/agenda.ts'
import type { AccountView } from '../shared/types/account.ts'
import type { CalendarId, CalendarSummary } from '../shared/types/calendar.ts'
import type { AppSettings, DisplayOption } from '../shared/types/settings.ts'
import type { TodoSnapshot } from '../shared/types/todo.ts'

/**
 * The single preload (docs/spec.md §8.5).
 *
 * One entry point, not one per window: a sandboxed preload cannot `require` a
 * sibling file, and two entries made the bundler hoist their shared imports
 * into a chunk that then failed to load. One entry is always self-contained.
 *
 * Each window still receives only its own API, chosen here by role, and main
 * independently checks the sender on every channel.
 */

function resolveRole(): WindowRole | null {
  let url: URL
  try {
    url = new URL(window.location.href)
  } catch {
    return null
  }

  // app://widget/index.html in production, /widget/index.html on the dev server.
  const candidate =
    url.protocol === 'app:' ? url.hostname : (url.pathname.split('/').filter(Boolean)[0] ?? '')

  return WINDOW_ROLES.find((role) => role === candidate) ?? null
}

function createAlertBridge(): AlertBridge {
  return {
    onAlert(listener: (alert: MeetingAlert) => void): () => void {
      const subscription = (_event: IpcRendererEvent, alert: MeetingAlert): void => {
        listener(alert)
      }
      ipcRenderer.on(CHANNELS.alertShow, subscription)
      return () => {
        ipcRenderer.removeListener(CHANNELS.alertShow, subscription)
      }
    },

    async join(eventId: string): Promise<void> {
      await ipcRenderer.invoke(CHANNELS.alertJoin, { eventId })
    },

    async dismiss(): Promise<void> {
      await ipcRenderer.invoke(CHANNELS.alertDismiss)
    },
  }
}

/** Shared by the two windows that render the list. */
function subscribeToTodos(listener: (snapshot: TodoSnapshot) => void): () => void {
  const subscription = (_event: IpcRendererEvent, snapshot: TodoSnapshot): void => {
    listener(snapshot)
  }
  ipcRenderer.on(CHANNELS.todosSnapshot, subscription)
  return () => {
    ipcRenderer.removeListener(CHANNELS.todosSnapshot, subscription)
  }
}

function createQuickAddBridge(): QuickAddBridge {
  return {
    onTodos: subscribeToTodos,

    async addTodo(title: string): Promise<void> {
      await ipcRenderer.invoke(CHANNELS.todosAdd, { title })
    },

    async close(): Promise<void> {
      await ipcRenderer.invoke(CHANNELS.quickAddClose)
    },
  }
}

function createWidgetBridge(): WidgetBridge {
  return {
    onSnapshot(listener: (snapshot: AgendaSnapshot) => void): () => void {
      const subscription = (_event: IpcRendererEvent, snapshot: AgendaSnapshot): void => {
        listener(snapshot)
      }
      ipcRenderer.on(CHANNELS.agendaSnapshot, subscription)
      return () => {
        ipcRenderer.removeListener(CHANNELS.agendaSnapshot, subscription)
      }
    },

    async join(eventId: string): Promise<void> {
      await ipcRenderer.invoke(CHANNELS.agendaJoin, { eventId })
    },

    async hide(): Promise<void> {
      await ipcRenderer.invoke(CHANNELS.widgetHide)
    },

    async setPinned(pinned: boolean): Promise<void> {
      await ipcRenderer.invoke(CHANNELS.widgetSetPinned, { pinned })
    },

    async openSettings(): Promise<void> {
      await ipcRenderer.invoke(CHANNELS.settingsOpen)
    },

    async syncNow(): Promise<void> {
      await ipcRenderer.invoke(CHANNELS.syncNow)
    },

    onTodos: subscribeToTodos,

    async toggleTodo(todoId: string): Promise<void> {
      await ipcRenderer.invoke(CHANNELS.todosToggle, { todoId })
    },

    async rollTodo(todoId: string): Promise<void> {
      await ipcRenderer.invoke(CHANNELS.todosRoll, { todoId })
    },

    async rollAllOverdueTodos(): Promise<void> {
      await ipcRenderer.invoke(CHANNELS.todosRollAllOverdue)
    },

    async removeTodo(todoId: string): Promise<void> {
      await ipcRenderer.invoke(CHANNELS.todosRemove, { todoId })
    },
  }
}

function createSettingsBridge(): SettingsBridge {
  return {
    listAccounts: () => ipcRenderer.invoke(CHANNELS.accountsList) as Promise<AccountView[]>,

    connectAccount: () =>
      ipcRenderer.invoke(CHANNELS.accountsConnect, { provider: 'google' }) as Promise<
        AccountView[]
      >,

    reconnectAccount: (accountId: string) =>
      ipcRenderer.invoke(CHANNELS.accountsReconnect, { accountId }) as Promise<AccountView[]>,

    disconnectAccount: (accountId: string) =>
      ipcRenderer.invoke(CHANNELS.accountsDisconnect, { accountId }) as Promise<AccountView[]>,

    updateAccount: (request: { accountId: string; label?: string; colour?: string }) =>
      ipcRenderer.invoke(CHANNELS.accountsUpdate, request) as Promise<AccountView[]>,

    listCalendars: (accountId: string) =>
      ipcRenderer.invoke(CHANNELS.calendarsList, { accountId }) as Promise<CalendarSummary[]>,

    setSelectedCalendars: (accountId: string, calendarIds: CalendarId[]) =>
      ipcRenderer.invoke(CHANNELS.calendarsSetSelected, {
        accountId,
        calendarIds,
      }) as Promise<AccountView[]>,

    listDisplays: () => ipcRenderer.invoke(CHANNELS.displaysList) as Promise<DisplayOption[]>,

    moveToDisplay: (request: MoveToDisplayRequest) =>
      ipcRenderer.invoke(CHANNELS.widgetMoveToDisplay, request) as Promise<void>,

    getSettings: () => ipcRenderer.invoke(CHANNELS.settingsGet) as Promise<AppSettings>,

    updateSettings: (patch: UpdateSettingsRequest) =>
      ipcRenderer.invoke(CHANNELS.settingsUpdate, patch) as Promise<AppSettings>,

    syncNow: () => ipcRenderer.invoke(CHANNELS.syncNow) as Promise<void>,

    testAlert: () => ipcRenderer.invoke(CHANNELS.alertTest) as Promise<void>,
  }
}

const role = resolveRole()
if (role === 'widget') {
  contextBridge.exposeInMainWorld('widgetApi', createWidgetBridge())
}
if (role === 'settings') {
  contextBridge.exposeInMainWorld('settingsApi', createSettingsBridge())
}
if (role === 'alert') {
  contextBridge.exposeInMainWorld('alertApi', createAlertBridge())
}
if (role === 'quickadd') {
  contextBridge.exposeInMainWorld('quickAddApi', createQuickAddBridge())
}
