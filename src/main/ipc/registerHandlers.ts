import type { TodoService } from '../agenda/TodoService.ts'
import type { AccountService } from '../calendar/AccountService.ts'
import type { MeetingJoiner } from '../calendar/MeetingJoiner.ts'
import type { AppLogger } from '../infra/logger.ts'
import type { SettingsStore } from '../storage/SettingsStore.ts'
import type { SyncScheduler } from '../sync/SyncScheduler.ts'
import type { PreferencesService } from '../system/PreferencesService.ts'
import type { MeetingAlertWindow } from '../windows/MeetingAlertWindow.ts'
import type { QuickAddWindow } from '../windows/QuickAddWindow.ts'
import type { SettingsWindow } from '../windows/SettingsWindow.ts'
import type { WidgetWindow } from '../windows/WidgetWindow.ts'
import { IpcRouter } from './IpcRouter.ts'
import { registerAccountHandlers } from './handlers/accountHandlers.ts'
import { registerAgendaHandlers } from './handlers/agendaHandlers.ts'
import { registerAlertHandlers } from './handlers/alertHandlers.ts'
import { registerSettingsHandlers } from './handlers/settingsHandlers.ts'
import { registerTodoHandlers } from './handlers/todoHandlers.ts'
import { registerWindowHandlers } from './handlers/windowHandlers.ts'

/**
 * The one place channels are registered (docs/spec.md §4, §8.5).
 *
 * Nothing calls into this module: it subscribes to AgendaService and pushes
 * snapshots outward, which is what keeps "nothing knows about IPC" true (§5).
 */

export interface IpcDependencies {
  readonly joiner: MeetingJoiner
  readonly alertWindow: MeetingAlertWindow
  readonly accounts: AccountService
  readonly widget: WidgetWindow
  readonly settingsWindow: SettingsWindow
  readonly quickAdd: QuickAddWindow
  readonly todos: TodoService
  readonly settings: SettingsStore
  readonly preferences: PreferencesService
  readonly scheduler: SyncScheduler
  readonly devServerOrigin: string | null
  readonly logger: AppLogger
}

export function registerHandlers(deps: IpcDependencies): void {
  const router = new IpcRouter(deps.devServerOrigin, deps.logger.child('ipc'))

  registerAgendaHandlers(router, { joiner: deps.joiner })
  registerAlertHandlers(router, { joiner: deps.joiner, alertWindow: deps.alertWindow })
  registerAccountHandlers(router, { accounts: deps.accounts })
  registerWindowHandlers(router, {
    widget: deps.widget,
    settingsWindow: deps.settingsWindow,
    settings: deps.settings,
    preferences: deps.preferences,
  })
  registerSettingsHandlers(router, {
    settings: deps.settings,
    preferences: deps.preferences,
    scheduler: deps.scheduler,
  })
  registerTodoHandlers(router, { todos: deps.todos, quickAdd: deps.quickAdd })
}
