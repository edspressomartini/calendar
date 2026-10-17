import { describe, expect, it, vi, type MockInstance } from 'vitest'
import { AgendaService } from '../../src/main/agenda/AgendaService.ts'
import { AccountService } from '../../src/main/calendar/AccountService.ts'
import type { AuthenticationResult } from '../../src/main/calendar/CalendarProvider.ts'
import { ProviderFactory } from '../../src/main/calendar/ProviderFactory.ts'
import { ProviderRegistry } from '../../src/main/calendar/ProviderRegistry.ts'
import { SystemBrowser } from '../../src/main/auth/SystemBrowser.ts'
import { SettingsStore } from '../../src/main/storage/SettingsStore.ts'
import { TokenVault } from '../../src/main/storage/TokenVault.ts'
import { DEFAULT_SETTINGS } from '../../src/main/storage/schema.ts'
import { SyncCoordinator } from '../../src/main/sync/SyncCoordinator.ts'
import { SyncScheduler } from '../../src/main/sync/SyncScheduler.ts'
import type { AccountConfig } from '../../src/shared/types/account.ts'
import type { AppSettings } from '../../src/shared/types/settings.ts'
import { silentLogger } from '../mocks/logger.ts'

/**
 * Connecting accounts (docs/spec.md §3). The collaborators that reach the
 * disk, a vendor or a child process are automocked; the in-memory ones are
 * real, and the settings store keeps its accounts in an array.
 */

vi.mock('../../src/main/storage/SettingsStore.ts')
vi.mock('../../src/main/storage/TokenVault.ts')
vi.mock('../../src/main/calendar/ProviderFactory.ts')
vi.mock('../../src/main/sync/SyncCoordinator.ts')
vi.mock('../../src/main/sync/SyncScheduler.ts')

interface Harness {
  readonly service: AccountService
  readonly settings: SettingsStore
  readonly scheduler: SyncScheduler
  readonly createAuthenticator: MockInstance<ProviderFactory['createAuthenticator']>
}

interface HarnessOptions {
  readonly authenticate: () => Promise<AuthenticationResult[]>
  /** Account ids whose settings write throws, standing in for a failed disk write. */
  readonly unwritableAccountIds?: readonly string[]
}

function buildService(options: HarnessOptions): Harness {
  const logger = silentLogger()
  const accounts: AccountConfig[] = []
  const currentSettings = (): AppSettings => ({ ...DEFAULT_SETTINGS, accounts })
  const unwritable = new Set(options.unwritableAccountIds ?? [])

  const settings = new SettingsStore(logger)
  vi.spyOn(settings, 'getSettings').mockImplementation(currentSettings)
  vi.spyOn(settings, 'getAccounts').mockImplementation(() => accounts)
  vi.spyOn(settings, 'findAccount').mockImplementation(
    (accountId) => accounts.find((account) => account.id === accountId) ?? null,
  )
  vi.spyOn(settings, 'addAccount').mockImplementation((account) => {
    if (unwritable.has(account.id)) {
      throw new Error('could not write settings')
    }
    accounts.push({
      id: account.id,
      provider: account.provider,
      label: account.label,
      colour: 'sky',
      calendarIds: account.calendarIds,
    })
    return currentSettings()
  })

  const vault = new TokenVault('/nowhere', logger)
  const factory = new ProviderFactory(
    { isDev: true, google: null },
    vault,
    new SystemBrowser(),
    { request: () => Promise.reject(new Error('the helper is not used in these tests')) },
    logger,
  )
  const createAuthenticator = vi
    .spyOn(factory, 'createAuthenticator')
    .mockImplementation((kind) => ({ kind, authenticate: options.authenticate }))
  vi.spyOn(factory, 'create').mockResolvedValue(null)

  const registry = new ProviderRegistry(logger)
  const agenda = new AgendaService({ getSettings: currentSettings })
  const coordinator = new SyncCoordinator(registry, settings, agenda, logger)
  const scheduler = new SyncScheduler(coordinator, settings, logger)

  const service = new AccountService(settings, factory, registry, agenda, vault, scheduler, logger)

  return { service, settings, scheduler, createAuthenticator }
}

