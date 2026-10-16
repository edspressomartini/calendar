import { ReauthRequiredError, TransientProviderError } from '../../../infra/errors.ts'

/**
 * Maps vendor failures to our two typed errors at the provider boundary
 * (docs/spec.md §3, §8.7).
 *
 * This is also a security boundary: Google client errors carry the request
 * config, including the `Authorization: Bearer …` header. Nothing from the raw
 * error object escapes this file.
 */

interface ErrorLikeResponse {
  readonly status?: unknown
  readonly data?: { readonly error?: unknown; readonly error_description?: unknown }
}

interface ErrorLike {
  readonly status?: unknown
  readonly code?: unknown
  readonly message?: unknown
  readonly response?: ErrorLikeResponse
}

const RETRYABLE_NETWORK_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'ERR_NETWORK',
  'ECONNABORTED',
])

export function mapGoogleError(error: unknown, accountId: string): Error {
  const details = readError(error)

  if (isInvalidGrant(details)) {
    return new ReauthRequiredError(accountId, 'invalid_grant')
  }

  const status = details.status
  if (status === 401) {
    return new ReauthRequiredError(accountId, 'invalid_grant')
  }
  if (status === 403 && details.reason === 'insufficient_permissions') {
    return new ReauthRequiredError(accountId, 'missing_scope')
  }
  if (status !== null && status >= 400 && status < 500 && status !== 429 && status !== 408) {
    // A genuine client bug: surface it rather than retrying forever.
    return new TransientProviderError(accountId, status, 'request rejected')
  }

  return new TransientProviderError(accountId, status, details.reason ?? 'request failed')
}

function isInvalidGrant(details: { reason: string | null }): boolean {
  return details.reason === 'invalid_grant'
}

function readError(error: unknown): { status: number | null; reason: string | null } {
  if (typeof error !== 'object' || error === null) {
    return { status: null, reason: null }
  }

  const candidate = error as ErrorLike
  const status = readStatus(candidate)
  const reason = readReason(candidate)
  return { status, reason }
}

function readStatus(candidate: ErrorLike): number | null {
  if (typeof candidate.status === 'number') {
    return candidate.status
  }
  if (typeof candidate.response?.status === 'number') {
    return candidate.response.status
  }
  return null
}

/**
 * The `error` field of an OAuth or Calendar failure. Anything outside this set
 * is vendor-chosen text that would end up in a log line, so it is collapsed.
 */
const KNOWN_PAYLOAD_ERRORS: ReadonlySet<string> = new Set([
  'invalid_grant',
  'invalid_request',
  'invalid_client',
  'invalid_scope',
  'unauthorized_client',
  'unsupported_grant_type',
  'access_denied',
  'rate_limit_exceeded',
  'insufficient_permissions',
])

function readReason(candidate: ErrorLike): string | null {
  const payloadError = candidate.response?.data?.error
  if (typeof payloadError === 'string') {
    return KNOWN_PAYLOAD_ERRORS.has(payloadError) ? payloadError : 'request failed'
  }
  if (typeof candidate.code === 'string') {
    return RETRYABLE_NETWORK_CODES.has(candidate.code) ? candidate.code : 'request failed'
  }
  if (typeof candidate.message === 'string' && candidate.message.includes('invalid_grant')) {
    return 'invalid_grant'
  }
  return null
}
