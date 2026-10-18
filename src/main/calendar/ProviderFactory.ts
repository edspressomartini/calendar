import type { AccountConfig } from '../../shared/types/account.ts'
import type { ProviderKind } from '../../shared/types/calendar.ts'
import type { SystemBrowser } from '../auth/SystemBrowser.ts'
import type { AppConfig } from '../infra/config.ts'
import type { AppLogger } from '../infra/logger.ts'
import type { TokenVault } from '../storage/TokenVault.ts'
import type { AccountAuthenticator, CalendarProvider } from './CalendarProvider.ts'
import { EventKitAuthorizer } from './providers/eventkit/EventKitAuthorizer.ts'
import type { EventKitRequester } from './providers/eventkit/EventKitHelperProcess.ts'
import { EventKitProvider, eventKitSourceId } from './providers/eventkit/EventKitProvider.ts'
import { GoogleAuthClient } from './providers/google/GoogleAuthClient.ts'
import { GoogleCalendarProvider } from './providers/google/GoogleCalendarProvider.ts'
import { MockCalendarProvider } from './providers/mock/MockCalendarProvider.ts'

/**
 * ProviderKind to instance (docs/spec.md §4). The one place that knows which
 * vendors exist — swapping Google for the mock is a change here and nowhere
 * else.
 */
export class ProviderFactory {
  constructor(
    private readonly config: AppConfig,
    private readonly vault: TokenVault,
    private readonly browser: SystemBrowser,
    private readonly helper: EventKitRequester,
    private readonly logger: AppLogger,
  ) {}

  /** True when the app was built with an OAuth client (§8.3). */
  canConnect(kind: ProviderKind): boolean {
    if (kind === 'mock' || kind === 'eventkit') {
      return true
    }
    return this.config.google !== null
  }

  createAuthenticator(kind: ProviderKind): AccountAuthenticator {
    if (kind === 'eventkit') {
      return new EventKitAuthorizer(this.helper, this.logger.child('eventkit-auth'))
    }
    if (kind !== 'google') {
      throw new Error(`no authenticator for provider ${kind}`)
    }
    const google = this.config.google
    if (!google) {
      throw new Error('this build has no Google OAuth client configured')
    }
    return new GoogleAuthClient(google, this.vault, this.browser, this.logger.child('google-auth'))
  }

  /** Returns null when the account has no usable stored credential. */
  async create(account: AccountConfig): Promise<CalendarProvider | null> {
    if (account.provider === 'mock') {
      return new MockCalendarProvider(account.id)
    }

    if (account.provider === 'eventkit') {
      return new EventKitProvider(
        account.id,
        eventKitSourceId(account.id),
        this.helper,
        this.logger.child('eventkit'),
      )
    }

    const google = this.config.google
    if (!google) {
      return null
    }

    const credential = await this.vault.read(account.id)
    if (!credential) {
      return null
    }

    return new GoogleCalendarProvider(
      account.id,
      google,
      credential,
      this.vault,
      this.logger.child('google'),
    )
  }
}
