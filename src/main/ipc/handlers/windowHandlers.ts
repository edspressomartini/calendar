import { CHANNELS } from '../../../shared/ipc/channels.ts'
import type { PreferencesService } from '../../system/PreferencesService.ts'
import type { SettingsStore } from '../../storage/SettingsStore.ts'
import type { SettingsWindow } from '../../windows/SettingsWindow.ts'
import type { WidgetWindow } from '../../windows/WidgetWindow.ts'
import { listDisplayOptions } from '../../windows/displayPlacement.ts'
import type { IpcRouter } from '../IpcRouter.ts'

export interface WindowHandlerDeps {
  readonly widget: WidgetWindow
  readonly settingsWindow: SettingsWindow
  readonly settings: SettingsStore
  readonly preferences: PreferencesService
}

export function registerWindowHandlers(router: IpcRouter, deps: WindowHandlerDeps): void {
  router.handle(CHANNELS.widgetHide, () => {
    deps.widget.hide()
  })

  router.handle(CHANNELS.widgetSetPinned, ({ pinned }) => {
    deps.preferences.update({ alwaysOnTop: pinned })
  })

  router.handle(CHANNELS.widgetSetSections, ({ showTimeline, showTodos }) => {
    deps.preferences.update({ showTimeline, showTodos })
  })

  router.handle(CHANNELS.widgetFitHeight, ({ height }) => {
    deps.widget.fitHeight(height)
  })

  router.handle(CHANNELS.settingsOpen, async () => {
    await deps.settingsWindow.open()
  })

  router.handle(CHANNELS.displaysList, () => {
    return listDisplayOptions(deps.settings.getSettings().placement.display)
  })

  router.handle(CHANNELS.widgetMoveToDisplay, ({ display, corner }) => {
    deps.widget.moveToDisplay(display, corner)
  })
}
