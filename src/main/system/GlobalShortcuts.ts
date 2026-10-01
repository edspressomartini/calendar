import { globalShortcut } from 'electron'
import type { AppLogger } from '../infra/logger.ts'

/**
 * The only keyboard entry point the app has (docs/spec.md §6).
 *
 * A menu-bar app with no Dock icon and no focusable window is otherwise
 * unreachable from the keyboard, and a TODO you have to go and find with the
 * mouse does not get written down.
 *
 * The combination is a setting, because macOS gives one to whichever app
 * asked first and the user is the only one who knows what else is running.
 */
export class GlobalShortcuts {
  private registered: string | null = null

  constructor(
    private readonly openQuickAdd: () => void,
    private readonly logger: AppLogger,
  ) {}

  /** The accelerator currently claimed, or null if nothing is. */
  current(): string | null {
    return this.registered
  }

  /**
   * Returns false when macOS refuses, which it does silently when another app
   * already owns the combination — the caller decides what to do about it.
   */
  apply(accelerator: string): boolean {
    if (this.registered === accelerator) {
      return true
    }

    this.release()
    const claimed = globalShortcut.register(accelerator, this.openQuickAdd)
    if (!claimed) {
      this.logger.warn('quick add shortcut is already taken', { accelerator })
      return false
    }

    this.registered = accelerator
    this.logger.info('registered quick add shortcut', { accelerator })
    return true
  }

  stop(): void {
    this.release()
  }

  private release(): void {
    if (this.registered === null) {
      return
    }
    globalShortcut.unregister(this.registered)
    this.registered = null
  }
}
