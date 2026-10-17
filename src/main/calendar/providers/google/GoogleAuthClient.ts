import { randomBytes, randomUUID } from 'node:crypto'
import { calendar, type calendar_v3 } from '@googleapis/calendar'
import { CodeChallengeMethod, OAuth2Client, type Credentials } from 'google-auth-library'
import type { AccountIdentity, ProviderKind } from '../../../../shared/types/calendar.ts'
import { LoopbackServer } from '../../../auth/LoopbackServer.ts'
import type { SystemBrowser } from '../../../auth/SystemBrowser.ts'
import type { GoogleOAuthConfig } from '../../../infra/config.ts'
import { AuthFlowError, describeError } from '../../../infra/errors.ts'
import type { AppLogger } from '../../../infra/logger.ts'
import type { TokenVault } from '../../../storage/TokenVault.ts'
import type { AccountAuthenticator, AuthenticationResult } from '../../CalendarProvider.ts'
import {
  hasCalendarListScope,
  hasEventsScope,
  parseGrantedScopes,
  REQUESTED_SCOPES,
} from './googleScopes.ts'

/**
 * The Google sign-in dance (docs/spec.md §8.3): system browser, loopback
 * redirect, PKCE, checked state. On success the refresh token goes straight
 * into the vault and never travels anywhere else.
 */
export class GoogleAuthClient implements AccountAuthenticator {
  readonly kind: ProviderKind = 'google'

  constructor(
    private readonly config: GoogleOAuthConfig,
    private readonly vault: TokenVault,
    private readonly browser: SystemBrowser,
    private readonly logger: AppLogger,
  ) {}

  async authenticate(): Promise<AuthenticationResult> {
    const state = randomBytes(32).toString('base64url')
    const server = await LoopbackServer.start(state, this.logger)

    try {
      const client = this.createClient(server.redirectUri)
      const verifier = await client.generateCodeVerifierAsync()
      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        // Always ask, so Google always returns a refresh token.
        prompt: 'consent',
        scope: [...REQUESTED_SCOPES],
        state,
        code_challenge_method: CodeChallengeMethod.S256,
        code_challenge: verifier.codeChallenge,
      })

      await this.browser.openConsentPage(authUrl)
      const code = await server.waitForCode()
      const tokens = await this.exchangeCode(
        client,
        code,
        verifier.codeVerifier,
        server.redirectUri,
      )

      return await this.completeSignIn(client, tokens)
    } finally {
      await server.close()
    }
  }

  /**
   * The vendor error stops here. A `GaxiosError` carries the request config,
   * including the `Authorization` header, and its message is the raw response
   * body when that body is not JSON (§8.7).
   */
  private async exchangeCode(
    client: OAuth2Client,
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<Credentials> {
    try {
      const exchange = await client.getToken({ code, codeVerifier, redirect_uri: redirectUri })
      return exchange.tokens
    } catch {
      throw new AuthFlowError('exchange_failed')
    }
  }

  private async completeSignIn(
    client: OAuth2Client,
    tokens: Credentials,
  ): Promise<AuthenticationResult> {
    const grantedScopes = parseGrantedScopes(tokens.scope)

    if (!hasEventsScope(grantedScopes)) {
      // Without the events scope the app cannot do its one job; hand the grant back.
      await this.revokeQuietly(client, tokens.access_token ?? null)
      throw new AuthFlowError('denied', 'the calendar events permission was not granted')
    }

    const refreshToken = tokens.refresh_token
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      await this.revokeQuietly(client, tokens.access_token ?? null)
      throw new AuthFlowError('no_refresh_token')
    }

    client.setCredentials(tokens)
    const identity = await this.resolveIdentity(client, grantedScopes)

    await this.vault.write(identity.providerAccountId, {
      refreshToken,
      grantedScopes,
      obtainedAt: new Date().toISOString(),
    })

    this.logger.info('connected google account', {
      grantedCalendarList: hasCalendarListScope(grantedScopes),
    })

    return { identity, grantedScopes, defaultCalendarIds: ['primary'] }
  }

  /**
   * Keyed by the primary calendar id, which is the account's email address, so
   * no identity scope is requested (§8.2).
   */
  private async resolveIdentity(
    client: OAuth2Client,
    grantedScopes: readonly string[],
  ): Promise<AccountIdentity> {
    const api = calendar({ version: 'v3', auth: client })

    if (hasCalendarListScope(grantedScopes)) {
      const primary = await this.findPrimaryCalendar(api)
      if (primary?.id) {
        return { providerAccountId: primary.id, label: primary.summary ?? primary.id }
      }
    }

    // Calendar-list access was declined, so the email is unavailable. Fall back
    // to a random id: the account still works, but connecting the same account
    // twice would create a second entry.
    const label = await this.readPrimaryCalendarTitle(api)
    return { providerAccountId: `google:${randomUUID()}`, label }
  }

  private async findPrimaryCalendar(
    api: calendar_v3.Calendar,
  ): Promise<calendar_v3.Schema$CalendarListEntry | null> {
    const response = await api.calendarList.list({ maxResults: 250, showHidden: false })
    const items = response.data.items ?? []
    return items.find((entry) => entry.primary === true) ?? null
  }

  private async readPrimaryCalendarTitle(api: calendar_v3.Calendar): Promise<string> {
    try {
      const response = await api.events.list({ calendarId: 'primary', maxResults: 1 })
      const summary = response.data.summary
      return typeof summary === 'string' && summary.length > 0 ? summary : 'Google Calendar'
    } catch {
      return 'Google Calendar'
    }
  }

  private createClient(redirectUri: string): OAuth2Client {
    return new OAuth2Client({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      redirectUri,
    })
  }

  private async revokeQuietly(client: OAuth2Client, accessToken: string | null): Promise<void> {
    if (!accessToken) {
      return
    }
    try {
      await client.revokeToken(accessToken)
    } catch (error) {
      this.logger.warn('could not revoke partially granted token', {
        error: describeError(error),
      })
    }
  }
}
