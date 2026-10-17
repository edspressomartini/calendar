import type { AppLogger } from '../../src/main/infra/logger.ts'

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
