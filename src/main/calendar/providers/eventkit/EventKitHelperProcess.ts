import { spawn as spawnChild } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import type { ZodType } from 'zod'
import { EventKitError } from '../../../infra/errors.ts'
import type { AppLogger } from '../../../infra/logger.ts'
import { Signal } from '../../../infra/Signal.ts'
import { EVENTKIT_REQUEST_TIMEOUT_MS, eventKitMessageSchema } from './EventKitProtocol.ts'

/**
 * One helper process shared by every EventKit account: one `EKEventStore` is
 * enough and the permission grant is per-app, not per-account.
 *
 * Spawning is lazy, so a Google-only user never starts it.
 */

export interface HelperChild {
  readonly stdout: Readable
  readonly stdin: Writable
  on(event: 'exit', listener: () => void): void
  kill(): void
}

export type HelperSpawn = (binaryPath: string) => HelperChild

/**
 * What consumers actually need. Keeps their tests free of process fakes.
 *
 * `timeoutMs` is per request rather than per process because one op —
 * `authorize` — waits on a human and the rest wait on a local store. It is
 * optional so only that call site has to think about it.
 */
export interface EventKitRequester {
  request<T>(
    op: string,
    payload: Record<string, unknown>,
    schema: ZodType<T>,
    timeoutMs?: number,
  ): Promise<T>
}

const RESTART_FLOOR_MS = 1_000
const RESTART_CAP_MS = 30_000

interface Pending {
  readonly settle: (result: unknown) => void
  readonly fail: (error: EventKitError) => void
  readonly timer: NodeJS.Timeout
}

export class EventKitHelperProcess implements EventKitRequester {
  readonly changed = new Signal<void>()

  private child: HelperChild | null = null
  private nextId = 1
  private restartDelayMs = 0
  private lastExitAt: number | null = null
  private readonly pending = new Map<number, Pending>()

  constructor(
    private readonly binaryPath: string,
    private readonly spawn: HelperSpawn,
    private readonly logger: AppLogger,
    private readonly timeoutMs: number = EVENTKIT_REQUEST_TIMEOUT_MS,
  ) {}

  async request<T>(
    op: string,
    payload: Record<string, unknown>,
    schema: ZodType<T>,
    timeoutMs: number = this.timeoutMs,
  ): Promise<T> {
    const child = this.ensureChild()
    const id = this.nextId++

    const raw = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new EventKitError('timeout'))
      }, timeoutMs)

      this.pending.set(id, { settle: resolve, fail: reject, timer })
      // Framing last: a payload carrying `id` must not take over correlation.
      child.stdin.write(`${JSON.stringify({ ...payload, id, op })}\n`)
    })

    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      throw new EventKitError('protocol')
    }
    return parsed.data
  }

  stop(): void {
    const child = this.child
    this.child = null
    this.failAll('helper_unavailable')
    child?.kill()
  }

  private ensureChild(): HelperChild {
    if (this.child) {
      return this.child
    }

    if (this.lastExitAt !== null && Date.now() - this.lastExitAt < this.restartDelayMs) {
      // A helper that dies on startup would otherwise be respawned once per
      // request, forever. Fail fast until the backoff has elapsed.
      throw new EventKitError('helper_unavailable')
    }

    const child = this.spawn(this.binaryPath)
    this.child = child

    // Per child, so bytes a dying one flushes late cannot splice into its
    // successor's frames and complete a line for an id it never served.
    let buffer = ''

    child.stdout.on('data', (chunk: Buffer | string) => {
      if (this.child !== child) {
        return
      }
      buffer = this.consume(buffer + String(chunk))
    })
    child.on('exit', () => {
      if (this.child !== child) {
        // A child we already replaced. Its exit says nothing about the one
        // now serving requests.
        return
      }
      // Dropped rather than restarted here: the next request respawns, so a
      // helper nobody is using does not loop forever.
      this.child = null
      this.lastExitAt = Date.now()
      this.restartDelayMs = Math.min(
        this.restartDelayMs === 0 ? RESTART_FLOOR_MS : this.restartDelayMs * 2,
        RESTART_CAP_MS,
      )
      // Not "exited": this runs for a spawn that never produced a process
      // and for a pipe that broke under a living one, as well as a real
      // exit. Why it went is logged where the reason exists, by the adapter.
      this.logger.warn('calendar helper is no longer available', {
        restartDelayMs: this.restartDelayMs,
      })
      this.failAll('helper_unavailable')
    })

    return child
  }

  /** Handles every whole line in `text` and returns the trailing partial one. */
  private consume(text: string): string {
    const lines = text.split('\n')
    const rest = lines.pop() ?? ''

    for (const line of lines) {
      if (line.trim().length === 0) {
        continue
      }
      this.handleLine(line)
    }
    return rest
  }

  private handleLine(line: string): void {
    let decoded: unknown
    try {
      decoded = JSON.parse(line)
    } catch {
      this.logger.warn('calendar helper sent a line that was not JSON')
      return
    }

    const message = eventKitMessageSchema.safeParse(decoded)
    if (!message.success) {
      this.logger.warn('calendar helper sent an unrecognised message')
      return
    }

    if ('event' in message.data) {
      this.restartDelayMs = 0
      this.changed.emit()
      return
    }

    const pending = this.pending.get(message.data.id)
    if (!pending) {
      return
    }
    this.pending.delete(message.data.id)
    clearTimeout(pending.timer)
    this.restartDelayMs = 0

    if (message.data.ok) {
      pending.settle(message.data.result)
      return
    }
    pending.fail(new EventKitError(message.data.error.kind))
  }

  private failAll(kind: 'helper_unavailable'): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      clearTimeout(pending.timer)
      pending.fail(new EventKitError(kind))
    }
  }
}

