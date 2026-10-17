import type { ProviderKind } from '../../../../shared/types/calendar.ts'
import { EventKitError } from '../../../infra/errors.ts'
import type { AppLogger } from '../../../infra/logger.ts'
import type { AccountAuthenticator, AuthenticationResult } from '../../CalendarProvider.ts'
import type { EventKitRequester } from './EventKitHelperProcess.ts'
import { eventKitAuthorizationSchema, eventKitSourceListSchema } from './EventKitProtocol.ts'
import { eventKitAccountId } from './EventKitProvider.ts'

/**
 * Triggers the macOS calendar prompt, then turns every source the Mac knows
 * about into one account. No browser, no token, no vendor round trip.
 */
export class EventKitAuthorizer implements AccountAuthenticator {
  readonly kind: ProviderKind = 'eventkit'

  constructor(
    private readonly helper: EventKitRequester,
    private readonly logger: AppLogger,
  ) {}

  async authenticate(): Promise<AuthenticationResult[]> {
    const authorization = await this.helper.request('authorize', {}, eventKitAuthorizationSchema)

    if (authorization.status !== 'granted') {
      // denied, restricted and writeOnly are all terminal until the user
      // changes a System Settings toggle, so they are reported as themselves.
      throw new EventKitError(
        authorization.status === 'notDetermined' ? 'denied' : authorization.status,
      )
    }

    const sources = await this.helper.request('sources', {}, eventKitSourceListSchema)
    this.logger.info('calendar access granted', { sources: sources.length })

    return sources.map((source) => ({
      identity: { providerAccountId: eventKitAccountId(source.id), label: source.title },
      grantedScopes: ['eventkit.read'],
      defaultCalendarIds: source.defaultCalendarId ? [source.defaultCalendarId] : [],
    }))
  }
}
