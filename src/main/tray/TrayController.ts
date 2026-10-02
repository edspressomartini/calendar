import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron'
import trayIconPath from '../../../resources/trayTemplate.png?asset'
import { TRAY_TITLE_MAX_LENGTH } from '../../shared/constants.ts'
import type { AgendaSnapshot } from '../../shared/types/agenda.ts'
import type { AccountId } from '../../shared/types/calendar.ts'
import type { DisplayKey } from '../../shared/types/settings.ts'
import type { AppLogger } from '../infra/logger.ts'
import type { SettingsStore } from '../storage/SettingsStore.ts'
import { listDisplayOptions } from '../windows/displayPlacement.ts'

/**
 * The menu-bar presence (docs/spec.md §6): a countdown title and the app's
 * only always-available menu, since there is no Dock icon.
 */

export interface TrayActions {
  toggleWidget(): void
  openQuickAdd(): void
  openSettings(): void
  syncNow(): void
  setPrivacyMode(enabled: boolean): void
  moveToDisplay(display: DisplayKey): void
  reconnect(accountId: AccountId): void
  quit(): void
}

/**
 * Pure so the format is testable. The notch hides long menu-bar items, so the
 * title is deliberately short.
 */
export function formatTrayTitle(snapshot: AgendaSnapshot, hideTitles: boolean): string {
  const next = snapshot.nextUp
  if (!next) {
    return ''
  }

  const timing =
    next.status === 'live'
      ? next.minutesRemaining <= 0
        ? 'now'
        : `${next.minutesRemaining}m left`
      : next.startsInMinutes <= 0
        ? 'now'
        : `${next.startsInMinutes}m`

  if (hideTitles) {
    return timing
  }

  const title = next.title.slice(0, TRAY_TITLE_MAX_LENGTH)
  return `${title} · ${timing}`
}

export class TrayController {
  private tray: Tray | null = null
  private snapshot: AgendaSnapshot | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly actions: TrayActions,
    private readonly logger: AppLogger,
  ) {}

  start(): void {
    if (this.tray) {
      return
    }

    const icon = nativeImage.createFromPath(trayIconPath)
    // Template images are tinted by macOS for light and dark menu bars.
    icon.setTemplateImage(true)

    this.tray = new Tray(icon)
    this.tray.setToolTip('Up Next')
    // No click handler: with a context menu attached, macOS opens the menu on
    // click, and a competing handler would toggle the widget invisibly at the
    // same time. Show / Hide is the first item in the menu instead.
    this.rebuildMenu()
  }

  handleSnapshot(snapshot: AgendaSnapshot): void {
    this.snapshot = snapshot
    if (!this.tray) {
      return
    }

    this.tray.setTitle(formatTrayTitle(snapshot, this.settings.getSettings().hideTitlesInMenuBar))
    this.rebuildMenu()
  }

  refreshMenu(): void {
    this.rebuildMenu()
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }

  private rebuildMenu(): void {
    if (!this.tray) {
      return
    }
    this.tray.setContextMenu(Menu.buildFromTemplate(this.buildTemplate()))
  }

  private buildTemplate(): MenuItemConstructorOptions[] {
    const settings = this.settings.getSettings()
    const template: MenuItemConstructorOptions[] = []

    // Accounts needing attention come first (§6).
    const needsReauth = (this.snapshot?.accounts ?? []).filter(
      (account) => account.status === 'needsReauth',
    )
    for (const account of needsReauth) {
      template.push({
        label: `Reconnect ${account.label}…`,
        click: () => {
          this.actions.reconnect(account.id)
        },
      })
    }
    if (needsReauth.length > 0) {
      template.push({ type: 'separator' })
    }

    template.push(
      {
        label: 'Show / Hide Widget',
        click: () => {
          this.actions.toggleWidget()
        },
      },
      {
        label: 'Privacy Mode',
        type: 'checkbox',
        checked: settings.privacyMode,
        click: (item) => {
          this.actions.setPrivacyMode(item.checked)
        },
      },
      { label: 'Move to Display', submenu: this.buildDisplaySubmenu() },
      { type: 'separator' },
      {
        label: 'Add TODO…',
        // Shown, not bound: the real binding is a global shortcut, so it works
        // without the menu being open.
        accelerator: settings.quickAddShortcut,
        registerAccelerator: false,
        click: () => {
          this.actions.openQuickAdd()
        },
      },
      { type: 'separator' },
      {
        label: 'Sync Now',
        click: () => {
          this.actions.syncNow()
        },
      },
      {
        label: 'Settings…',
        accelerator: 'Command+,',
        click: () => {
          this.actions.openSettings()
        },
      },
      { type: 'separator' },
      {
        label: 'Quit Up Next',
        accelerator: 'Command+Q',
        click: () => {
          this.actions.quit()
        },
      },
    )

    return template
  }

  private buildDisplaySubmenu(): MenuItemConstructorOptions[] {
    const current = this.settings.getSettings().placement.display
    const options = listDisplayOptions(current)

    if (options.length === 0) {
      this.logger.warn('no displays reported')
      return [{ label: 'No displays found', enabled: false }]
    }

    return options.map((option) => ({
      label: option.isPrimary ? `${option.key.label} (main)` : option.key.label,
      type: 'radio',
      checked: option.isCurrent,
      click: () => {
        this.actions.moveToDisplay(option.key)
      },
    }))
  }
}
