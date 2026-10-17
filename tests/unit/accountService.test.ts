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
  readonly createAuthenticator: MockInstance<ProviderFactory['createAuthenticator']>
}

function buildService(options: { authenticate: () => Promise<AuthenticationResult[]> }): Harness {
  const logger = silentLogger()
  const accounts: AccountConfig[] = []
  const currentSettings = (): AppSettings => ({ ...DEFAULT_SETTINGS, accounts })

  const settings = new SettingsStore(logger)
  vi.spyOn(settings, 'getSettings').mockImplementation(currentSettings)
  vi.spyOn(settings, 'getAccounts').mockImplementation(() => accounts)
  vi.spyOn(settings, 'findAccount').mockImplementation(
    (accountId) => accounts.find((account) => account.id === accountId) ?? null,
  )
  vi.spyOn(settings, 'addAccount').mockImplementation((account) => {
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

  return { service, settings, createAuthenticator }
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
