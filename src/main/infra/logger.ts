import log from 'electron-log/main'
import { describeError } from './errors.ts'

/**
 * Structured, redacting logger (docs/spec.md §8.7).
 *
 * Two rules the type system enforces as far as it can: contexts carry scalars
 * only, and callers pass counts and IDs — never event titles, descriptions,
 * attendees or links.
 */

export type LogValue = string | number | boolean | null | undefined

export type LogContext = Readonly<Record<string, LogValue>>

export interface AppLogger {
  debug(message: string, context?: LogContext): void
  info(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
  error(message: string, context?: LogContext): void
  child(scope: string): AppLogger
}

/**
 * Exact keys, not a regex. v2 matched /code/i, which also redacted `statusCode`
 * — the one field worth logging.
 */
const REDACTED_KEYS: ReadonlySet<string> = new Set([
  'access_token',
  'refresh_token',
  'id_token',
  'code',
  'code_verifier',
  'client_secret',
  'client_id',
  'authorization',
  'credentials',
  'headers',
  'tokens',
])

const REDACTED = '[redacted]'
const MAX_DEPTH = 4
const LOG_MAX_SIZE_BYTES = 5 * 1024 * 1024

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) {
    return '[truncated]'
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, depth + 1))
  }
  if (value instanceof Error) {
    return describeError(value)
  }

  const source = value as Readonly<Record<string, unknown>>
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(source)) {
    result[key] = REDACTED_KEYS.has(key.toLowerCase()) ? REDACTED : redactValue(entry, depth + 1)
  }
  return result
}

class ElectronAppLogger implements AppLogger {
  constructor(private readonly scope: string) {}

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context)
  }

  info(message: string, context?: LogContext): void {
    this.write('info', message, context)
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context)
  }

  error(message: string, context?: LogContext): void {
    this.write('error', message, context)
  }

  child(scope: string): AppLogger {
    return new ElectronAppLogger(`${this.scope}.${scope}`)
  }

  private write(level: 'debug' | 'info' | 'warn' | 'error', message: string, context?: LogContext) {
    const line = { scope: this.scope, message, ...(context ?? {}) }
    log[level](line)
  }
}

let initialised = false

export function initialiseLogging(isDev: boolean): void {
  if (initialised) {
    return
  }
  initialised = true

  log.initialize()
  log.transports.file.maxSize = LOG_MAX_SIZE_BYTES
  log.transports.file.level = 'info'
  log.transports.console.level = isDev ? 'debug' : false

  // Last line of defence: nothing reaches a transport unredacted.
  log.hooks.push((message) => ({
    ...message,
    data: message.data.map((entry) => redactValue(entry)),
  }))
}

export function createLogger(scope: string): AppLogger {
  return new ElectronAppLogger(scope)
}
