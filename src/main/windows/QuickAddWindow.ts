import { app, BrowserWindow, screen } from 'electron'
import { QUICK_ADD_WINDOW_HEIGHT, QUICK_ADD_WINDOW_WIDTH } from '../../shared/constants.ts'
import { CHANNELS } from '../../shared/ipc/channels.ts'
import type { TodoSnapshot } from '../../shared/types/todo.ts'
import type { AppLogger } from '../infra/logger.ts'
import { resolveRendererUrl } from './appProtocol.ts'
import { applyWindowSecurity, hardenedWebPreferences } from './windowSecurity.ts'

/**
 * The one window in the app that is allowed to take focus (docs/spec.md §6).
 *
 * Everything else is an NSPanel that must never interrupt what you are typing,
 * which is exactly what makes those windows unable to accept a keystroke. A
 * capture box has to be the opposite: ordinary, focusable and activating, so
 * the caret lands in the field and macOS dictation has somewhere to type.
 *
 * It is created once and then hidden rather than destroyed, so the shortcut
 * opens it instantly rather than paying for a renderer each time.
 */

export interface QuickAddWindowOptions {
  readonly preloadPath: string
  readonly devServerUrl: string | null
  readonly isDev: boolean
}

export class QuickAddWindow {
  private window: BrowserWindow | null = null
  private snapshot: TodoSnapshot | null = null

  constructor(
    private readonly options: QuickAddWindowOptions,
    private readonly logger: AppLogger,
  ) {}

  async open(): Promise<void> {
    const window = this.window ?? (await this.create())

    this.centreOnActiveDisplay(window)
    // With the Dock icon hidden the app is not frontmost, and an unfocused
    // window would drop every keystroke.
    app.focus({ steal: true })
    window.show()
    window.focus()
    this.pushSnapshot()
  }

  hide(): void {
    if (!this.isOpen()) {
      return
    }
    // Hiding hands the keyboard back to whatever was in front before. The app
    // is not hidden with it: that would take the widget down too.
    this.window!.hide()
  }

  isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed()
  }

  sendSnapshot(snapshot: TodoSnapshot): void {
    this.snapshot = snapshot
    this.pushSnapshot()
  }

  close(): void {
    if (this.isOpen()) {
      this.window!.destroy()
    }
    this.window = null
  }

  private async create(): Promise<BrowserWindow> {
    const window = new BrowserWindow({
      width: QUICK_ADD_WINDOW_WIDTH,
      height: QUICK_ADD_WINDOW_HEIGHT,
      frame: false,
      show: false,
      resizable: false,
      movable: true,
      skipTaskbar: true,
      fullscreenable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      webPreferences: hardenedWebPreferences({
        preloadPath: this.options.preloadPath,
        isDev: this.options.isDev,
      }),
    })

    this.window = window
    applyWindowSecurity(window, this.logger)
    window.setContentProtection(true)
    window.setAlwaysOnTop(true, 'modal-panel')
    // A capture box is no use if it is stranded on the Space you started from.
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    // Clicking away is the same as cancelling, which is what every other
    // Spotlight-shaped box on the platform does.
    window.on('blur', () => {
      this.hide()
    })

    window.on('closed', () => {
      this.window = null
    })

    // The first open would otherwise race the renderer subscribing.
    window.webContents.on('did-finish-load', () => {
      this.pushSnapshot()
    })

    await window.loadURL(resolveRendererUrl('quickadd', this.options.devServerUrl))
    return window
  }

  private pushSnapshot(): void {
    if (!this.isOpen() || !this.snapshot) {
      return
    }
    this.window!.webContents.send(CHANNELS.todosSnapshot, this.snapshot)
  }

  private centreOnActiveDisplay(window: BrowserWindow): void {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const area = display.workArea
    window.setBounds({
      x: Math.round(area.x + (area.width - QUICK_ADD_WINDOW_WIDTH) / 2),
      // A third of the way down reads better than dead centre.
      y: Math.round(area.y + area.height / 3),
      width: QUICK_ADD_WINDOW_WIDTH,
      height: QUICK_ADD_WINDOW_HEIGHT,
    })
  }
}
