import { endOfLocalDay, startOfLocalDay } from '../../shared/time.ts'
import type { AccountId, TimeRange } from '../../shared/types/calendar.ts'
import type { AgendaService } from '../agenda/AgendaService.ts'
import type { ProviderRegistry } from '../calendar/ProviderRegistry.ts'
import type { EventKitError } from '../infra/errors.ts'
import { describeError, isEventKitError, isReauthRequired, isTransient } from '../infra/errors.ts'
import type { AppLogger } from '../infra/logger.ts'
import type { SettingsStore } from '../storage/SettingsStore.ts'

/**
 * Fans out to providers and fans results in to the agenda (docs/spec.md §5).
 * It never touches a window.
 */

export type SyncOutcome = 'ok' | 'transient' | 'reauth' | 'unavailable'

/** Typed against the error's own union, so a mistyped member will not compile. */
const TERMINAL_EVENTKIT_KINDS: ReadonlySet<EventKitError['kind']> = new Set<EventKitError['kind']>([
  'denied',
  'restricted',
  'writeOnly',
])

export class SyncCoordinator {
  /** One in-flight sync per account; later triggers join it (§7). */
  private readonly inFlight = new Map<AccountId, Promise<SyncOutcome>>()

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly settings: SettingsStore,
    private readonly agenda: AgendaService,
    private readonly logger: AppLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  syncAccount(accountId: AccountId): Promise<SyncOutcome> {
    const existing = this.inFlight.get(accountId)
    if (existing) {
      return existing
    }

    const run = this.runSync(accountId).finally(() => {
      this.inFlight.delete(accountId)
    })
    this.inFlight.set(accountId, run)
    return run
  }

  async syncAll(): Promise<void> {
    const accounts = this.settings.getAccounts()
    const runs = accounts.map((account) => this.syncAccount(account.id))
    await Promise.all(runs)
  }

  /** Local start of today to end of today, recomputed every sync so DST and
   * travel need no restart (§7). */
  currentRange(): TimeRange {
    const now = this.now()
    return {
      start: startOfLocalDay(now).toISOString(),
      end: endOfLocalDay(now).toISOString(),
    }
  }

  private async runSync(accountId: AccountId): Promise<SyncOutcome> {
    const provider = this.registry.get(accountId)
    if (!provider) {
      this.agenda.setStatus(accountId, 'needsReauth')
      return 'unavailable'
    }

    const account = this.settings.findAccount(accountId)
    const calendarIds = account?.calendarIds ?? []
    this.agenda.setStatus(accountId, 'syncing')

    try {
      const events = await provider.fetchEvents(calendarIds, this.currentRange())
      this.agenda.setEvents(accountId, events)
      this.agenda.setStatus(accountId, 'ready', new Date().toISOString())
      this.logger.debug('sync complete', { events: events.length })
      return 'ok'
    } catch (error) {
      return this.classify(accountId, error)
    }
  }

  /** Caught here to choose a retry policy, not to swallow (§5, §8.7). */
  private classify(accountId: AccountId, error: unknown): SyncOutcome {
    // Refused, restricted by policy, or granted write-only: all three need a
    // System Settings change, so retrying would only spin (§7).
    if (isEventKitError(error) && TERMINAL_EVENTKIT_KINDS.has(error.kind)) {
      this.agenda.setStatus(accountId, 'needsReauth')
      this.logger.warn('calendar access refused', { kind: error.kind })
      return 'reauth'
    }

    if (isReauthRequired(error)) {
      this.agenda.setStatus(accountId, 'needsReauth')
      this.logger.warn('account needs re-authentication', { reason: error.reason })
      return 'reauth'
    }

    if (isTransient(error)) {
      // Last-known events stay on screen; only the status strip changes (§7).
      this.agenda.setStatus(accountId, 'offline')
      this.logger.warn('sync failed; keeping last-known events', {
        statusCode: error.statusCode,
      })
      return 'transient'
    }

    this.agenda.setStatus(accountId, 'offline')
    this.logger.error('unexpected sync failure', { error: describeError(error) })
    return 'transient'
  }
}
