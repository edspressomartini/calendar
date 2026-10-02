import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { AuthFlowError } from '../infra/errors.ts'
import type { AppLogger } from '../infra/logger.ts'

/**
 * One-shot OAuth callback listener (docs/spec.md §8.3).
 *
 * Binds to 127.0.0.1 on an OS-assigned port, answers exactly one
 * `GET /callback`, checks the Host header to block DNS rebinding, compares
 * `state` in constant time, and closes on success, error or timeout.
 */

const HOST = '127.0.0.1'
const CALLBACK_PATH = '/callback'
const TIMEOUT_MS = 5 * 60_000

/** Upper bound on shutdown; the sign-in result must not wait on a socket. */
const CLOSE_TIMEOUT_MS = 2_000

const SUCCESS_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Signed in</title></head>
<body style="font-family: system-ui; padding: 3rem; text-align: center">
<h1>Signed in</h1><p>You can close this tab and return to Up Next.</p>
</body></html>`

export class LoopbackServer {
  private settled = false
  private timeout: NodeJS.Timeout | null = null
  private resolveCode: ((code: string) => void) | null = null
  private rejectCode: ((error: Error) => void) | null = null

  private constructor(
    private readonly server: Server,
    readonly port: number,
    private readonly expectedState: string,
    private readonly logger: AppLogger,
  ) {
    this.server.on('request', (request, response) => {
      this.handle(request, response)
    })
  }

  static async start(expectedState: string, logger: AppLogger): Promise<LoopbackServer> {
    const server = createServer()

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      // Port 0 asks the OS for a free ephemeral port.
      server.listen(0, HOST, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })

    const address = server.address() as AddressInfo | null
    if (!address) {
      server.close()
      throw new AuthFlowError('exchange_failed', 'loopback server did not bind')
    }

    return new LoopbackServer(server, address.port, expectedState, logger)
  }

  get redirectUri(): string {
    return `http://${HOST}:${this.port}${CALLBACK_PATH}`
  }

  waitForCode(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.resolveCode = resolve
      this.rejectCode = reject
      this.timeout = setTimeout(() => {
        this.fail(new AuthFlowError('timeout'))
      }, TIMEOUT_MS)
    })
  }

  /**
   * Shutting the listener down must never be able to block sign-in. The
   * browser holds the callback socket open with keep-alive and
   * `server.close()` waits for every connection to end, so connections are
   * dropped explicitly and the wait is bounded.
   */
  async close(): Promise<void> {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }

    this.server.closeAllConnections()

    const closed = new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve()
      })
    })
    const bounded = new Promise<void>((resolve) => {
      setTimeout(resolve, CLOSE_TIMEOUT_MS).unref()
    })

    await Promise.race([closed, bounded])
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    if (request.method !== 'GET') {
      this.respondNotFound(response)
      return
    }
    if (!this.hasExpectedHost(request)) {
      this.logger.warn('rejected loopback request with unexpected Host header')
      this.respondNotFound(response)
      return
    }

    const url = new URL(request.url ?? '/', this.redirectUri)
    if (url.pathname !== CALLBACK_PATH) {
      this.respondNotFound(response)
      return
    }

    const error = url.searchParams.get('error')
    if (error) {
      this.respondNotFound(response)
      this.fail(new AuthFlowError('denied'))
      return
    }

    const state = url.searchParams.get('state') ?? ''
    if (!this.isExpectedState(state)) {
      this.logger.warn('rejected loopback callback with mismatched state')
      this.respondNotFound(response)
      this.fail(new AuthFlowError('state_mismatch'))
      return
    }

    const code = url.searchParams.get('code') ?? ''
    if (code.length === 0) {
      this.respondNotFound(response)
      this.fail(new AuthFlowError('exchange_failed', 'callback carried no code'))
      return
    }

    // A static page: nothing from the request is echoed back.
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    })
    response.end(SUCCESS_PAGE)
    this.succeed(code)
  }

  /** Only `127.0.0.1:<our port>` is acceptable; `localhost` can be rebound. */
  private hasExpectedHost(request: IncomingMessage): boolean {
    return request.headers.host === `${HOST}:${this.port}`
  }

  /** Hashes first so the comparison is constant time even for unequal lengths. */
  private isExpectedState(candidate: string): boolean {
    const expected = createHash('sha256').update(this.expectedState).digest()
    const received = createHash('sha256').update(candidate).digest()
    return timingSafeEqual(expected, received)
  }

  private respondNotFound(response: ServerResponse): void {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
  }

  private succeed(code: string): void {
    if (this.settled) {
      return
    }
    this.settled = true
    this.resolveCode?.(code)
  }

  private fail(error: Error): void {
    if (this.settled) {
      return
    }
    this.settled = true
    this.rejectCode?.(error)
  }
}
