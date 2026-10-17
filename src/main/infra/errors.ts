/**
 * Typed errors say what to do, not what went wrong inside a vendor SDK
 * (docs/spec.md §3). Vendor errors are mapped at the provider boundary so raw
 * HTTP errors — which carry Authorization headers — never travel (§8.7).
 */

import type { EventKitErrorKind } from '../calendar/providers/eventkit/EventKitProtocol.ts'

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
 * `writeOnly` are terminal until the user changes a System Settings toggle;
 * the rest are worth retrying.
 */
export class EventKitError extends AppError {
  constructor(readonly kind: EventKitErrorKind | 'helper_unavailable' | 'timeout' | 'protocol') {
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