function authenticationResult(providerAccountId: string, label: string): AuthenticationResult {
  return {
    identity: { providerAccountId, label },
    grantedScopes: ['eventkit.read'],
    defaultCalendarIds: [],
  }
}

describe('AccountService.connect', () => {
  it('registers one account per authentication result', async () => {
    const results: AuthenticationResult[] = [
      {
        identity: { providerAccountId: 'eventkit:icloud', label: 'iCloud' },
        grantedScopes: ['eventkit.read'],
        defaultCalendarIds: ['cal-1'],
      },
      authenticationResult('eventkit:work', 'Work'),
    ]
    const { service, settings } = buildService({ authenticate: vi.fn().mockResolvedValue(results) })

    await service.connect('eventkit')

    expect(settings.getAccounts().map((account) => account.id)).toEqual([
      'eventkit:icloud',
      'eventkit:work',
    ])
  })

  it('reconciles the scheduler once, after every result is registered', async () => {
    const results = [
      authenticationResult('eventkit:icloud', 'iCloud'),
      authenticationResult('eventkit:work', 'Work'),
    ]
    const { service, scheduler } = buildService({
      authenticate: vi.fn().mockResolvedValue(results),
    })
    const reconcile = vi.spyOn(scheduler, 'reconcile')

    await service.connect('eventkit')

    expect(reconcile).toHaveBeenCalledTimes(1)
  })

  /**
   * One EventKit grant yields an account per calendar source, so a single
   * source failing must not cost the user the rest of them (§3).
   */
  it('keeps the sources that registered when one of them fails', async () => {
    const results = [
      authenticationResult('eventkit:icloud', 'iCloud'),
      authenticationResult('eventkit:work', 'Work'),
      authenticationResult('eventkit:local', 'On My Mac'),
    ]
    const { service, settings, scheduler } = buildService({
      authenticate: vi.fn().mockResolvedValue(results),
      unwritableAccountIds: ['eventkit:work'],
    })
    const reconcile = vi.spyOn(scheduler, 'reconcile')

    const views = await service.connect('eventkit')

    expect(views.map((view) => view.id)).toEqual(['eventkit:icloud', 'eventkit:local'])
    expect(settings.getAccounts().map((account) => account.id)).toEqual([
      'eventkit:icloud',
      'eventkit:local',
    ])
    expect(reconcile).toHaveBeenCalledTimes(1)
  })

  it('rejects when every result failed to register', async () => {
    const results = [
      authenticationResult('eventkit:icloud', 'iCloud'),
      authenticationResult('eventkit:work', 'Work'),
    ]
    const { service, scheduler } = buildService({
      authenticate: vi.fn().mockResolvedValue(results),
      unwritableAccountIds: ['eventkit:icloud', 'eventkit:work'],
    })
    const reconcile = vi.spyOn(scheduler, 'reconcile')

    await expect(service.connect('eventkit')).rejects.toThrow('could not write settings')
    expect(reconcile).toHaveBeenCalledTimes(1)
  })

  /** A grant the user declined returns no sources; that is not a failure. */
  it('resolves when authentication returned no results at all', async () => {
    const { service } = buildService({ authenticate: vi.fn().mockResolvedValue([]) })

    await expect(service.connect('eventkit')).resolves.toEqual([])
  })

  it('reconnects an account using its own provider kind', async () => {
    const authenticate = vi
      .fn()
      .mockResolvedValue([authenticationResult('eventkit:icloud', 'iCloud')])
    const { service, createAuthenticator } = buildService({ authenticate })
    await service.connect('eventkit')

    await service.reconnect('eventkit:icloud')

    expect(createAuthenticator).toHaveBeenLastCalledWith('eventkit')
  })
})
