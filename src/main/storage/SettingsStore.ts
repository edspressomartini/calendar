import ElectronStore from 'electron-store'
import type { AccountColour, AccountConfig } from '../../shared/types/account.ts'
import type { AccountId, CalendarId, ProviderKind } from '../../shared/types/calendar.ts'
import type { AppSettings, WidgetPlacement } from '../../shared/types/settings.ts'
import type { UpdateSettingsRequest } from '../../shared/ipc/contract.ts'
import { Signal } from '../infra/Signal.ts'
import type { AppLogger } from '../infra/logger.ts'
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_STATE,
  nextAccountColour,
  parseSettings,
  type PersistedState,
} from './schema.ts'

/**
 * The narrow read side of the store. Consumers that only need to read depend
 * on this rather than the concrete class, which keeps them testable without
 * touching disk.
 */
export interface SettingsReader {
  getSettings(): AppSettings
}

export interface NewAccount {
  readonly id: AccountId
  readonly provider: ProviderKind
  readonly label: string
  readonly calendarIds: readonly CalendarId[]
}

/**
 * Settings, window placement and the account list. Holds no secrets: if someone
 * reads this file they learn your monitor layout (docs/spec.md §8.2).
 */
export class SettingsStore {
  readonly changed = new Signal<AppSettings>()

  private readonly store: ElectronStore<PersistedState>

  constructor(private readonly logger: AppLogger) {
    this.store = new ElectronStore<PersistedState>({
      name: 'settings',
      defaults: DEFAULT_STATE,
      clearInvalidConfig: true,
    })
    this.migrate()
  }

  getSettings(): AppSettings {
    return parseSettings(this.store.get('settings'))
  }

  getAccounts(): readonly AccountConfig[] {
    return this.getSettings().accounts
  }

  findAccount(accountId: AccountId): AccountConfig | null {
    return this.getAccounts().find((account) => account.id === accountId) ?? null
  }

  updateSettings(patch: UpdateSettingsRequest): AppSettings {
    return this.commit({ ...this.getSettings(), ...patch })
  }

  setPlacement(placement: WidgetPlacement): AppSettings {
    return this.commit({ ...this.getSettings(), placement })
  }

  /**
   * Adding an account that already exists refreshes its calendars and keeps
   * its colour. Overwriting is the contract, so deciding what an existing
   * account's calendars should be is the caller's job: see
   * `AccountService.register`, which keeps a saved selection rather than
   * writing the provider's defaults over it.
   */
  addAccount(account: NewAccount): AppSettings {
    const settings = this.getSettings()
    const existing = settings.accounts.find((candidate) => candidate.id === account.id)

    if (existing) {
      return this.replaceAccount(settings, {
        ...existing,
        label: account.label,
        calendarIds: account.calendarIds,
      })
    }

    const added: AccountConfig = {
      id: account.id,
      provider: account.provider,
      label: account.label,
      colour: nextAccountColour(settings.accounts),
      calendarIds: account.calendarIds,
    }
    this.logger.info('added account', { provider: account.provider })
    return this.commit({ ...settings, accounts: [...settings.accounts, added] })
  }

  removeAccount(accountId: AccountId): AppSettings {
    const settings = this.getSettings()
    const accounts = settings.accounts.filter((account) => account.id !== accountId)
    return this.commit({ ...settings, accounts })
  }

  updateAccount(
    accountId: AccountId,
    patch: { label?: string; colour?: AccountColour },
  ): AppSettings {
    const settings = this.getSettings()
    const existing = settings.accounts.find((account) => account.id === accountId)
    if (!existing) {
      return settings
    }
    return this.replaceAccount(settings, { ...existing, ...patch })
  }

  setSelectedCalendars(accountId: AccountId, calendarIds: readonly CalendarId[]): AppSettings {
    const settings = this.getSettings()
    const existing = settings.accounts.find((account) => account.id === accountId)
    if (!existing) {
      return settings
    }
    return this.replaceAccount(settings, { ...existing, calendarIds })
  }

  private replaceAccount(settings: AppSettings, account: AccountConfig): AppSettings {
    const accounts = settings.accounts.map((candidate) =>
      candidate.id === account.id ? account : candidate,
    )
    return this.commit({ ...settings, accounts })
  }

  private commit(settings: AppSettings): AppSettings {
    const validated = parseSettings(settings)
    this.store.set('settings', validated)
    this.changed.emit(validated)
    return validated
  }

  private migrate(): void {
    const version = this.store.get('schemaVersion')
    if (version === CURRENT_SCHEMA_VERSION) {
      return
    }
    this.logger.info('migrating settings store', {
      from: typeof version === 'number' ? version : null,
      to: CURRENT_SCHEMA_VERSION,
    })
    this.store.set('settings', parseSettings(this.store.get('settings')))
    this.store.set('schemaVersion', CURRENT_SCHEMA_VERSION)
  }
}
