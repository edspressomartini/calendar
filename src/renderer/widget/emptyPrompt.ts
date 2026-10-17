import type { AgendaAccount } from '../../shared/types/agenda.ts'
import type { SettingsTab } from '../../shared/types/settings.ts'

export interface EmptyPrompt {
  readonly message: string
  readonly actionLabel: string
  readonly tab: SettingsTab
}

/**
 * What the widget should say when it has no day to draw, or null when the
 * reason is simply that there is nothing on today.
 *
 * `needsReauth` only counts when every account has it. One dead account out of
 * two still leaves a day worth drawing, and the status dot beside that account
 * already says what is wrong with it.
 */
export function emptyPromptFor(accounts: readonly AgendaAccount[]): EmptyPrompt | null {
  if (accounts.length === 0) {
    return {
      message: 'No calendars connected yet.',
      actionLabel: 'Connect a calendar',
      tab: 'accounts',
    }
  }

  if (accounts.every((account) => account.status === 'needsReauth')) {
    return {
      message: 'Reconnect to see your calendar.',
      actionLabel: 'Reconnect',
      tab: 'accounts',
    }
  }

  return null
}
