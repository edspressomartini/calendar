import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { AgendaService } from '../../src/main/agenda/AgendaService.ts'
import { ProviderRegistry } from '../../src/main/calendar/ProviderRegistry.ts'
import { SettingsStore } from '../../src/main/storage/SettingsStore.ts'
import { DEFAULT_SETTINGS } from '../../src/main/storage/schema.ts'
import { SyncCoordinator } from '../../src/main/sync/SyncCoordinator.ts'
import { SyncScheduler } from '../../src/main/sync/SyncScheduler.ts'
import type { AccountConfig } from '../../src/shared/types/account.ts'
import type { ProviderKind } from '../../src/shared/types/calendar.ts'
import type { AppSettings } from '../../src/shared/types/settings.ts'
import { silentLogger } from '../mocks/logger.ts'

/**
 * The refresh loops (docs/spec.md §7). The collaborators that reach the disk
 * or a provider are automocked; the scheduler itself is real and drives fake
 * timers.
 */

vi.mock('../../src/main/storage/SettingsStore.ts')
vi.mock('../../src/main/sync/SyncCoordinator.ts')

interface Harness {
  readonly scheduler: SyncScheduler
  readonly syncAccount: MockInstance<SyncCoordinator['syncAccount']>
}

interface HarnessAccount {
  readonly id: string
  readonly provider: ProviderKind
}

function buildScheduler(options: { accounts: readonly HarnessAccount[] }): Harness {
  const logger = silentLogger()
  const accounts: AccountConfig[] = options.accounts.map((account) => ({
    id: account.id,
    provider: account.provider,
    label: account.id,
    colour: 'sky',
    calendarIds: [],
  }))
  const currentSettings = (): AppSettings => ({ ...DEFAULT_SETTINGS, accounts })

  const settings = new SettingsStore(logger)
  vi.spyOn(settings, 'getSettings').mockImplementation(currentSettings)
  vi.spyOn(settings, 'getAccounts').mockReturnValue(accounts)

  const coordinator = new SyncCoordinator(
    new ProviderRegistry(logger),
    settings,
    new AgendaService({ getSettings: currentSettings }),
    logger,
  )
  const syncAccount = vi.spyOn(coordinator, 'syncAccount').mockResolvedValue('ok')

  return { scheduler: new SyncScheduler(coordinator, settings, logger), syncAccount }
}

const BOTH_PROVIDERS: readonly HarnessAccount[] = [
  { id: 'eventkit:icloud', provider: 'eventkit' },
  { id: 'work@example.com', provider: 'google' },
]

describe('SyncScheduler.syncProviderNow', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('syncs only the accounts of that provider, once per burst', async () => {
    vi.useFakeTimers()
    const { scheduler, syncAccount } = buildScheduler({ accounts: BOTH_PROVIDERS })
    scheduler.start()
    syncAccount.mockClear()

    scheduler.syncProviderNow('eventkit', 'calendar store changed')
    scheduler.syncProviderNow('eventkit', 'calendar store changed')
    scheduler.syncProviderNow('eventkit', 'calendar store changed')
    await vi.advanceTimersByTimeAsync(2_100)

    expect(syncAccount).toHaveBeenCalledOnce()
    expect(syncAccount).toHaveBeenCalledWith('eventkit:icloud')

    scheduler.stop()
  })

  /** The burst is only coalesced while it lasts; a later edit syncs again. */
  it('arms a fresh timer for a change that arrives after the burst has fired', async () => {
    vi.useFakeTimers()
    const { scheduler, syncAccount } = buildScheduler({ accounts: BOTH_PROVIDERS })
    scheduler.start()
    syncAccount.mockClear()

    scheduler.syncProviderNow('eventkit', 'calendar store changed')
    await vi.advanceTimersByTimeAsync(2_100)
    scheduler.syncProviderNow('eventkit', 'calendar store changed')
    await vi.advanceTimersByTimeAsync(2_100)

    expect(syncAccount).toHaveBeenCalledTimes(2)
    expect(syncAccount).toHaveBeenLastCalledWith('eventkit:icloud')

    scheduler.stop()
  })

  it('ignores a change that arrives after stop', async () => {
    vi.useFakeTimers()
    const { scheduler, syncAccount } = buildScheduler({ accounts: BOTH_PROVIDERS })
    scheduler.start()
    scheduler.stop()
    syncAccount.mockClear()

    scheduler.syncProviderNow('eventkit', 'calendar store changed')
    await vi.advanceTimersByTimeAsync(2_100)

    expect(syncAccount).not.toHaveBeenCalled()
  })

  /** Quitting mid-burst must not sync an account the scheduler has released. */
  it('drops a pending burst when the scheduler stops before the timer fires', async () => {
    vi.useFakeTimers()
    const { scheduler, syncAccount } = buildScheduler({ accounts: BOTH_PROVIDERS })
    scheduler.start()
    syncAccount.mockClear()

    scheduler.syncProviderNow('eventkit', 'calendar store changed')
    scheduler.stop()
    await vi.advanceTimersByTimeAsync(2_100)

    expect(syncAccount).not.toHaveBeenCalled()
  })
})
