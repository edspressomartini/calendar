import { beforeEach, describe, expect, it } from 'vitest'
import { AuthFlowError } from '../../src/main/infra/errors.ts'
import { IpcRouter } from '../../src/main/ipc/IpcRouter.ts'
import { CHANNELS } from '../../src/shared/ipc/channels.ts'
import type { AppLogger, LogContext } from '../../src/main/infra/logger.ts'
import { invokeIpc, resetElectronMock } from '../mocks/electron.ts'

/**
 * The three gates every inbound message passes (docs/spec.md §8.5): the sender
 * is one of our windows and allowed on the channel, the payload matches the
 * schema, and side-effecting channels are not being hammered.
 */

const WIDGET = 'app://widget/index.html'
const SETTINGS = 'app://settings/index.html'

interface CapturedLog {
  readonly level: string
  readonly message: string
  readonly context: LogContext | undefined
}

function createLogger(captured: CapturedLog[]): AppLogger {
  const record =
    (level: string) =>
    (message: string, context?: LogContext): void => {
      captured.push({ level, message, context })
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

let logs: CapturedLog[]
let now: number

function createRouter(devServerOrigin: string | null = null): IpcRouter {
  return new IpcRouter(devServerOrigin, createLogger(logs), () => now)
}

beforeEach(() => {
  resetElectronMock()
  logs = []
  now = 1_000_000
})

describe('IpcRouter sender checks', () => {
  it('passes a valid message from the right window to the handler', async () => {
    const router = createRouter()
    router.handle(CHANNELS.agendaJoin, (payload) => `joined:${payload.eventId}`)

    const result = await invokeIpc(CHANNELS.agendaJoin, WIDGET, { eventId: 'evt-1' })

    expect(result).toBe('joined:evt-1')
  })

  it('drops a message from an unrecognised sender', async () => {
    const router = createRouter()
    let called = false
    router.handle(CHANNELS.agendaJoin, () => {
      called = true
    })

    await expect(
      invokeIpc(CHANNELS.agendaJoin, 'https://evil.example/', { eventId: 'evt-1' }),
    ).rejects.toThrow('request rejected')
    expect(called).toBe(false)
  })

  it('drops a message with no sender frame at all', async () => {
    const router = createRouter()
    router.handle(CHANNELS.agendaJoin, () => 'ok')

    await expect(invokeIpc(CHANNELS.agendaJoin, null, { eventId: 'e' })).rejects.toThrow(
      'request rejected',
    )
  })

  it('stops one window reaching another window channel', async () => {
    const router = createRouter()
    let called = false
    router.handle(CHANNELS.accountsDisconnect, () => {
      called = true
    })

    // accounts:disconnect belongs to the settings window, not the widget.
    await expect(
      invokeIpc(CHANNELS.accountsDisconnect, WIDGET, { accountId: 'acc' }),
    ).rejects.toThrow('request rejected')
    expect(called).toBe(false)
  })

  it('accepts the settings window on its own channels', async () => {
    const router = createRouter()
    router.handle(CHANNELS.accountsDisconnect, (payload) => payload.accountId)

    await expect(
      invokeIpc(CHANNELS.accountsDisconnect, SETTINGS, { accountId: 'acc' }),
    ).resolves.toBe('acc')
  })
})

describe('IpcRouter payload validation', () => {
  it('rejects a payload that fails the schema', async () => {
    const router = createRouter()
    let called = false
    router.handle(CHANNELS.agendaJoin, () => {
      called = true
    })

    await expect(invokeIpc(CHANNELS.agendaJoin, WIDGET, { eventId: 42 })).rejects.toThrow(
      'request rejected',
    )
    expect(called).toBe(false)
  })

  it('rejects unexpected extra properties', async () => {
    const router = createRouter()
    router.handle(CHANNELS.agendaJoin, () => 'ok')

    await expect(
      invokeIpc(CHANNELS.agendaJoin, WIDGET, { eventId: 'e', admin: true }),
    ).rejects.toThrow('request rejected')
  })

  it('never logs the payload it rejected', async () => {
    const router = createRouter()
    router.handle(CHANNELS.agendaJoin, () => 'ok')

    // Rejected for the extra property; the point is what reaches the log.
    await expect(
      invokeIpc(CHANNELS.agendaJoin, WIDGET, {
        eventId: 'evt',
        stolen: 'super-secret-value',
      }),
    ).rejects.toThrow('request rejected')

    expect(logs.some((entry) => entry.level === 'warn')).toBe(true)
    expect(JSON.stringify(logs)).not.toContain('super-secret-value')
  })
})

describe('IpcRouter rate limiting', () => {
  it('ignores a repeat of a side-effecting channel within the window', async () => {
    const router = createRouter()
    let calls = 0
    router.handle(CHANNELS.agendaJoin, () => {
      calls += 1
    })

    await invokeIpc(CHANNELS.agendaJoin, WIDGET, { eventId: 'e' })
    await expect(invokeIpc(CHANNELS.agendaJoin, WIDGET, { eventId: 'e' })).rejects.toThrow(
      'request rejected',
    )
    expect(calls).toBe(1)
  })

  it('allows the call again once the window has passed', async () => {
    const router = createRouter()
    let calls = 0
    router.handle(CHANNELS.agendaJoin, () => {
      calls += 1
    })

    await invokeIpc(CHANNELS.agendaJoin, WIDGET, { eventId: 'e' })
    now += 1_001
    await invokeIpc(CHANNELS.agendaJoin, WIDGET, { eventId: 'e' })

    expect(calls).toBe(2)
  })

  it('does not rate limit read-only channels', async () => {
    const router = createRouter()
    let calls = 0
    router.handle(CHANNELS.accountsList, () => {
      calls += 1
    })

    await invokeIpc(CHANNELS.accountsList, SETTINGS)
    await invokeIpc(CHANNELS.accountsList, SETTINGS)

    expect(calls).toBe(2)
  })
})

describe('IpcRouter error handling', () => {
  it('hands the renderer a fixed message when a handler throws', async () => {
    const router = createRouter()
    router.handle(CHANNELS.agendaJoin, () => {
      throw new Error('connection string postgres://user:hunter2@db/internal')
    })

    await expect(invokeIpc(CHANNELS.agendaJoin, WIDGET, { eventId: 'e' })).rejects.toThrow(
      'request rejected',
    )
  })

  it('keeps the reason for one of our own errors in the log, not the response', async () => {
    const router = createRouter()
    router.handle(CHANNELS.agendaJoin, () => {
      throw new AuthFlowError('timeout')
    })

    await expect(invokeIpc(CHANNELS.agendaJoin, WIDGET, { eventId: 'e' })).rejects.toThrow(
      'request rejected',
    )
    expect(JSON.stringify(logs)).toContain('timeout')
  })

  it('logs only the class name of an error we did not write', async () => {
    const router = createRouter()
    router.handle(CHANNELS.agendaJoin, () => {
      // A vendor message can be the raw response body, which an intercepting
      // proxy chooses, and the log file is line-oriented.
      throw new Error('connection string postgres://user:hunter2@db/internal')
    })

    await expect(invokeIpc(CHANNELS.agendaJoin, WIDGET, { eventId: 'e' })).rejects.toThrow(
      'request rejected',
    )
    expect(JSON.stringify(logs)).not.toContain('hunter2')
  })
})

describe('IpcRouter dev server', () => {
  it('accepts the dev server origin only when one is configured', async () => {
    const devOrigin = 'http://localhost:5173'
    const router = createRouter(devOrigin)
    router.handle(CHANNELS.agendaJoin, () => 'ok')

    await expect(
      invokeIpc(CHANNELS.agendaJoin, `${devOrigin}/widget/index.html`, { eventId: 'e' }),
    ).resolves.toBe('ok')
  })

  it('refuses the dev server in a production build', async () => {
    const router = createRouter(null)
    router.handle(CHANNELS.agendaJoin, () => 'ok')

    await expect(
      invokeIpc(CHANNELS.agendaJoin, 'http://localhost:5173/widget/index.html', { eventId: 'e' }),
    ).rejects.toThrow('request rejected')
  })
})
