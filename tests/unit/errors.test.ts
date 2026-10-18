import { describe, expect, it } from 'vitest'
import {
  AuthFlowError,
  connectProblemFor,
  describeError,
  EventKitError,
  isCalendarAccessRefusal,
  isEventKitError,
  ReauthRequiredError,
  TransientProviderError,
} from '../../src/main/infra/errors.ts'
import { CALENDAR_ACCESS_REFUSALS, CONNECT_PROBLEMS } from '../../src/shared/constants.ts'

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

describe('EventKitError', () => {
  it('describes itself without leaking anything beyond the kind', () => {
    const error = new EventKitError('denied')
    expect(describeError(error)).toBe('EventKitError: calendar access failed (denied)')
  })

  it('is recognised by its guard', () => {
    expect(isEventKitError(new EventKitError('timeout'))).toBe(true)
    expect(isEventKitError(new Error('timeout'))).toBe(false)
  })
})

describe('calendar access classification', () => {
  it.each(CALENDAR_ACCESS_REFUSALS)('counts %s as a refusal', (kind) => {
    expect(isCalendarAccessRefusal(new EventKitError(kind))).toBe(true)
  })

  /**
   * The decision this test exists to pin. A prompt that could not be shown
   * stops a connect attempt dead, so it is reported; but no System Settings
   * toggle changes it, so offering the privacy pane would be the same false
   * explanation in a new costume.
   */
  it('counts a prompt that could not be shown as a problem but not a refusal', () => {
    const error = new EventKitError('promptUnavailable')

    expect(connectProblemFor(error)).toBe('promptUnavailable')
    expect(isCalendarAccessRefusal(error)).toBe(false)
  })

  it.each(['helper_unavailable', 'timeout', 'protocol'] as const)(
    'counts %s as no refusal, whatever else it is',
    (kind) => {
      expect(isCalendarAccessRefusal(new EventKitError(kind))).toBe(false)
    },
  )
})

/**
 * One generic sentence stood in for four unrelated failures with four
 * different fixes, so every kind now names the one thing the pane should say.
 * The map is keyed on the error's own union, so a new kind will not compile
 * until someone has decided what the user is told.
 */
describe('connectProblemFor', () => {
  it.each([
    ['denied', 'denied'],
    ['restricted', 'restricted'],
    ['writeOnly', 'writeOnly'],
    ['promptUnavailable', 'promptUnavailable'],
    ['helper_unavailable', 'helperUnavailable'],
    ['timeout', 'timedOut'],
    ['store_failure', 'storeUnreadable'],
  ] as const)('reports %s as %s', (kind, problem) => {
    expect(connectProblemFor(new EventKitError(kind))).toBe(problem)
  })

  /**
   * Merged on purpose: a reply we cannot parse, a request the helper refused
   * as malformed, and a source it has never heard of are all one thing to the
   * user — the two halves of the app disagree — and all have the same fix.
   */
  it.each(['protocol', 'bad_request', 'unknown_source'] as const)(
    'merges %s into one mismatch the user can act on',
    (kind) => {
      expect(connectProblemFor(new EventKitError(kind))).toBe('helperMismatch')
    },
  )

  it('never reports a problem outside the list the contract validates', () => {
    const kinds = [
      'denied',
      'restricted',
      'writeOnly',
      'promptUnavailable',
      'helper_unavailable',
      'timeout',
      'protocol',
      'bad_request',
      'unknown_source',
      'store_failure',
    ] as const

    for (const kind of kinds) {
      expect(CONNECT_PROBLEMS).toContain(connectProblemFor(new EventKitError(kind)))
    }
  })

  /** Google's failures are not EventKit errors and must keep behaving as they do. */
  it('claims nothing about an error from another provider', () => {
    expect(connectProblemFor(new AuthFlowError('exchange_failed'))).toBeNull()
    expect(connectProblemFor(new ReauthRequiredError(ACCOUNT_ID, 'invalid_grant'))).toBeNull()
    expect(connectProblemFor(new Error('boom'))).toBeNull()
    expect(connectProblemFor('boom')).toBeNull()
  })
})
