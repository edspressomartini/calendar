import type {
  AccountColour,
  AccountConfig,
  AccountView,
  ConnectAccountsResult,
} from '../../shared/types/account.ts'
import type {
  AccountId,
  CalendarId,
  CalendarSummary,
  ProviderKind,
} from '../../shared/types/calendar.ts'
import type { AgendaService } from '../agenda/AgendaService.ts'
import { describeError, isCalendarAccessRefusal } from '../infra/errors.ts'
import type { AppLogger } from '../infra/logger.ts'
import type { SettingsStore } from '../storage/SettingsStore.ts'
import type { TokenVault } from '../storage/TokenVault.ts'
import type { SyncScheduler } from '../sync/SyncScheduler.ts'
import type { AuthenticationResult, CalendarProvider } from './CalendarProvider.ts'
import type { ProviderFactory } from './ProviderFactory.ts'
import type { ProviderRegistry } from './ProviderRegistry.ts'

/**
 * Account lifecycle: connect, reconnect, disconnect, choose calendars
 * (docs/spec.md §3). IPC handlers delegate here and stay thin.
 */
export class AccountService {
  constructor(
    private readonly settings: SettingsStore,
    private readonly factory: ProviderFactory,
    private readonly registry: ProviderRegistry,
    private readonly agenda: AgendaService,
    private readonly vault: TokenVault,
    private readonly scheduler: SyncScheduler,
    private readonly logger: AppLogger,
  ) {}

  /** Rebuilds live providers for saved accounts at startup. */
  async restore(): Promise<void> {
    const accounts = this.settings.getAccounts()

    for (const account of accounts) {
      const provider = await this.createOrFlag(account)
      if (!provider) {
        continue
      }
      this.registry.set(provider)
    }
  }

  /**
   * Reading a credential can throw, not just come back empty: the Keychain
   * refuses when the user dismisses its prompt, which happens on the first
   * launch of a newly signed build. Unhandled, that rejection took the rest
   * of the accounts down with it. Every failure means the same thing to the
   * user — this account needs reconnecting (§7) — so it is reported once and
   * the loop carries on.
   */
  private async createOrFlag(account: AccountConfig): Promise<CalendarProvider | null> {
    try {
      const provider = await this.factory.create(account)
      if (provider) {
        return provider
      }
      // The credential is gone or this build has no OAuth client.
      this.agenda.setStatus(account.id, 'needsReauth')
      return null
    } catch (error) {
      // No account id: they are email addresses (§8.7).
      this.logger.warn('could not restore account', {
        provider: account.provider,
        error: describeError(error),
      })
      this.agenda.setStatus(account.id, 'needsReauth')
      return null
    }
  }

  /**
   * Phase 1 development: with no OAuth client built in there is nothing to
   * connect to, so the mock provider drives the whole UI instead (§9).
   */
  async addMockAccount(): Promise<void> {
    const settings = this.settings.addAccount({
      id: 'mock:demo',
      provider: 'mock',
      label: 'Demo calendar',
      calendarIds: ['primary'],
    })

    const account = settings.accounts.find((candidate) => candidate.id === 'mock:demo')
    if (!account) {
      return
    }

    const provider = await this.factory.create(account)
    if (provider) {
      this.registry.set(provider)
      this.agenda.setStatus(account.id, 'ready')
    }
  }

  list(): AccountView[] {
    return this.settings.getAccounts().map((account) => {
      const provider = this.registry.get(account.id)
      return {
        id: account.id,
        provider: account.provider,
        label: account.label,
        colour: account.colour,
        status: this.agenda.getStatus(account.id),
        calendarIds: account.calendarIds,
        lastSyncedAt: this.agenda.getLastSyncedAt(account.id),
        canListCalendars: provider?.canListCalendars() ?? false,
      }
    })
  }

  canConnect(kind: ProviderKind): boolean {
    return this.factory.canConnect(kind)
  }

