/**
 * Typed errors say what to do, not what went wrong inside a vendor SDK
 * (docs/spec.md §3). Vendor errors are mapped at the provider boundary so raw
 * HTTP errors — which carry Authorization headers — never travel (§8.7).
 */

import type { EventKitErrorKind } from '../calendar/providers/eventkit/EventKitProtocol.ts'
import type { CALENDAR_PROMPT_UNAVAILABLE } from '../../shared/constants.ts'
import { CALENDAR_ACCESS_PROBLEMS, CALENDAR_ACCESS_REFUSALS } from '../../shared/constants.ts'
import type { CalendarAccessProblem, CalendarAccessRefusal } from '../../shared/types/account.ts'

export abstract class AppError extends Error {
  protected constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/**
 * The refresh token is dead or a required scope is missing. Stop syncing.
 *
 * The account id is an email address, so it is a property rather than part of
 * the message: messages are logged, properties are not (§8.7).
 */
export class ReauthRequiredError extends AppError {
  constructor(
    readonly accountId: string,
    readonly reason: 'invalid_grant' | 'missing_scope' | 'revoked',
  ) {
    super(`account needs re-authentication (${reason})`)
  }
}

/** Network failure, timeout, 429 or 5xx. Keep last-known events and retry. */
export class TransientProviderError extends AppError {
  constructor(
    readonly accountId: string,
    readonly statusCode: number | null,
    detail: string,
  ) {
    super(`temporary provider failure (${statusCode ?? 'no status'}): ${detail}`)
  }
}

/** The sign-in flow could not be completed. */
export class AuthFlowError extends AppError {
  constructor(
    readonly reason:
      'state_mismatch' | 'timeout' | 'denied' | 'bad_host' | 'exchange_failed' | 'no_refresh_token',
    detail?: string,
  ) {
    super(detail ? `sign-in failed (${reason}): ${detail}` : `sign-in failed (${reason})`)
  }
}

/**
 * The macOS calendar store could not be read. `denied`, `restricted` and
 * `writeOnly` are terminal until the user changes a System Settings toggle,
 * and `promptUnavailable` is terminal until the app is reinstalled; the rest
 * are worth retrying.
 *
 * `promptUnavailable` comes from an `authorize` reply rather than a helper
 * error frame, which is why it is listed here and not in `errorKindSchema`.
 */
export class EventKitError extends AppError {
  constructor(
    readonly kind:
      | EventKitErrorKind
      | typeof CALENDAR_PROMPT_UNAVAILABLE
      | 'helper_unavailable'
      | 'timeout'
      | 'protocol',
  ) {
    super(`calendar access failed (${kind})`)
  }
}

/** OS-level encryption is unavailable, so no token may be written (§8.2). */
export class SecureStorageUnavailableError extends AppError {
  constructor() {
    super('macOS secure storage is unavailable; refusing to store credentials')
  }
}

export class IpcValidationError extends AppError {
  constructor(
    readonly channel: string,
    detail: string,
  ) {
    super(`rejected IPC message on ${channel}: ${detail}`)
  }
}

export function isReauthRequired(error: unknown): error is ReauthRequiredError {
  return error instanceof ReauthRequiredError
}

export function isTransient(error: unknown): error is TransientProviderError {
  return error instanceof TransientProviderError
}

export function isEventKitError(error: unknown): error is EventKitError {
  return error instanceof EventKitError
}

/** Typed against the error's own union, so a member that is not an EventKit
 * kind will not compile. */
const REFUSED_KINDS: ReadonlySet<EventKitError['kind']> = new Set<EventKitError['kind']>(
  CALENDAR_ACCESS_REFUSALS,
)

const PROBLEM_KINDS: ReadonlySet<EventKitError['kind']> = new Set<EventKitError['kind']>(
  CALENDAR_ACCESS_PROBLEMS,
)

/**
 * Refused, restricted by policy, or granted write-only. Both the sync path
 * and the sign-in path ask this question, and must answer it the same way:
 * retrying any of the three would only spin until a System Settings toggle
 * changes (§7).
 *
 * `promptUnavailable` is not one of them, on purpose. It is just as terminal,
 * but no toggle exists to change it, so the System Settings button this
 * question gates would be an instruction the user cannot carry out.
 */
export function isCalendarAccessRefusal(
  error: unknown,
): error is EventKitError & { readonly kind: CalendarAccessRefusal } {
  return isEventKitError(error) && REFUSED_KINDS.has(error.kind)
}

/**
 * The wider question the sign-in path asks: did macOS hand over nothing for a
 * reason the Accounts pane can state? A refusal, or a build that could not put
 * the prompt on screen at all.
 */
export function isCalendarAccessProblem(
  error: unknown,
): error is EventKitError & { readonly kind: CalendarAccessProblem } {
  return isEventKitError(error) && PROBLEM_KINDS.has(error.kind)
}

/**
 * Safe to log (§8.7).
 *
 * Our own errors carry messages we wrote, so they travel whole. Anything else
 * contributes its class name and nothing more: a `GaxiosError` message is the
 * response body verbatim when the body is not JSON, which a captive portal or
 * an intercepting proxy can choose. Key-based redaction cannot catch that,
 * because by then it is one free-text string.
 */
export function describeError(error: unknown): string {
  if (error instanceof AppError) {
    return `${error.name}: ${error.message}`
  }
  if (error instanceof Error) {
    return error.name
  }
  return 'unknown error'
}
