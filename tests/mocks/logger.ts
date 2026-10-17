import type { AppLogger, LogContext } from '../../src/main/infra/logger.ts'

export function silentLogger(): AppLogger {
  const logger: AppLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  }
  return logger
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  readonly level: LogLevel
  readonly message: string
  readonly context: LogContext | undefined
}

/** For assertions about what an operator would see in the log. */
export function recordingLogger(entries: LogEntry[]): AppLogger {
  const record =
    (level: LogLevel) =>
    (message: string, context?: LogContext): void => {
      entries.push({ level, message, context })
    }
  const logger: AppLogger = {
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    child: () => logger,
  }
  return logger
}
