import { BrowserWindow, type Rectangle } from 'electron'
import {
  WIDGET_DEFAULT_HEIGHT,
  WIDGET_DEFAULT_WIDTH,
  WIDGET_MIN_HEIGHT,
  WIDGET_MIN_WIDTH,
} from '../../shared/constants.ts'
import { CHANNELS } from '../../shared/ipc/channels.ts'
import type { AgendaSnapshot } from '../../shared/types/agenda.ts'
import type { DisplayKey, WidgetCorner } from '../../shared/types/settings.ts'
import type { TodoSnapshot } from '../../shared/types/todo.ts'
import type { AppLogger } from '../infra/logger.ts'
import type { SettingsStore } from '../storage/SettingsStore.ts'
import { resolveRendererUrl } from './appProtocol.ts'
import {
  computeBounds,
  displayForBounds,
  findDisplay,
  toDisplayKey,
  clampToDisplay,
} from './displayPlacement.ts'
import { applyWindowSecurity, hardenedWebPreferences } from './windowSecurity.ts'

const BOUNDS_SAVE_DEBOUNCE_MS = 500

export interface WidgetWindowOptions {
  readonly preloadPath: string
  readonly devServerUrl: string | null
  readonly isDev: boolean
}

/**
 * The pinned panel (docs/spec.md §6, §10).
 *
 * `type: 'panel'` is what makes it float over full-screen apps, appear on every
 * Space, and never take focus from whatever you are typing in.
 */
export class WidgetWindow {
  private window: BrowserWindow | null = null
  private saveTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly options: WidgetWindowOptions,
    private readonly settings: SettingsStore,
    private readonly logger: AppLogger,
  ) {}

  async open(): Promise<void> {
    if (this.window) {
      this.show()
      return
    }

    const settings = this.settings.getSettings()
    const bounds = computeBounds(settings.placement, {
      width: WIDGET_DEFAULT_WIDTH,
      height: WIDGET_DEFAULT_HEIGHT,
    })

    const window = new BrowserWindow({
      ...bounds,
      minWidth: WIDGET_MIN_WIDTH,
      minHeight: WIDGET_MIN_HEIGHT,
      // NSPanel behaviour: all Spaces, above full-screen apps, non-activating.
      type: 'panel',
      frame: false,
      show: false,
      skipTaskbar: true,
      fullscreenable: false,
      maximizable: false,
      minimizable: false,
      alwaysOnTop: settings.alwaysOnTop,
      // Without this the first click on the inactive panel is swallowed.
      acceptFirstMouse: true,
      webPreferences: hardenedWebPreferences({
        preloadPath: this.options.preloadPath,
        isDev: this.options.isDev,
      }),
    })

    this.window = window
    applyWindowSecurity(window, this.logger)

    // Best effort only: ScreenCaptureKit ignores it, which is why privacy mode
    // exists (§8.4).
    window.setContentProtection(settings.hideFromScreenShare)
    window.setAlwaysOnTop(settings.alwaysOnTop, 'floating')

    window.on('moved', () => {
      this.scheduleBoundsSave()
    })
    window.on('resized', () => {
      this.scheduleBoundsSave()
    })
    window.on('closed', () => {
      this.window = null
    })
    window.once('ready-to-show', () => {
      // showInactive, never show: the widget must not steal focus (§2).
      window.showInactive()
    })

    // A load resets the zoom factor, so it is reapplied here rather than only
    // when the setting changes.
    window.webContents.on('did-finish-load', () => {
      this.applyTextScale(this.settings.getSettings().widgetTextScale)
    })

    await window.loadURL(resolveRendererUrl('widget', this.options.devServerUrl))
  }

  isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed()
  }

  isVisible(): boolean {
    return this.isOpen() && this.window!.isVisible()
  }

  show(): void {
    if (!this.window) {
      return
    }
    this.window.showInactive()
  }

  hide(): void {
    this.window?.hide()
  }

  toggle(): void {
    if (this.isVisible()) {
      this.hide()
      return
    }
    this.show()
  }

  /** Persisting is PreferencesService's job; this only moves the window. */
  applyAlwaysOnTop(pinned: boolean): void {
    this.window?.setAlwaysOnTop(pinned, 'floating')
  }

  /**
   * Hiding the panel from capture is the default, but it also hides it from a
   * demo recording and from anyone the user is deliberately showing it to.
   */
  applyScreenShareVisibility(hidden: boolean): void {
    this.window?.setContentProtection(hidden)
  }

  /**
   * Zoom rather than a font size: the widget is drawn in pixels — gridlines,
   * block heights, the time gutter — so scaling only the type would leave the
   * text larger inside a layout that had not moved (§6).
   */
  applyTextScale(percent: number): void {
    this.window?.webContents.setZoomFactor(percent / 100)
  }

  moveToDisplay(display: DisplayKey, corner: WidgetCorner): void {
    const target = findDisplay(display)
    if (!target || !this.window) {
      return
    }

    const size = this.window.getBounds()
    const bounds = computeBounds(
      { display, corner, bounds: null },
      { width: size.width, height: size.height },
    )
    this.window.setBounds(bounds)
    this.persistBounds(bounds, display, corner)
  }

  /** Called when a display is removed, so the widget can never be left off-screen. */
  ensureOnScreen(): void {
    if (!this.window) {
      return
    }
    const bounds = this.window.getBounds()
    const display = displayForBounds(bounds)
    const clamped = clampToDisplay(bounds, display)
    if (clamped.x !== bounds.x || clamped.y !== bounds.y) {
      this.window.setBounds(clamped)
      this.logger.info('moved widget back on-screen')
    }
  }

  /** Returns the widget to its chosen display once that display is back. */
  restoreToChosenDisplay(): void {
    const placement = this.settings.getSettings().placement
    if (!placement.display || !this.window) {
      return
    }
    const target = findDisplay(placement.display)
    if (!target) {
      this.ensureOnScreen()
      return
    }
    const size = this.window.getBounds()
    this.window.setBounds(computeBounds(placement, { width: size.width, height: size.height }))
  }

  sendSnapshot(snapshot: AgendaSnapshot): void {
    if (!this.isOpen()) {
      return
    }
    this.window!.webContents.send(CHANNELS.agendaSnapshot, snapshot)
  }

  sendTodos(snapshot: TodoSnapshot): void {
    if (!this.isOpen()) {
      return
    }
    this.window!.webContents.send(CHANNELS.todosSnapshot, snapshot)
  }

  webContentsId(): number | null {
    return this.isOpen() ? this.window!.webContents.id : null
  }

  private scheduleBoundsSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      if (!this.window) {
        return
      }
      const bounds = this.window.getBounds()
      const display = toDisplayKey(displayForBounds(bounds))
      this.persistBounds(bounds, display, 'remembered')
    }, BOUNDS_SAVE_DEBOUNCE_MS)
  }

  private persistBounds(bounds: Rectangle, display: DisplayKey, corner: WidgetCorner): void {
    this.settings.setPlacement({
      display,
      corner,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    })
  }
}
