import { chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { app, Menu, session } from 'electron'
import { AgendaClock } from './agenda/AgendaClock.ts'
import { AgendaService } from './agenda/AgendaService.ts'
import { TodoService } from './agenda/TodoService.ts'
import { SystemBrowser } from './auth/SystemBrowser.ts'
import { AccountService } from './calendar/AccountService.ts'
import { MeetingJoiner } from './calendar/MeetingJoiner.ts'
import { ProviderFactory } from './calendar/ProviderFactory.ts'
import { ProviderRegistry } from './calendar/ProviderRegistry.ts'
import { loadConfig } from './infra/config.ts'
import { describeError } from './infra/errors.ts'
import { createLogger, initialiseLogging, type AppLogger } from './infra/logger.ts'
import { registerHandlers } from './ipc/registerHandlers.ts'
import { MeetingNotifier } from './notifications/MeetingNotifier.ts'
import { SettingsStore } from './storage/SettingsStore.ts'
import { TodoStore } from './storage/TodoStore.ts'
import { TokenVault } from './storage/TokenVault.ts'
import { SyncCoordinator } from './sync/SyncCoordinator.ts'
import { SyncScheduler } from './sync/SyncScheduler.ts'
import { GlobalShortcuts } from './system/GlobalShortcuts.ts'
import { LoginItem } from './system/LoginItem.ts'
import { PreferencesService } from './system/PreferencesService.ts'
import { SystemEvents } from './system/SystemEvents.ts'
import { TrayController } from './tray/TrayController.ts'
import { MeetingAlertWindow } from './windows/MeetingAlertWindow.ts'
import { QuickAddWindow } from './windows/QuickAddWindow.ts'
import { SettingsWindow } from './windows/SettingsWindow.ts'
import { WidgetWindow } from './windows/WidgetWindow.ts'
import { registerAppProtocol, registerAppSchemePrivileges } from './windows/appProtocol.ts'
import { applySessionSecurity } from './windows/windowSecurity.ts'

/**
 * The composition root (docs/spec.md §5).
 *
 * Builds the object graph once and passes dependencies by constructor.
 * Nothing here reaches for a singleton, and nothing below imports a live
 * instance from another module.
 */
class Application {
  private readonly logger: AppLogger
  private readonly config = loadConfig()
  private readonly devServerUrl = process.env['ELECTRON_RENDERER_URL'] ?? null

  private clock: AgendaClock | null = null
  private tray: TrayController | null = null
  private scheduler: SyncScheduler | null = null
  private widget: WidgetWindow | null = null
  private alertWindow: MeetingAlertWindow | null = null
  private quickAdd: QuickAddWindow | null = null
  private shortcuts: GlobalShortcuts | null = null

  constructor() {
    initialiseLogging(this.config.isDev)
    this.logger = createLogger('app')
  }

  /** Runs before the app is ready; the scheme and sandbox must be set early. */
  prepare(): void {
    registerAppSchemePrivileges()
    app.enableSandbox()
  }

  async start(): Promise<void> {
    await this.hardenUserDataDirectory()

    const rendererRoot = join(import.meta.dirname, '..', 'renderer')
    registerAppProtocol(rendererRoot, this.logger.child('protocol'))
    applySessionSecurity(
      session.defaultSession,
      { isDev: this.config.isDev, devServerOrigin: this.devServerOrigin() },
      this.logger.child('session'),
    )

    // A menu-bar app still needs an Edit menu, or Cmd+C and Cmd+V do not work
    // in the settings window (§10).
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
    )
    app.dock?.hide()

    const settings = new SettingsStore(this.logger.child('settings'))
    const vault = new TokenVault(
      join(app.getPath('userData'), 'tokens'),
      this.logger.child('vault'),
    )
    await vault.initialise()

    const registry = new ProviderRegistry(this.logger.child('registry'))
    const factory = new ProviderFactory(
      this.config,
      vault,
      new SystemBrowser(),
      this.logger.child('factory'),
    )

    const agenda = new AgendaService(settings)
    const todos = new TodoService(
      new TodoStore(this.logger.child('todo-store')),
      this.logger.child('todos'),
    )
    const joiner = new MeetingJoiner(agenda, this.logger.child('join'))
    const coordinator = new SyncCoordinator(registry, settings, agenda, this.logger.child('sync'))
    const scheduler = new SyncScheduler(coordinator, settings, this.logger.child('scheduler'))
    this.scheduler = scheduler

    // One preload for both windows; it exposes only the API for the window it
    // is attached to (§8.5).
    const preloadPath = join(import.meta.dirname, '..', 'preload', 'index.cjs')
    const widget = new WidgetWindow(
      {
        preloadPath,
        devServerUrl: this.devServerUrl,
        isDev: this.config.isDev,
      },
      settings,
      this.logger.child('widget'),
    )
    this.widget = widget
    const settingsWindow = new SettingsWindow(
      {
        preloadPath,
        devServerUrl: this.devServerUrl,
        isDev: this.config.isDev,
      },
      this.logger.child('settings-window'),
    )

    const preferences = new PreferencesService(
      settings,
      new LoginItem(this.logger.child('login-item')),
      agenda,
      scheduler,
      widget,
      this.logger.child('preferences'),
    )
    const accounts = new AccountService(
      settings,
      factory,
      registry,
      agenda,
      vault,
      scheduler,
      this.logger.child('accounts'),
    )

    const alertWindow = new MeetingAlertWindow(
      {
        preloadPath,
        devServerUrl: this.devServerUrl,
        isDev: this.config.isDev,
      },
      this.logger.child('alert'),
    )
    this.alertWindow = alertWindow

    const quickAdd = new QuickAddWindow(
      {
        preloadPath,
        devServerUrl: this.devServerUrl,
        isDev: this.config.isDev,
      },
      this.logger.child('quick-add'),
    )
    this.quickAdd = quickAdd

    const shortcuts = new GlobalShortcuts(() => {
      void quickAdd.open()
    }, this.logger.child('shortcuts'))
    this.shortcuts = shortcuts

    const notifier = new MeetingNotifier(
      settings,
      joiner,
      () => {
        widget.show()
      },
      (alert) => {
        void alertWindow.show(alert)
      },
      this.logger.child('notifier'),
    )
    const tray = new TrayController(
      settings,
      {
        toggleWidget: () => {
          widget.toggle()
        },
        openQuickAdd: () => {
          void quickAdd.open()
        },
        openSettings: () => {
          void settingsWindow.open()
        },
        syncNow: () => {
          scheduler.syncAllNow('menu')
        },
        setPrivacyMode: (enabled) => {
          preferences.setPrivacyMode(enabled)
        },
        moveToDisplay: (display) => {
          widget.moveToDisplay(display, 'topRight')
        },
        reconnect: (accountId) => {
          void accounts.reconnect(accountId)
        },
        quit: () => {
          app.quit()
        },
      },
      this.logger.child('tray'),
    )
    this.tray = tray

    const clock = new AgendaClock()
    this.clock = clock
    const systemEvents = new SystemEvents(this.logger.child('system'))

    this.wireSignals({
      agenda,
      todos,
      clock,
      systemEvents,
      widget,
      quickAdd,
      tray,
      notifier,
      scheduler,
    })

    registerHandlers({
      joiner,
      alertWindow,
      accounts,
      widget,
      settingsWindow,
      quickAdd,
      todos,
      settings,
      preferences,
      scheduler,
      devServerOrigin: this.devServerOrigin(),
      logger: this.logger,
    })

    preferences.applyAll()
    await accounts.restore()

    // Nothing to connect to in a dev build without an OAuth client, so show
    // the mock agenda rather than an empty widget (§9, Phase 1).
    const hasAccounts = settings.getAccounts().length > 0
    if (this.config.isDev && !hasAccounts && !factory.canConnect('google')) {
      await accounts.addMockAccount()
    }

    await widget.open()
    tray.start()
    systemEvents.start()
    clock.start()
    scheduler.start()
    shortcuts.start()

    // Paint immediately rather than waiting for the first minute boundary.
    agenda.refresh()
    todos.refresh()
    this.logger.info('application started', { accounts: accounts.list().length })
  }

  /** A second launch surfaces the widget rather than starting a rival app. */
  showWidget(): void {
    this.widget?.show()
  }

  stop(): void {
    this.clock?.stop()
    this.scheduler?.stop()
    this.shortcuts?.stop()
    this.tray?.destroy()
    this.alertWindow?.close()
    this.quickAdd?.close()
  }

  private wireSignals(parts: {
    agenda: AgendaService
    todos: TodoService
    clock: AgendaClock
    systemEvents: SystemEvents
    widget: WidgetWindow
    quickAdd: QuickAddWindow
    tray: TrayController
    notifier: MeetingNotifier
    scheduler: SyncScheduler
  }): void {
    // Main owns time: one tick rebuilds the snapshot everyone reads (§5).
    parts.clock.ticked.subscribe(({ now, dayChanged }) => {
      parts.agenda.refresh(now)
      if (dayChanged) {
        // Yesterday's unfinished TODOs become overdue. Nothing is rewritten:
        // only the grouping changes (§6).
        parts.todos.refresh()
        parts.scheduler.syncAllNow('midnight')
      }
    })

    parts.agenda.snapshotChanged.subscribe((snapshot) => {
      parts.widget.sendSnapshot(snapshot)
      parts.tray.handleSnapshot(snapshot)
      parts.notifier.handleSnapshot(snapshot)
    })

    parts.todos.changed.subscribe((snapshot) => {
      parts.widget.sendTodos(snapshot)
      parts.quickAdd.sendSnapshot(snapshot)
    })

    // Timers do not run while asleep, so waking forces both a tick and a sync.
    parts.systemEvents.resumed.subscribe((reason) => {
      parts.clock.forceTick()
      parts.scheduler.syncAllNow(reason)
    })

    parts.systemEvents.displaysChanged.subscribe(() => {
      parts.widget.restoreToChosenDisplay()
      parts.tray.refreshMenu()
    })
  }

  /** Owner-only: settings and encrypted tokens live here (§8.2). */
  private async hardenUserDataDirectory(): Promise<void> {
    try {
      await chmod(app.getPath('userData'), 0o700)
    } catch (error) {
      this.logger.warn('could not tighten userData permissions', {
        error: describeError(error),
      })
    }
  }

  private devServerOrigin(): string | null {
    if (!this.devServerUrl) {
      return null
    }
    try {
      return new URL(this.devServerUrl).origin
    } catch {
      return null
    }
  }
}

export function startApplication(): void {
  const application = new Application()
  application.prepare()

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on('second-instance', () => {
    application.showWidget()
  })

  // A menu-bar app outlives its windows.
  app.on('window-all-closed', () => {
    // Intentionally empty: quitting is the tray menu's job.
  })

  app.on('before-quit', () => {
    application.stop()
  })

  app.whenReady().then(
    async () => {
      await application.start()
    },
    (error: unknown) => {
      createLogger('app').error('failed to start', { error: describeError(error) })
      app.quit()
    },
  )
}
