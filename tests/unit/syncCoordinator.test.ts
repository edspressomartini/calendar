import { describe, expect, it, vi, type MockInstance } from 'vitest'
import { AgendaService } from '../../src/main/agenda/AgendaService.ts'
import type { CalendarProvider } from '../../src/main/calendar/CalendarProvider.ts'
import { ProviderRegistry } from '../../src/main/calendar/ProviderRegistry.ts'
import {
  EventKitError,
  ReauthRequiredError,
  TransientProviderError,
} from '../../src/main/infra/errors.ts'
import { SettingsStore } from '../../src/main/storage/SettingsStore.ts'
import { DEFAULT_SETTINGS } from '../../src/main/storage/schema.ts'
import { SyncCoordinator } from '../../src/main/sync/SyncCoordinator.ts'
import { CALENDAR_ACCESS_REFUSALS } from '../../src/shared/constants.ts'
import type { AccountConfig } from '../../src/shared/types/account.ts'
import type { AppSettings } from '../../src/shared/types/settings.ts'
import { silentLogger } from '../mocks/logger.ts'

/**
 * How a failed sync is classified (docs/spec.md §5, §7). The store is
 * automocked; the coordinator and the agenda are real.
 */

vi.mock('../../src/main/storage/SettingsStore.ts')

const ACCOUNT_ID = 'eventkit:icloud'

interface Harness {
  readonly coordinator: SyncCoordinator
  readonly setStatus: MockInstance<AgendaService['setStatus']>
}

function buildCoordinator(options: { fetchEvents: CalendarProvider['fetchEvents'] }): Harness {
  const logger = silentLogger()
  const account: AccountConfig = {
    id: ACCOUNT_ID,
    provider: 'eventkit',
    label: 'iCloud',
    colour: 'sky',
    calendarIds: [],
  }
  const currentSettings = (): AppSettings => ({ ...DEFAULT_SETTINGS, accounts: [account] })

  const settings = new SettingsStore(logger)
  vi.spyOn(settings, 'getSettings').mockImplementation(currentSettings)
  vi.spyOn(settings, 'getAccounts').mockReturnValue([account])
  vi.spyOn(settings, 'findAccount').mockReturnValue(account)

  const registry = new ProviderRegistry(logger)
  registry.set({
    kind: 'eventkit',
    accountId: ACCOUNT_ID,
    isAuthenticated: () => true,
    canListCalendars: () => true,
    listCalendars: () => Promise.resolve([]),
    fetchEvents: options.fetchEvents,
    disconnect: () => Promise.resolve(),
  })

  const agenda = new AgendaService({ getSettings: currentSettings })
  const setStatus = vi.spyOn(agenda, 'setStatus')

  return { coordinator: new SyncCoordinator(registry, settings, agenda, logger), setStatus }
}

describe('SyncCoordinator with EventKit failures', () => {
  it('treats refused access as needing the user, not as a transient failure', async () => {
    const { coordinator, setStatus } = buildCoordinator({
      fetchEvents: vi.fn().mockRejectedValue(new EventKitError('denied')),
    })

    await expect(coordinator.syncAccount(ACCOUNT_ID)).resolves.toBe('reauth')
    expect(setStatus).toHaveBeenLastCalledWith(ACCOUNT_ID, 'needsReauth')
  })

  /**
   * All three need a System Settings toggle, so none of them is worth a
   * retry. Driven by the shared list, which is the same one the connect
   * response reports from: the two paths cannot classify differently.
   */
  it.each(CALENDAR_ACCESS_REFUSALS)('treats %s as terminal', async (kind) => {
    const { coordinator, setStatus } = buildCoordinator({
      fetchEvents: vi.fn().mockRejectedValue(new EventKitError(kind)),
    })

    await expect(coordinator.syncAccount(ACCOUNT_ID)).resolves.toBe('reauth')
    expect(setStatus).toHaveBeenLastCalledWith(ACCOUNT_ID, 'needsReauth')
  })

  it('keeps retrying when the helper is merely unavailable', async () => {
    const { coordinator, setStatus } = buildCoordinator({
      fetchEvents: vi.fn().mockRejectedValue(new EventKitError('helper_unavailable')),
    })

    await expect(coordinator.syncAccount(ACCOUNT_ID)).resolves.toBe('transient')
    expect(setStatus).toHaveBeenLastCalledWith(ACCOUNT_ID, 'offline')
  })

  /** A slow or malformed helper is a bad moment, not a refused permission. */
  it.each(['timeout', 'protocol', 'store_failure', 'unknown_source', 'bad_request'] as const)(
    'keeps retrying after %s',
    async (kind) => {
      const { coordinator, setStatus } = buildCoordinator({
        fetchEvents: vi.fn().mockRejectedValue(new EventKitError(kind)),
      })

      await expect(coordinator.syncAccount(ACCOUNT_ID)).resolves.toBe('transient')
      expect(setStatus).toHaveBeenLastCalledWith(ACCOUNT_ID, 'offline')
    },
  )
})

/** The EventKit branch sits at the top of classify; it must catch nothing else. */
describe('SyncCoordinator with provider failures', () => {
  it('still sends a dead Google token to re-authentication', async () => {
    const { coordinator, setStatus } = buildCoordinator({
      fetchEvents: vi.fn().mockRejectedValue(new ReauthRequiredError(ACCOUNT_ID, 'invalid_grant')),
    })

    await expect(coordinator.syncAccount(ACCOUNT_ID)).resolves.toBe('reauth')
    expect(setStatus).toHaveBeenLastCalledWith(ACCOUNT_ID, 'needsReauth')
  })

  it('still keeps last-known events after a transient provider failure', async () => {
    const { coordinator, setStatus } = buildCoordinator({
      fetchEvents: vi
        .fn()
        .mockRejectedValue(new TransientProviderError(ACCOUNT_ID, 503, 'backend error')),
    })

    await expect(coordinator.syncAccount(ACCOUNT_ID)).resolves.toBe('transient')
    expect(setStatus).toHaveBeenLastCalledWith(ACCOUNT_ID, 'offline')
  })

  it('still treats an unrecognised failure as transient', async () => {
    const { coordinator, setStatus } = buildCoordinator({
      fetchEvents: vi.fn().mockRejectedValue(new Error('something else')),
    })

    await expect(coordinator.syncAccount(ACCOUNT_ID)).resolves.toBe('transient')
    expect(setStatus).toHaveBeenLastCalledWith(ACCOUNT_ID, 'offline')
  })
})
