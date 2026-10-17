import type { AccountId, ProviderKind } from '../../shared/types/calendar.ts'
import { MINUTE_MS } from '../../shared/time.ts'
import type { AppLogger } from '../infra/logger.ts'
import type { SettingsStore } from '../storage/SettingsStore.ts'
import type { SyncCoordinator, SyncOutcome } from './SyncCoordinator.ts'

/**
 * Per-account refresh loops (docs/spec.md §7).
 *
 * A managed setTimeout chain, not node-cron. Jitter keeps two accounts from
 * firing together, failures back off, and a dead refresh token stops the loop
 * entirely rather than spinning.
 */

const JITTER_MS = 30_000
const BACKOFF_START_MS = 30_000
const BACKOFF_CAP_MS = 10 * MINUTE_MS
const STORE_CHANGE_DEBOUNCE_MS = 2_000

export class SyncScheduler {
  private readonly timers = new Map<AccountId, NodeJS.Timeout>()
  private readonly backoff = new Map<AccountId, number>()
  private storeChangeTimer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly coordinator: SyncCoordinator,
    private readonly settings: SettingsStore,
    private readonly logger: AppLogger,
  ) {}

  start(): void {
    this.running = true
    this.reconcile({ syncImmediately: true })
  }

  stop(): void {
    this.running = false
    if (this.storeChangeTimer) {
      clearTimeout(this.storeChangeTimer)
      this.storeChangeTimer = null
    }
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
  }

  /** Called when accounts or the interval change: adds, drops and reschedules. */
  reconcile(options: { syncImmediately?: boolean } = {}): void {
    if (!this.running) {
      return
    }

    const accountIds = new Set(this.settings.getAccounts().map((account) => account.id))

    for (const accountId of [...this.timers.keys()]) {
      if (!accountIds.has(accountId)) {
        this.clear(accountId)
      }
    }

    for (const accountId of accountIds) {
      if (this.timers.has(accountId)) {
        continue
      }
      if (options.syncImmediately) {
        void this.syncNow(accountId)
        continue
      }
      this.scheduleNext(accountId, this.intervalMs())
    }
  }

  /** Every trigger — wake, unlock, midnight, the menu — lands here (§7). */
  syncAllNow(reason: string): void {
    if (!this.running) {
      return
    }
    this.logger.info('sync triggered', { reason })
    for (const account of this.settings.getAccounts()) {
      void this.syncNow(account.id)
    }
  }

  /**
   * The macOS calendar store announces changes in bursts — one per calendar
   * touched — so the first one starts a short timer and the rest join it.
   */
  syncProviderNow(kind: ProviderKind, reason: string): void {
    if (!this.running || this.storeChangeTimer) {
      return
    }

    this.storeChangeTimer = setTimeout(() => {
      this.storeChangeTimer = null
      this.logger.info('sync triggered', { reason })
      for (const account of this.settings.getAccounts()) {
        if (account.provider === kind) {
          void this.syncNow(account.id)
        }
      }
    }, STORE_CHANGE_DEBOUNCE_MS)
  }

  async syncNow(accountId: AccountId): Promise<void> {
    this.clear(accountId)
    const outcome = await this.coordinator.syncAccount(accountId)
    this.planNext(accountId, outcome)
  }

  private planNext(accountId: AccountId, outcome: SyncOutcome): void {
    if (!this.running) {
      return
    }

    // A dead refresh token is terminal until the user reconnects (§7).
    if (outcome === 'reauth' || outcome === 'unavailable') {
      this.backoff.delete(accountId)
      return
    }

    if (outcome === 'ok') {
      this.backoff.delete(accountId)
      this.scheduleNext(accountId, this.intervalMs())
      return
    }

    const previous = this.backoff.get(accountId) ?? 0
    const next = previous === 0 ? BACKOFF_START_MS : Math.min(previous * 2, BACKOFF_CAP_MS)
    this.backoff.set(accountId, next)
    this.scheduleNext(accountId, next)
  }

  private scheduleNext(accountId: AccountId, baseDelayMs: number): void {
    this.clear(accountId)
    const timer = setTimeout(() => {
      void this.syncNow(accountId)
    }, this.withJitter(baseDelayMs))
    this.timers.set(accountId, timer)
  }

  private clear(accountId: AccountId): void {
    const timer = this.timers.get(accountId)
    if (!timer) {
      return
    }
    clearTimeout(timer)
    this.timers.delete(accountId)
  }

  private intervalMs(): number {
    return this.settings.getSettings().syncIntervalMinutes * MINUTE_MS
  }

  /** Plus or minus 30s, never below a second. */
  private withJitter(baseDelayMs: number): number {
    const offset = (Math.random() * 2 - 1) * JITTER_MS
    return Math.max(1_000, Math.round(baseDelayMs + offset))
  }
}
