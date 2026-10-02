import { BrowserWindow } from 'electron'
import { SETTINGS_WINDOW_HEIGHT, SETTINGS_WINDOW_WIDTH } from '../../shared/constants.ts'
import type { AppLogger } from '../infra/logger.ts'
import { resolveRendererUrl } from './appProtocol.ts'
import { applyWindowSecurity, hardenedWebPreferences } from './windowSecurity.ts'

export interface SettingsWindowOptions {
  readonly preloadPath: string
  readonly devServerUrl: string | null
  readonly isDev: boolean
}

/**
 * A normal window, unlike the widget: it has text inputs, so it needs focus,
 * standard chrome and the Edit menu (docs/spec.md §4, §10).
 */
export class SettingsWindow {
  private window: BrowserWindow | null = null

  constructor(
    private readonly options: SettingsWindowOptions,
    private readonly logger: AppLogger,
  ) {}

  async open(): Promise<void> {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show()
      this.window.focus()
      return
    }

    const window = new BrowserWindow({
      width: SETTINGS_WINDOW_WIDTH,
      height: SETTINGS_WINDOW_HEIGHT,
      show: false,
      title: 'Up Next Settings',
      titleBarStyle: 'hiddenInset',
      minimizable: true,
      maximizable: false,
      fullscreenable: false,
      webPreferences: hardenedWebPreferences({
        preloadPath: this.options.preloadPath,
        isDev: this.options.isDev,
      }),
    })

    this.window = window
    applyWindowSecurity(window, this.logger)

    window.on('closed', () => {
      this.window = null
    })
    window.once('ready-to-show', () => {
      window.show()
    })

    await window.loadURL(resolveRendererUrl('settings', this.options.devServerUrl))
  }

  close(): void {
    this.window?.close()
  }

  webContentsId(): number | null {
    if (!this.window || this.window.isDestroyed()) {
      return null
    }
    return this.window.webContents.id
  }
}
