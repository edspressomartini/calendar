import { nativeTheme } from 'electron'
import type { UpdateSettingsRequest } from '../../shared/ipc/contract.ts'
import type { AppSettings } from '../../shared/types/settings.ts'
import type { AgendaService } from '../agenda/AgendaService.ts'
import type { TodoService } from '../agenda/TodoService.ts'
import type { AppLogger } from '../infra/logger.ts'
import type { SettingsStore } from '../storage/SettingsStore.ts'
import type { SyncScheduler } from '../sync/SyncScheduler.ts'
import type { WidgetWindow } from '../windows/WidgetWindow.ts'
import type { LoginItem } from './LoginItem.ts'

/**
 * Turns a settings change into its side effects (docs/spec.md §6).
 *
 * Theme goes through nativeTheme rather than a second palette, so
 * prefers-color-scheme stays the single switch in CSS.
 */
export class PreferencesService {
  constructor(
    private readonly settings: SettingsStore,
    private readonly loginItem: LoginItem,
    private readonly agenda: AgendaService,
    private readonly todos: TodoService,
    private readonly scheduler: SyncScheduler,
    private readonly widget: WidgetWindow,
    private readonly logger: AppLogger,
  ) {}

  applyAll(): void {
    const settings = this.settings.getSettings()
    nativeTheme.themeSource = settings.theme
    this.loginItem.apply(settings.launchAtLogin)
    this.widget.applyAlwaysOnTop(settings.alwaysOnTop)
    this.widget.applyTextScale(settings.widgetTextScale)
  }

  update(patch: UpdateSettingsRequest): AppSettings {
    const updated = this.settings.updateSettings(patch)

    if (patch.theme !== undefined) {
      nativeTheme.themeSource = updated.theme
    }
    if (patch.launchAtLogin !== undefined) {
      this.loginItem.apply(updated.launchAtLogin)
    }
    if (patch.alwaysOnTop !== undefined) {
      this.widget.applyAlwaysOnTop(updated.alwaysOnTop)
    }
    if (patch.syncIntervalMinutes !== undefined) {
      this.scheduler.reconcile()
    }
    if (patch.widgetTextScale !== undefined) {
      this.widget.applyTextScale(updated.widgetTextScale)
    }

    // Privacy mode, view mode and menu-bar titles all change how the snapshot
    // renders, so rebuilding it updates the widget and the tray at once.
    this.agenda.refresh()
    if (patch.privacyMode !== undefined) {
      this.todos.refresh()
    }
    this.logger.debug('settings updated', { fields: Object.keys(patch).join(',') })
    return updated
  }

  setPrivacyMode(enabled: boolean): void {
    this.update({ privacyMode: enabled })
  }
}
