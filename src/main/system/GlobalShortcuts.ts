import { globalShortcut } from 'electron'
import { QUICK_ADD_SHORTCUT } from '../../shared/constants.ts'
import type { AppLogger } from '../infra/logger.ts'

/**
 * The only keyboard entry point the app has (docs/spec.md §6).
 *
 * A menu-bar app with no Dock icon and no focusable window is otherwise
 * unreachable from the keyboard, and a TODO you have to go and find with the
 * mouse does not get written down.
 */
export class GlobalShortcuts {
  private registered = false

  constructor(
    private readonly openQuickAdd: () => void,
    private readonly logger: AppLogger,
  ) {}

  start(): void {
    if (this.registered) {
      return
    }

    // Another app may already own the combination, in which case macOS simply
    // never delivers it — worth saying so rather than looking broken.
    this.registered = globalShortcut.register(QUICK_ADD_SHORTCUT, this.openQuickAdd)
    if (!this.registered) {
      this.logger.warn('quick add shortcut is already taken', { accelerator: QUICK_ADD_SHORTCUT })
      return
    }
    this.logger.info('registered quick add shortcut', { accelerator: QUICK_ADD_SHORTCUT })
  }

  stop(): void {
    if (!this.registered) {
      return
    }
    globalShortcut.unregister(QUICK_ADD_SHORTCUT)
    this.registered = false
  }
}