/*
 * stderr is untrusted input on a trust boundary, exactly as stdout is, and a
 * helper that spews must not grow the main process without limit. Two bounds:
 * one line, and how many lines a single child gets to contribute.
 *
 * The helper writes nothing to stderr itself — stdout is the protocol channel
 * and the only thing printed outside it is `--probe`, which goes to stdout
 * and exits — so everything that arrives here is the runtime: a dyld failure,
 * a Swift trap, a crash reporter preamble. Logged at warn for that reason,
 * and bounded because none of those choose their length.
 */

/** Long enough for a dyld line or a trap message; short of a whole backtrace. */
export const MAX_STDERR_LINE_LENGTH = 512

/** Enough to carry a cause, far short of letting a crash dump into the log. */
export const MAX_STDERR_LINES = 20

/**
 * The ceiling on a line that has not ended yet. Output with no newline in it
 * at all would otherwise be held whole, which is the unbounded growth the
 * per-line cap is there to stop.
 */
const MAX_STDERR_BUFFER = 4 * MAX_STDERR_LINE_LENGTH

interface StderrSink {
  /** Takes a chunk and logs whatever whole lines it completed. */
  readonly take: (chunk: Buffer | string) => void
  /** Logs a last line with no newline after it, which a crash often leaves. */
  readonly flush: () => void
}

function stderrSink(logger: AppLogger): StderrSink {
  let buffer = ''
  let logged = 0
  let capped = false

  const report = (raw: string): void => {
    const line = raw.trim()
    if (line.length === 0) {
      return
    }
    if (logged >= MAX_STDERR_LINES) {
      // Once, not once per line: the point of a cap is to stop writing.
      if (!capped) {
        capped = true
        logger.warn('calendar helper stderr capped', { lines: logged })
      }
      return
    }
    logged += 1
    logger.warn('calendar helper wrote to stderr', {
      line: line.slice(0, MAX_STDERR_LINE_LENGTH),
    })
  }

  return {
    take: (chunk) => {
      buffer += String(chunk)
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        report(line)
      }
      if (buffer.length > MAX_STDERR_BUFFER) {
        // A run with no newline anywhere in it. Report the bounded head and
        // drop the rest, rather than hold a line that may never end.
        report(buffer)
        buffer = ''
      }
    },
    flush: () => {
      const rest = buffer
      buffer = ''
      report(rest)
    },
  }
}

/** `errno` codes are diagnostics, not user data: ENOENT, EACCES, EPIPE. */
function errorCode(error: unknown): string | null {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  return null
}

/**
 * The real adapter, bound to a logger.
 *
 * The hazard it hardens is one: an `'error'` event with no listener is
 * rethrown as an uncaught exception, which in the main process is fatal. The
 * process emits one when a spawn fails (ENOENT, EACCES) and never exits; any
 * of the three pipes emits one when the helper dies with a write in flight
 * (EPIPE), which is the window between the OS closing the pipe and `'exit'`
 * being delivered. All of them mean the same thing to the class — the helper
 * is gone — so all of them travel the exit path, once.
 *
 * It is also where the diagnosis lives, because this is where the facts are:
 * the signal or code the child went with, and whatever it wrote to stderr on
 * the way.
 */
export function defaultHelperSpawn(logger: AppLogger): HelperSpawn {
  return (binaryPath) => {
    const child = spawnChild(binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    const { stdin, stdout, stderr } = child
    if (!stdout || !stdin || !stderr) {
      throw new EventKitError('helper_unavailable')
    }

    const stderrLog = stderrSink(logger)
    stderr.on('data', (chunk: Buffer | string) => {
      stderrLog.take(chunk)
    })

    const listeners: (() => void)[] = []
    let gone = false
    const reportGone = (): void => {
      if (gone) {
        return
      }
      gone = true
      // Killed, not merely dropped: a child whose pipe broke is unreachable
      // but still running, still holding an EKEventStore, and no longer the
      // one helper per app this class promises. Skipped when there is
      // nothing to signal — a spawn that failed, or a child already gone —
      // so the kill cannot raise an ESRCH of its own.
      const running =
        child.pid !== undefined && child.exitCode === null && child.signalCode === null
      if (running) {
        child.kill()
      }
      for (const listener of [...listeners]) {
        listener()
      }
    }

    // Attached now rather than when something subscribes, so the process
    // cannot be killed by a caller that spawns and does not listen.
    child.on('error', (error: unknown) => {
      logger.warn('calendar helper could not be started', { code: errorCode(error) })
      reportGone()
    })
    for (const [source, pipe] of [
      ['stdin', stdin],
      ['stdout', stdout],
      ['stderr', stderr],
    ] as const) {
      pipe.on('error', (error: unknown) => {
        logger.warn('calendar helper pipe failed', { source, code: errorCode(error) })
        reportGone()
      })
    }

    // Said here rather than in the class, which reaches its own gone-path for
    // causes where nothing exited and has no code or signal to report. A
    // signal is the whole diagnosis for an invalid code signature: the kernel
    // sends SIGKILL on spawn and nothing else happens.
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      stderrLog.flush()
      if (signal !== null) {
        logger.warn('calendar helper was killed', { signal })
      } else if (code !== 0) {
        logger.warn('calendar helper exited with a failure code', { code })
      } else {
        logger.info('calendar helper exited cleanly')
      }
      reportGone()
    })

    return {
      stdout,
      stdin,
      // Safe to queue rather than replay: every event above is asynchronous,
      // and the class subscribes synchronously on spawn.
      on: (_event, listener) => {
        listeners.push(listener)
      },
      kill: () => {
        child.kill()
      },
    }
  }
}