  /**
   * One grant can produce several accounts: Google signs in one at a time,
   * while EventKit yields one account per calendar source (§3).
   */
  async connect(kind: ProviderKind): Promise<ConnectAccountsResult> {
    const authenticator = this.factory.createAuthenticator(kind)

    let results: readonly AuthenticationResult[]
    try {
      results = await authenticator.authenticate()
    } catch (error) {
      // Caught to answer the user, not to swallow: a refusal has no account
      // to hang a needsReauth status on, so it travels back in the response
      // and the Accounts pane offers System Settings inline (§7). Anything
      // else is a real failure and carries on to the IPC boundary.
      if (!isCalendarAccessRefusal(error)) {
        throw error
      }
      this.logger.warn('calendar access refused at sign-in', { provider: kind, kind: error.kind })
      return { accounts: this.list(), refusal: error.kind }
    }

    // Sign-in can span a browser round trip or a permission prompt, so it is
    // traced: a stall shows up as a spinner that never stops.
    this.logger.info('sign-in returned', { provider: kind, accounts: results.length })

    // This is the boundary between a grant covering several sources and a
    // single UI response, so a failing source is caught and the rest are still
    // registered: losing all of iCloud because one local calendar could not be
    // written is not a trade the user would make.
    const failures: unknown[] = []
    let registered = 0

    for (const result of results) {
      try {
        await this.register(kind, result)
        registered += 1
      } catch (error) {
        failures.push(error)
        // No account id: for Google they are email addresses, and no label
        // either — it is the source's own name (§8.7).
        this.logger.warn('could not register account', {
          provider: kind,
          error: describeError(error),
        })
      }
    }

    // Before any rethrow: whatever did register needs scheduling, or it would
    // sit unsynced until the next restart.
    this.scheduler.reconcile()

    // Nothing landed, so there is nothing to show: the first failure travels on
    // to the IPC log and the renderer's generic sign-in error. Returning the
    // list here would look like success.
    if (registered === 0 && failures.length > 0) {
      throw failures[0]
    }

    return { accounts: this.list(), refusal: null }
  }

  /** Re-running consent for an existing account; a fresh grant replaces the dead one. */
  async reconnect(accountId: AccountId): Promise<ConnectAccountsResult> {
    const existing = this.settings.findAccount(accountId)
    const kind = existing?.provider ?? 'google'
    this.registry.forget(accountId)
    return await this.connect(kind)
  }

  private async register(kind: ProviderKind, result: AuthenticationResult): Promise<void> {
    const accountId = result.identity.providerAccountId

    this.settings.addAccount({
      id: accountId,
      provider: kind,
      label: result.identity.label,
      calendarIds: result.defaultCalendarIds,
    })

    const account = this.settings.findAccount(accountId)
    if (account) {
      const provider = await this.factory.create(account)
      if (provider) {
        this.registry.set(provider)
      }
    }
    this.logger.info('provider ready', { registered: this.registry.has(accountId) })

    this.agenda.setStatus(accountId, 'ready')
    // Deliberately not awaited: the first sync must not delay the UI response.
    void this.scheduler.syncNow(accountId)
  }

  async disconnect(accountId: AccountId): Promise<AccountView[]> {
    // Revoke with the vendor first, then remove locally, and remove locally
    // even if revoking failed (§8.2).
    await this.registry.disconnect(accountId)

    try {
      await this.vault.delete(accountId)
    } catch (error) {
      this.logger.warn('could not delete stored credential', { error: describeError(error) })
    }

    this.settings.removeAccount(accountId)
    this.agenda.forget(accountId)
    this.scheduler.reconcile()
    return this.list()
  }

  update(accountId: AccountId, patch: { label?: string; colour?: AccountColour }): AccountView[] {
    this.settings.updateAccount(accountId, patch)
    this.agenda.refresh()
    return this.list()
  }

  async listCalendars(accountId: AccountId): Promise<CalendarSummary[]> {
    const provider = this.registry.get(accountId)
    if (!provider) {
      return []
    }
    return await provider.listCalendars()
  }

  async setCalendars(
    accountId: AccountId,
    calendarIds: readonly CalendarId[],
  ): Promise<AccountView[]> {
    this.settings.setSelectedCalendars(accountId, calendarIds)
    await this.scheduler.syncNow(accountId)
    return this.list()
  }
}
