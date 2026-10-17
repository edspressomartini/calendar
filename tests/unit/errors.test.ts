import { describe, expect, it } from 'vitest'
import {
  AuthFlowError,
  describeError,
  ReauthRequiredError,
  TransientProviderError,
} from '../../src/main/infra/errors.ts'

const ACCOUNT_ID = 'alice@example.com'

describe('typed errors', () => {
  it('keeps the account id off the message, because messages are logged', () => {
    const reauth = new ReauthRequiredError(ACCOUNT_ID, 'invalid_grant')
    const transient = new TransientProviderError(ACCOUNT_ID, 503, 'request failed')

    expect(reauth.message).not.toContain(ACCOUNT_ID)
    expect(transient.message).not.toContain(ACCOUNT_ID)
    expect(describeError(reauth)).not.toContain(ACCOUNT_ID)
    expect(describeError(transient)).not.toContain(ACCOUNT_ID)
  })

  it('still carries the account id as a property, for callers that need it', () => {
    expect(new ReauthRequiredError(ACCOUNT_ID, 'revoked').accountId).toBe(ACCOUNT_ID)
  })

  it('keeps the reason and status, which are what a log is for', () => {
    expect(describeError(new ReauthRequiredError(ACCOUNT_ID, 'missing_scope'))).toContain(
      'missing_scope',
    )
    expect(
      describeError(new TransientProviderError(ACCOUNT_ID, 429, 'rate_limit_exceeded')),
    ).toContain('429')
  })
})

describe('describeError', () => {
  it('describes our own errors in full', () => {
    expect(describeError(new AuthFlowError('timeout'))).toBe(
      'AuthFlowError: sign-in failed (timeout)',
    )
  })

  it('reduces a foreign error to its class name', () => {
    // A Gaxios message is the response body verbatim when the body is not
    // JSON, so a captive portal or an intercepting proxy chooses it.
    const vendor = new Error('<html>attacker text\nforged log line</html>')
    vendor.name = 'GaxiosError'

    expect(describeError(vendor)).toBe('GaxiosError')
  })

  it('handles a thrown non-error', () => {
    expect(describeError('boom')).toBe('unknown error')
    expect(describeError(null)).toBe('unknown error')
  })
})
