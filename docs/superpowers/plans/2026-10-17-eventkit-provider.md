# EventKit Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read calendars from the macOS calendar store so iCloud, Exchange, Microsoft 365 and CalDAV accounts work, without OAuth and without a network connection.

**Architecture:** A bundled Swift binary owns the only `EKEventStore` and speaks newline-delimited JSON over stdio. A `CalendarProvider` implementation per `EKSource` talks to it through one shared, lazily spawned process wrapper. Everything above the provider seam — `AgendaService`, `EventAggregator`, the renderer — is unchanged.

**Tech Stack:** Swift 5.9 / SwiftPM / EventKit, TypeScript 6, Zod 4, Vitest 5, electron-builder 26.

**Design:** `docs/superpowers/specs/2026-10-17-eventkit-provider-design.md`

## Global Constraints

- Minimum macOS is **14.0 (Sonoma)**, raised from Ventura. Applies to `LSMinimumSystemVersion`, SwiftPM `platforms`, the README and the Homebrew cask.
- Apple silicon only (`arm64`), unchanged.
- No `any`, no `as unknown as`, no `@ts-ignore`, no non-null `!`. `strict: true` throughout.
- Every message crossing the helper boundary is validated by a Zod schema before use, exactly as IPC messages are (`docs/spec.md` §8.5).
- No email address, event title, note body or location ever reaches a log (`docs/spec.md` §8.7). Log counts and enum values only.
- `AccountId` for an EventKit account is `eventkit:<sourceIdentifier>`.
- Run `npm run check` before every commit. Commits are conventional (`feat:`, `fix:`, `test:`, `chore:`, `docs:`).
- The compiled helper lives in `build/helper/up-next-eventkit` and is **never committed**.

## File Structure

**Created:**

| Path                                                                   | Responsibility                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| `src/main/calendar/providers/eventkit/EventKitProtocol.ts`             | Zod schemas and types for every helper message.             |
| `src/main/calendar/providers/eventkit/EventKitHelperProcess.ts`        | Spawn, correlate, time out, restart, publish change pushes. |
| `src/main/calendar/providers/eventkit/eventKitEventMapper.ts`          | Helper JSON to `CalendarEvent`.                             |
| `src/main/calendar/providers/eventkit/EventKitProvider.ts`             | `CalendarProvider` for one source.                          |
| `src/main/calendar/providers/eventkit/EventKitAuthorizer.ts`           | `AccountAuthenticator`: prompt, then enumerate sources.     |
| `src/main/calendar/providers/eventkit/helperPath.ts`                   | Where the binary lives, packaged and in dev.                |
| `resources/eventkit-helper/Package.swift`                              | SwiftPM manifest.                                           |
| `resources/eventkit-helper/Sources/UpNextEventKit/main.swift`          | Entry point, stdio loop, change observer.                   |
| `resources/eventkit-helper/Sources/UpNextEventKit/Protocol.swift`      | Codable request/response types.                             |
| `resources/eventkit-helper/Sources/UpNextEventKit/Store.swift`         | EventKit reads and the pure date helpers.                   |
| `resources/eventkit-helper/Tests/UpNextEventKitTests/StoreTests.swift` | Swift tests for date handling.                              |
| `scripts/build-helper.sh`                                              | `swift build` plus copy into `build/helper/`.               |

**Modified:** `src/shared/types/calendar.ts`, `src/shared/ipc/contract.ts`, `src/shared/ipc/bridge.ts`, `src/preload/index.ts`, `src/main/ipc/handlers/accountHandlers.ts`, `src/main/calendar/CalendarProvider.ts`, `src/main/calendar/ProviderFactory.ts`, `src/main/calendar/AccountService.ts`, `src/main/calendar/providers/google/GoogleAuthClient.ts`, `src/main/infra/errors.ts`, `src/main/sync/SyncScheduler.ts`, `src/main/bootstrap.ts`, `src/renderer/common/hooks/useAccounts.ts`, `src/renderer/settings/views/AccountsView.tsx`, `package.json`, `electron-builder.yml`, `build/entitlements.mac.plist`, `build/entitlements.adhoc.plist`, `.gitignore`, `README.md`, `docs/spec.md`.

---

### Task 1: The helper protocol

**Files:**

- Create: `src/main/calendar/providers/eventkit/EventKitProtocol.ts`
- Test: `tests/unit/eventKitProtocol.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `eventKitSourceSchema`, `eventKitCalendarSchema`, `eventKitEventSchema`, `eventKitAuthorizationSchema`, `eventKitMessageSchema`, `EVENTKIT_REQUEST_TIMEOUT_MS`, and types `EventKitSource`, `EventKitCalendar`, `EventKitEvent`, `EventKitAuthorization`, `EventKitMessage`, `EventKitErrorKind`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/eventKitProtocol.test.ts
import { describe, expect, it } from 'vitest'
import {
  eventKitEventSchema,
  eventKitMessageSchema,
} from '../../src/main/calendar/providers/eventkit/EventKitProtocol.ts'

const event = {
  id: 'ABC-123',
  calendarId: 'cal-1',
  externalId: 'uid@icloud.com',
  title: 'Standup',
  start: '2026-10-17T09:00:00+01:00',
  end: '2026-10-17T09:15:00+01:00',
  isAllDay: false,
  url: null,
  location: null,
  notes: null,
  status: 'confirmed',
  selfDeclined: false,
}

describe('eventKitEventSchema', () => {
  it('accepts a well-formed event', () => {
    expect(eventKitEventSchema.parse(event)).toEqual(event)
  })

  it('rejects an unknown field, so a helper change cannot pass silently', () => {
    expect(eventKitEventSchema.safeParse({ ...event, attendees: [] }).success).toBe(false)
  })

  it('accepts a title longer than the display cap, which the mapper truncates', () => {
    const long = { ...event, title: 'x'.repeat(201) }
    expect(eventKitEventSchema.safeParse(long).success).toBe(true)
  })

  it('rejects a title beyond the ingest bound', () => {
    const absurd = { ...event, title: 'x'.repeat(4_001) }
    expect(eventKitEventSchema.safeParse(absurd).success).toBe(false)
  })

  it('accepts a calendar title longer than the display cap', () => {
    const calendar = { id: 'cal-1', title: 'x'.repeat(201), isDefault: false }
    expect(eventKitCalendarSchema.safeParse(calendar).success).toBe(true)
  })
})

describe('eventKitMessageSchema', () => {
  it('reads a successful reply', () => {
    const parsed = eventKitMessageSchema.parse({ id: 7, ok: true, result: { status: 'granted' } })
    expect(parsed).toEqual({ id: 7, ok: true, result: { status: 'granted' } })
  })

  it('reads a failed reply', () => {
    const parsed = eventKitMessageSchema.parse({ id: 7, ok: false, error: { kind: 'denied' } })
    expect(parsed.ok).toBe(false)
  })

  it('reads a change push, which carries no id', () => {
    expect(eventKitMessageSchema.parse({ event: 'changed' })).toEqual({ event: 'changed' })
  })

  it('rejects a reply that is neither ok nor an error', () => {
    expect(eventKitMessageSchema.safeParse({ id: 7 }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/unit/eventKitProtocol.test.ts`
Expected: FAIL, "Failed to resolve import ... EventKitProtocol.ts".

- [ ] **Step 3: Write the implementation**

```typescript
// src/main/calendar/providers/eventkit/EventKitProtocol.ts
import { z } from 'zod'
/**
 * The helper is a separate process and therefore a trust boundary: nothing it
 * sends is used before it is parsed, for the same reason nothing from the
 * renderer is (docs/spec.md §8.5).
 */

export const EVENTKIT_REQUEST_TIMEOUT_MS = 10_000

const MAX_TEXT_LENGTH = 4_000

const identifier = z.string().min(1).max(512)

export const eventKitSourceSchema = z.strictObject({
  id: identifier,
  title: z.string().min(1).max(120),
  defaultCalendarId: identifier.nullable(),
})

export const eventKitCalendarSchema = z.strictObject({
  id: identifier,
  // Same reasoning as the event title below: bounded generously so one long
  // calendar name cannot fail the whole list.
  title: z.string().max(MAX_TEXT_LENGTH),
  isDefault: z.boolean(),
})

export const eventKitEventSchema = z.strictObject({
  id: identifier,
  calendarId: identifier,
  externalId: z.string().max(512),
  // Bounded generously, not at the display cap: one over-long title must not
  // fail the whole array and cost the user their agenda. The mapper truncates
  // to MAX_EVENT_TITLE_LENGTH, as the Google path does.
  title: z.string().max(MAX_TEXT_LENGTH),
  start: z.string().min(1).max(40),
  end: z.string().min(1).max(40),
  isAllDay: z.boolean(),
  url: z.string().max(2_048).nullable(),
  location: z.string().max(MAX_TEXT_LENGTH).nullable(),
  notes: z.string().max(MAX_TEXT_LENGTH).nullable(),
  status: z.enum(['none', 'confirmed', 'tentative', 'cancelled']),
  selfDeclined: z.boolean(),
})

export const eventKitAuthorizationSchema = z.strictObject({
  status: z.enum(['granted', 'denied', 'restricted', 'writeOnly', 'promptUnavailable']),
})

const errorKindSchema = z.enum([
  'denied',
  'restricted',
  'writeOnly',
  'unknown_source',
  'store_failure',
  'bad_request',
])

const replySchema = z.union([
  z.strictObject({ id: z.number().int(), ok: z.literal(true), result: z.unknown() }),
  z.strictObject({
    id: z.number().int(),
    ok: z.literal(false),
    error: z.strictObject({ kind: errorKindSchema }),
  }),
])

const pushSchema = z.strictObject({ event: z.literal('changed') })

export const eventKitMessageSchema = z.union([replySchema, pushSchema])

export const eventKitSourceListSchema = z.array(eventKitSourceSchema).max(50)
export const eventKitCalendarListSchema = z.array(eventKitCalendarSchema).max(500)
export const eventKitEventListSchema = z.array(eventKitEventSchema).max(2_000)

export type EventKitSource = z.infer<typeof eventKitSourceSchema>
export type EventKitCalendar = z.infer<typeof eventKitCalendarSchema>
export type EventKitEvent = z.infer<typeof eventKitEventSchema>
export type EventKitAuthorization = z.infer<typeof eventKitAuthorizationSchema>
export type EventKitMessage = z.infer<typeof eventKitMessageSchema>
export type EventKitErrorKind = z.infer<typeof errorKindSchema>
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/unit/eventKitProtocol.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/calendar/providers/eventkit/EventKitProtocol.ts tests/unit/eventKitProtocol.test.ts
git commit -m "feat(eventkit): schemas for the helper protocol"
```

---

### Task 2: Typed errors

**Files:**

- Modify: `src/main/infra/errors.ts`
- Test: `tests/unit/errors.test.ts`

**Interfaces:**

- Consumes: `EventKitErrorKind` from Task 1.
- Produces: `EventKitError` with `readonly kind: EventKitErrorKind | 'helper_unavailable' | 'timeout' | 'protocol'`, and `isEventKitError(error: unknown): error is EventKitError`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/errors.test.ts`:

```typescript
import { EventKitError, describeError, isEventKitError } from '../../src/main/infra/errors.ts'

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
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/unit/errors.test.ts`
Expected: FAIL, "EventKitError is not exported".

- [ ] **Step 3: Write the implementation**

Add to `src/main/infra/errors.ts`, after `AuthFlowError`:

```typescript
import type { EventKitErrorKind } from '../calendar/providers/eventkit/EventKitProtocol.ts'

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

export function isEventKitError(error: unknown): error is EventKitError {
  return error instanceof EventKitError
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/unit/errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/infra/errors.ts tests/unit/errors.test.ts
git commit -m "feat(eventkit): a typed error for calendar-store failures"
```

---

### Task 3: The helper process wrapper

> **Amended after review (17 October 2026).** The Step 3 code below is the
> original draft and is kept for the record; the implementation differs in five
> ways, each a defect found in review:
>
> 1. `defaultHelperSpawn` attaches an `'error'` listener and translates spawn
>    failure (ENOENT, EACCES) into the exit path. Without it an unhandled
>    `'error'` crashes the main process, and nothing in `src/` guards it.
> 2. The `'exit'` handler acts only when the exiting child is still the current
>    one, so a late exit cannot null out its successor.
> 3. Each child owns its line buffer, so a dead child's trailing bytes cannot
>    splice into the next child's frame.
> 4. The request frame is `{ ...payload, id, op }`, so a payload key cannot
>    overwrite the correlation id.
> 5. `ensureChild` applies `restartDelayMs` instead of only logging it: within
>    the backoff window it throws `EventKitError('helper_unavailable')` rather
>    than respawning a binary that is failing on startup.
> 6. `'error'` listeners cover the process and both pipes, attached at spawn
>    rather than at subscription: a helper dying mid-write raises EPIPE on
>    `child.stdin`, which crashes the process by the same mechanism. Logging
>    the errno code makes the export a factory, so `bootstrap.ts` in Task 8
>    calls `defaultHelperSpawn(logger)` rather than passing the function.

**Files:**

- Create: `src/main/calendar/providers/eventkit/EventKitHelperProcess.ts`
- Create: `src/main/calendar/providers/eventkit/helperPath.ts`
- Test: `tests/unit/eventKitHelperProcess.test.ts`

**Interfaces:**

- Consumes: Task 1 schemas, `EventKitError` from Task 2, `Signal` from `src/main/infra/Signal.ts`, `AppLogger`.
- Produces:
  - `interface HelperChild { readonly stdout: Readable; readonly stdin: Writable; on(event: 'exit', listener: () => void): void; kill(): void }`
  - `type HelperSpawn = (binaryPath: string) => HelperChild`, plus the exported default `defaultHelperSpawn`.
  - `interface EventKitRequester { request<T>(op: string, payload: Record<string, unknown>, schema: ZodType<T>): Promise<T> }` — what the provider and authorizer depend on, so their tests need no cast.
  - `class EventKitHelperProcess implements EventKitRequester` with `readonly changed: Signal<void>` and `stop(): void`. Constructor order is `(binaryPath, spawn, logger, timeoutMs = EVENTKIT_REQUEST_TIMEOUT_MS)`; `spawn` is required so no caller passes `undefined`.
  - `resolveHelperPath(app: { isPackaged: boolean; resourcesPath: string; appPath: string }): string`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/eventKitHelperProcess.test.ts
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { EventKitHelperProcess } from '../../src/main/calendar/providers/eventkit/EventKitHelperProcess.ts'
import type { HelperChild } from '../../src/main/calendar/providers/eventkit/EventKitHelperProcess.ts'
import { silentLogger } from '../mocks/logger.ts'

function fakeChild(): HelperChild & { exit(): void; emitLine(line: string): void } {
  const stdout = new PassThrough()
  const stdin = new PassThrough()
  const exitListeners: (() => void)[] = []
  return {
    stdout,
    stdin,
    on: (_event: 'exit', listener: () => void) => exitListeners.push(listener),
    kill: () => undefined,
    exit: () => exitListeners.forEach((listener) => listener()),
    emitLine: (line: string) => stdout.write(`${line}\n`),
  }
}

function written(child: HelperChild): Promise<string> {
  return new Promise((resolve) => child.stdin.once('data', (chunk) => resolve(String(chunk))))
}

describe('EventKitHelperProcess', () => {
  it('matches a reply to its request by id', async () => {
    const child = fakeChild()
    const helper = new EventKitHelperProcess('/bin/helper', () => child, silentLogger())

    const pending = helper.request('sources', {}, z.array(z.string()))
    const line = await written(child)
    const sent: unknown = JSON.parse(line)
    expect(sent).toMatchObject({ op: 'sources' })

    child.emitLine(JSON.stringify({ id: 1, ok: true, result: ['icloud'] }))
    await expect(pending).resolves.toEqual(['icloud'])
    helper.stop()
  })

  it('rejects with the helper error kind', async () => {
    const child = fakeChild()
    const helper = new EventKitHelperProcess('/bin/helper', () => child, silentLogger())

    const pending = helper.request('sources', {}, z.array(z.string()))
    await written(child)
    child.emitLine(JSON.stringify({ id: 1, ok: false, error: { kind: 'denied' } }))

    await expect(pending).rejects.toMatchObject({ kind: 'denied' })
    helper.stop()
  })

  it('rejects when the result does not match the caller schema', async () => {
    const child = fakeChild()
    const helper = new EventKitHelperProcess('/bin/helper', () => child, silentLogger())

    const pending = helper.request('sources', {}, z.array(z.string()))
    await written(child)
    child.emitLine(JSON.stringify({ id: 1, ok: true, result: { nope: true } }))

    await expect(pending).rejects.toMatchObject({ kind: 'protocol' })
    helper.stop()
  })

  it('ignores a malformed line and still answers the pending request', async () => {
    const child = fakeChild()
    const helper = new EventKitHelperProcess('/bin/helper', () => child, silentLogger())

    const pending = helper.request('sources', {}, z.array(z.string()))
    await written(child)
    child.emitLine('not json at all')
    child.emitLine(JSON.stringify({ id: 1, ok: true, result: [] }))

    await expect(pending).resolves.toEqual([])
    helper.stop()
  })

  it('publishes change pushes', async () => {
    const child = fakeChild()
    const helper = new EventKitHelperProcess('/bin/helper', () => child, silentLogger())
    const seen = vi.fn()
    helper.changed.subscribe(seen)

    await helper.request('sources', {}, z.array(z.string())).catch(() => undefined)
    child.emitLine(JSON.stringify({ event: 'changed' }))

    expect(seen).toHaveBeenCalledOnce()
    helper.stop()
  })

  it('times out a request that is never answered', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    const helper = new EventKitHelperProcess('/bin/helper', () => child, silentLogger(), 1_000)

    const pending = helper.request('sources', {}, z.array(z.string()))
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'timeout' })
    await vi.advanceTimersByTimeAsync(1_001)
    await assertion

    helper.stop()
    vi.useRealTimers()
  })

  it('fails pending requests when the helper exits, and respawns on the next one', async () => {
    const children = [fakeChild(), fakeChild()]
    let index = 0
    const spawn = vi.fn(() => children[index++])
    const helper = new EventKitHelperProcess('/bin/helper', spawn, silentLogger())

    const pending = helper.request('sources', {}, z.array(z.string()))
    children[0].exit()
    await expect(pending).rejects.toMatchObject({ kind: 'helper_unavailable' })

    const second = helper.request('sources', {}, z.array(z.string()))
    children[1].emitLine(JSON.stringify({ id: 2, ok: true, result: [] }))
    await expect(second).resolves.toEqual([])
    expect(spawn).toHaveBeenCalledTimes(2)
    helper.stop()
  })

  it('does not spawn until the first request', () => {
    const spawn = vi.fn(() => fakeChild())
    const helper = new EventKitHelperProcess('/bin/helper', spawn, silentLogger())
    expect(spawn).not.toHaveBeenCalled()
    helper.stop()
  })
})
```

If `tests/mocks/logger.ts` does not exist, create it:

```typescript
// tests/mocks/logger.ts
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
```

Check `src/main/infra/logger.ts` first and match `AppLogger` exactly; if an existing test already builds a logger stub, reuse that instead of adding a second one.

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/unit/eventKitHelperProcess.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/main/calendar/providers/eventkit/EventKitHelperProcess.ts
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

/** What consumers actually need. Keeps their tests free of process fakes. */
export interface EventKitRequester {
  request<T>(op: string, payload: Record<string, unknown>, schema: ZodType<T>): Promise<T>
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
  private buffer = ''
  private nextId = 1
  private restartDelayMs = 0
  private readonly pending = new Map<number, Pending>()

  constructor(
    private readonly binaryPath: string,
    private readonly spawn: HelperSpawn,
    private readonly logger: AppLogger,
    private readonly timeoutMs: number = EVENTKIT_REQUEST_TIMEOUT_MS,
  ) {}

  async request<T>(op: string, payload: Record<string, unknown>, schema: ZodType<T>): Promise<T> {
    const child = this.ensureChild()
    const id = this.nextId++

    const raw = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new EventKitError('timeout'))
      }, this.timeoutMs)

      this.pending.set(id, { settle: resolve, fail: reject, timer })
      child.stdin.write(`${JSON.stringify({ id, op, ...payload })}\n`)
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

    const child = this.spawn(this.binaryPath)
    this.child = child
    this.buffer = ''

    child.stdout.on('data', (chunk: Buffer | string) => {
      this.consume(String(chunk))
    })
    child.on('exit', () => {
      // Dropped rather than restarted here: the next request respawns, so a
      // helper nobody is using does not loop forever.
      this.child = null
      this.restartDelayMs = Math.min(
        this.restartDelayMs === 0 ? RESTART_FLOOR_MS : this.restartDelayMs * 2,
        RESTART_CAP_MS,
      )
      this.logger.warn('calendar helper exited', { restartDelayMs: this.restartDelayMs })
      this.failAll('helper_unavailable')
    })

    return child
  }

  private consume(chunk: string): void {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (line.trim().length === 0) {
        continue
      }
      this.handleLine(line)
    }
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

export function defaultHelperSpawn(binaryPath: string): HelperChild {
  const child = spawnChild(binaryPath, [], { stdio: ['pipe', 'pipe', 'ignore'] })
  if (!child.stdout || !child.stdin) {
    throw new EventKitError('helper_unavailable')
  }
  return {
    stdout: child.stdout,
    stdin: child.stdin,
    on: (event, listener) => {
      child.on(event, listener)
    },
    kill: () => {
      child.kill()
    },
  }
}
```

```typescript
// src/main/calendar/providers/eventkit/helperPath.ts
import { join } from 'node:path'

/**
 * Packaged, the binary sits in `Contents/Resources`. In dev it is whatever
 * `npm run build:helper` last produced.
 */
export interface HelperLocation {
  readonly isPackaged: boolean
  readonly resourcesPath: string
  readonly appPath: string
}

export const HELPER_BINARY_NAME = 'up-next-eventkit'

export function resolveHelperPath(location: HelperLocation): string {
  if (location.isPackaged) {
    return join(location.resourcesPath, HELPER_BINARY_NAME)
  }
  return join(location.appPath, 'build', 'helper', HELPER_BINARY_NAME)
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run tests/unit/eventKitHelperProcess.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/calendar/providers/eventkit tests/unit/eventKitHelperProcess.test.ts tests/mocks/logger.ts
git commit -m "feat(eventkit): a supervised helper process with request correlation"
```

---

### Task 4: The event mapper

**Files:**

- Create: `src/main/calendar/providers/eventkit/eventKitEventMapper.ts`
- Test: `tests/unit/eventKitEventMapper.test.ts`

**Interfaces:**

- Consumes: `EventKitEvent` (Task 1), `MappingContext` from `../google/googleEventMapper.ts`, `resolveConferenceUrl` from `../../conferenceLinks.ts`.
- Produces: `mapEventKitEvent(raw: EventKitEvent, context: MappingContext): CalendarEvent | null` and `mapEventKitEvents(items: readonly EventKitEvent[], context: MappingContext): CalendarEvent[]`.

`MappingContext` is `{ accountId: AccountId; calendarId: CalendarId }` and already exported from `googleEventMapper.ts`; import it rather than redeclaring.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/eventKitEventMapper.test.ts
import { describe, expect, it } from 'vitest'
import { mapEventKitEvent } from '../../src/main/calendar/providers/eventkit/eventKitEventMapper.ts'
import type { EventKitEvent } from '../../src/main/calendar/providers/eventkit/EventKitProtocol.ts'

const context = { accountId: 'eventkit:icloud', calendarId: 'cal-1' }

function event(patch: Partial<EventKitEvent> = {}): EventKitEvent {
  return {
    id: 'ABC-123',
    calendarId: 'cal-1',
    externalId: 'uid@icloud.com',
    title: 'Standup',
    start: '2026-10-17T09:00:00+01:00',
    end: '2026-10-17T09:15:00+01:00',
    isAllDay: false,
    url: null,
    location: null,
    notes: null,
    status: 'confirmed',
    selfDeclined: false,
    ...patch,
  }
}

describe('mapEventKitEvent', () => {
  it('normalises timestamps to UTC and namespaces the id', () => {
    const mapped = mapEventKitEvent(event(), context)
    expect(mapped).toMatchObject({
      id: 'eventkit:icloud:cal-1:ABC-123',
      accountId: 'eventkit:icloud',
      iCalUID: 'uid@icloud.com',
      start: '2026-10-17T08:00:00.000Z',
      isAllDay: false,
    })
  })

  it('drops a cancelled event', () => {
    expect(mapEventKitEvent(event({ status: 'cancelled' }), context)).toBeNull()
  })

  it('drops an event you declined', () => {
    expect(mapEventKitEvent(event({ selfDeclined: true }), context)).toBeNull()
  })

  it('drops an event with an unparseable timestamp', () => {
    expect(mapEventKitEvent(event({ start: 'tomorrow-ish' }), context)).toBeNull()
  })

  it('falls back to a placeholder title and caps a long one', () => {
    expect(mapEventKitEvent(event({ title: '   ' }), context)?.title).toBe('(no title)')
    expect(mapEventKitEvent(event({ title: 'x'.repeat(300) }), context)?.title.length).toBeLessThan(
      300,
    )
  })

  it('prefers the url field for a meeting link', () => {
    const mapped = mapEventKitEvent(event({ url: 'https://meet.google.com/abc-defg-hij' }), context)
    expect(mapped?.conferenceUrl).toBe('https://meet.google.com/abc-defg-hij')
  })

  it('finds a link in the notes when there is no url', () => {
    const mapped = mapEventKitEvent(
      event({ notes: 'Dial in: https://acme.zoom.us/j/123456789 see you there' }),
      context,
    )
    expect(mapped?.conferenceUrl).toBe('https://acme.zoom.us/j/123456789')
  })

  it('refuses a link on a host that is not allowed', () => {
    const mapped = mapEventKitEvent(event({ url: 'https://evil.example/join' }), context)
    expect(mapped?.conferenceUrl).toBeUndefined()
  })

  it('keeps an all-day event marked as all-day', () => {
    const mapped = mapEventKitEvent(
      event({
        isAllDay: true,
        start: '2026-10-17T00:00:00+01:00',
        end: '2026-10-18T00:00:00+01:00',
      }),
      context,
    )
    expect(mapped?.isAllDay).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/unit/eventKitEventMapper.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/main/calendar/providers/eventkit/eventKitEventMapper.ts
import { MAX_EVENT_TITLE_LENGTH } from '../../../../shared/constants.ts'
import type { CalendarEvent } from '../../../../shared/types/calendar.ts'
import { resolveConferenceUrl } from '../../conferenceLinks.ts'
import type { MappingContext } from '../google/googleEventMapper.ts'
import type { EventKitEvent } from './EventKitProtocol.ts'

/**
 * EventKit's shape to ours (docs/spec.md §3, §7).
 *
 * The helper sends location and notes solely so a meeting link can be found.
 * They are read here and dropped: nothing downstream ever sees them.
 */

export function mapEventKitEvent(
  raw: EventKitEvent,
  context: MappingContext,
): CalendarEvent | null {
  if (raw.status === 'cancelled' || raw.selfDeclined) {
    return null
  }

  const start = readTimestamp(raw.start)
  const end = readTimestamp(raw.end)
  if (!start || !end) {
    return null
  }

  const conferenceUrl = resolveConferenceUrl({
    structured: [raw.url],
    text: [raw.location, raw.notes],
  })

  return {
    id: `${context.accountId}:${context.calendarId}:${raw.id}`,
    accountId: context.accountId,
    calendarId: context.calendarId,
    iCalUID: raw.externalId,
    title: readTitle(raw.title),
    start,
    end,
    isAllDay: raw.isAllDay,
    ...(conferenceUrl ? { conferenceUrl } : {}),
  }
}

export function mapEventKitEvents(
  items: readonly EventKitEvent[],
  context: MappingContext,
): CalendarEvent[] {
  const mapped: CalendarEvent[] = []
  for (const item of items) {
    const event = mapEventKitEvent(item, context)
    if (event) {
      mapped.push(event)
    }
  }
  return mapped
}

/** Titles come from anyone who can send you an invite, so they are bounded (§8.1). */
function readTitle(title: string): string {
  const trimmed = title.trim()
  if (trimmed.length === 0) {
    return '(no title)'
  }
  return trimmed.slice(0, MAX_EVENT_TITLE_LENGTH)
}

/** The helper sends ISO 8601 with an offset, including for all-day events. */
function readTimestamp(value: string): string | null {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    return null
  }
  return new Date(parsed).toISOString()
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run tests/unit/eventKitEventMapper.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/calendar/providers/eventkit/eventKitEventMapper.ts tests/unit/eventKitEventMapper.test.ts
git commit -m "feat(eventkit): map store events onto the calendar domain"
```

---

### Task 5: The Swift helper

**Files:**

- Create: `resources/eventkit-helper/Package.swift`
- Create: `resources/eventkit-helper/Sources/UpNextEventKit/main.swift`
- Create: `resources/eventkit-helper/Sources/UpNextEventKit/Protocol.swift`
- Create: `resources/eventkit-helper/Sources/UpNextEventKit/Store.swift`
- Create: `resources/eventkit-helper/Tests/UpNextEventKitTests/StoreTests.swift`
- Create: `scripts/build-helper.sh`
- Modify: `package.json`, `.gitignore`

**Interfaces:**

- Consumes: the wire protocol from Task 1. The JSON keys here must match those schemas exactly.
- Produces: the binary `build/helper/up-next-eventkit`, and `npm run build:helper`.

- [ ] **Step 1: Write the failing Swift test**

```swift
// resources/eventkit-helper/Tests/UpNextEventKitTests/StoreTests.swift
import XCTest
@testable import UpNextEventKit

final class StoreTests: XCTestCase {
    func testFormatsWithOffset() {
        let date = Date(timeIntervalSince1970: 1_760_691_600)
        let formatted = isoString(from: date, timeZone: TimeZone(identifier: "Europe/London")!)
        XCTAssertEqual(formatted, "2026-10-17T10:00:00+01:00")
    }

    func testAllDayEndIsExclusiveMidnight() {
        let calendar = Calendar(identifier: .gregorian)
        var components = DateComponents()
        components.year = 2026
        components.month = 10
        components.day = 17
        let start = calendar.date(from: components)!
        let end = allDayEnd(start: start, days: 1, calendar: calendar)
        XCTAssertEqual(calendar.component(.day, from: end), 18)
    }

    func testSurvivesADstChange() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/London")!
        var components = DateComponents()
        components.year = 2026
        components.month = 10
        components.day = 24
        let start = calendar.date(from: components)!
        let end = allDayEnd(start: start, days: 2, calendar: calendar)
        XCTAssertEqual(calendar.component(.day, from: end), 26)
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd resources/eventkit-helper && swift test`
Expected: FAIL, "no such module 'UpNextEventKit'".

- [ ] **Step 3: Write the package manifest and the pure date helpers**

```swift
// resources/eventkit-helper/Package.swift
// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "UpNextEventKit",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "UpNextEventKit"),
        .testTarget(name: "UpNextEventKitTests", dependencies: ["UpNextEventKit"]),
    ]
)
```

```swift
// resources/eventkit-helper/Sources/UpNextEventKit/Store.swift
import EventKit
import Foundation

/// Pure date helpers, separated from EventKit so they can be tested.
func isoString(from date: Date, timeZone: TimeZone) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    formatter.timeZone = timeZone
    return formatter.string(from: date)
}

func allDayEnd(start: Date, days: Int, calendar: Calendar) -> Date {
    return calendar.date(byAdding: .day, value: days, to: start) ?? start
}

struct CalendarStore {
    let store = EKEventStore()

    func sources() -> [SourcePayload] {
        return store.sources
            .filter { !$0.calendars(for: .event).isEmpty }
            .map { source in
                let calendars = source.calendars(for: .event)
                let fallback = store.defaultCalendarForNewEvents
                let preferred = calendars.first { $0.calendarIdentifier == fallback?.calendarIdentifier }
                return SourcePayload(
                    id: source.sourceIdentifier,
                    title: source.title,
                    defaultCalendarId: (preferred ?? calendars.first)?.calendarIdentifier
                )
            }
    }

    func calendars(sourceId: String) throws -> [CalendarPayload] {
        guard let source = store.sources.first(where: { $0.sourceIdentifier == sourceId }) else {
            throw HelperError.unknownSource
        }
        let defaultId = store.defaultCalendarForNewEvents?.calendarIdentifier
        return source.calendars(for: .event).map { calendar in
            CalendarPayload(
                id: calendar.calendarIdentifier,
                title: calendar.title,
                isDefault: calendar.calendarIdentifier == defaultId
            )
        }
    }

    func events(sourceId: String, calendarIds: [String], start: Date, end: Date) throws -> [EventPayload] {
        guard let source = store.sources.first(where: { $0.sourceIdentifier == sourceId }) else {
            throw HelperError.unknownSource
        }
        // An empty selection means no calendars, not every calendar. The user
        // got here by unticking every box, and an app whose promise is that you
        // choose what it reads must fail closed. (Corrected at final review: the
        // original `calendarIds.isEmpty ? all : …` showed the whole source while
        // the pane read "0 calendars selected".)
        let all = source.calendars(for: .event)
        let wanted = all.filter { calendarIds.contains($0.calendarIdentifier) }
        if wanted.isEmpty {
            return []
        }

        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: wanted)
        let timeZone = TimeZone.current

        return store.events(matching: predicate).map { event in
            EventPayload(
                id: event.eventIdentifier ?? UUID().uuidString,
                calendarId: event.calendar.calendarIdentifier,
                externalId: event.calendarItemExternalIdentifier ?? "",
                title: event.title ?? "",
                start: isoString(from: event.startDate, timeZone: timeZone),
                end: isoString(from: event.endDate, timeZone: timeZone),
                isAllDay: event.isAllDay,
                url: event.url?.absoluteString,
                location: event.location,
                notes: event.notes,
                status: statusName(event.status),
                selfDeclined: isDeclinedBySelf(event)
            )
        }
    }

    private func statusName(_ status: EKEventStatus) -> String {
        switch status {
        case .confirmed: return "confirmed"
        case .tentative: return "tentative"
        case .canceled: return "cancelled"
        default: return "none"
        }
    }

    private func isDeclinedBySelf(_ event: EKEvent) -> Bool {
        guard let attendees = event.attendees else {
            return false
        }
        return attendees.contains { $0.isCurrentUser && $0.participantStatus == .declined }
    }
}

enum HelperError: Error {
    case denied
    case restricted
    case writeOnly
    case unknownSource
    case badRequest
    case storeFailure

    var kind: String {
        switch self {
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .writeOnly: return "writeOnly"
        case .unknownSource: return "unknown_source"
        case .badRequest: return "bad_request"
        case .storeFailure: return "store_failure"
        }
    }
}
```

- [ ] **Step 4: Run the Swift tests and watch them pass**

Run: `cd resources/eventkit-helper && swift test`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the protocol types and the stdio loop**

```swift
// resources/eventkit-helper/Sources/UpNextEventKit/Protocol.swift
import Foundation

struct SourcePayload: Encodable {
    let id: String
    let title: String
    let defaultCalendarId: String?
}

struct CalendarPayload: Encodable {
    let id: String
    let title: String
    let isDefault: Bool
}

struct EventPayload: Encodable {
    let id: String
    let calendarId: String
    let externalId: String
    let title: String
    let start: String
    let end: String
    let isAllDay: Bool
    let url: String?
    let location: String?
    let notes: String?
    let status: String
    let selfDeclined: Bool
}

struct AuthorizationPayload: Encodable {
    let status: String
}

struct Request: Decodable {
    let id: Int
    let op: String
    let sourceId: String?
    let calendarIds: [String]?
    let start: String?
    let end: String?
}
```

```swift
// resources/eventkit-helper/Sources/UpNextEventKit/main.swift
import EventKit
import Foundation

/// Newline-delimited JSON on stdio. One request in, one reply out, plus
/// unsolicited `{"event":"changed"}` when the store changes.

let store = CalendarStore()
let encoder = JSONEncoder()
let decoder = JSONDecoder()
let outputQueue = DispatchQueue(label: "uk.co.upnextapp.eventkit.output")

func emit(_ line: String) {
    outputQueue.sync {
        FileHandle.standardOutput.write(Data("\(line)\n".utf8))
    }
}

func emitResult<T: Encodable>(id: Int, result: T) {
    struct Reply<U: Encodable>: Encodable {
        let id: Int
        let ok: Bool
        let result: U
    }
    guard let data = try? encoder.encode(Reply(id: id, ok: true, result: result)),
          let line = String(data: data, encoding: .utf8) else {
        emitError(id: id, kind: "store_failure")
        return
    }
    emit(line)
}

func emitError(id: Int, kind: String) {
    emit("{\"id\":\(id),\"ok\":false,\"error\":{\"kind\":\"\(kind)\"}}")
}

func parseDate(_ value: String?) throws -> Date {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let value else {
        throw HelperError.badRequest
    }
    if let date = formatter.date(from: value) {
        return date
    }
    formatter.formatOptions = [.withInternetDateTime]
    guard let date = formatter.date(from: value) else {
        throw HelperError.badRequest
    }
    return date
}

func authorize() async -> String {
    let settled = authorizationName(of: EKEventStore.authorizationStatus(for: .event))
    if let settled {
        return settled
    }

    let granted: Bool
    do {
        granted = try await store.store.requestFullAccessToEvents()
    } catch {
        granted = false
    }

    let statusAfterRequest = EKEventStore.authorizationStatus(for: .event)
    return authorizationOutcome(granted: granted, statusAfterRequest: statusAfterRequest)
}

func handle(_ request: Request) async {
    do {
        switch request.op {
        case "authorize":
            let status = await authorize()
            emitResult(id: request.id, result: AuthorizationPayload(status: status))
        case "sources":
            emitResult(id: request.id, result: store.sources())
        case "calendars":
            guard let sourceId = request.sourceId else {
                throw HelperError.badRequest
            }
            emitResult(id: request.id, result: try store.calendars(sourceId: sourceId))
        case "events":
            guard let sourceId = request.sourceId else {
                throw HelperError.badRequest
            }
            let events = try store.events(
                sourceId: sourceId,
                calendarIds: request.calendarIds ?? [],
                start: try parseDate(request.start),
                end: try parseDate(request.end)
            )
            emitResult(id: request.id, result: events)
        default:
            throw HelperError.badRequest
        }
    } catch let error as HelperError {
        emitError(id: request.id, kind: error.kind)
    } catch {
        emitError(id: request.id, kind: "store_failure")
    }
}

if CommandLine.arguments.contains("--probe") {
    for source in store.sources() {
        let calendars = (try? store.calendars(sourceId: source.id)) ?? []
        print("\(source.title) [\(source.id)] — \(calendars.count) calendars")
    }
    exit(0)
}

NotificationCenter.default.addObserver(
    forName: .EKEventStoreChanged,
    object: store.store,
    queue: nil
) { _ in
    emit("{\"event\":\"changed\"}")
}

DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine(strippingNewline: true) {
        guard let data = line.data(using: .utf8),
              let request = try? decoder.decode(Request.self, from: data) else {
            continue
        }
        Task { await handle(request) }
    }
    exit(0)
}

RunLoop.main.run()
```

- [ ] **Step 6: Write the build script and wire it into npm**

```bash
# scripts/build-helper.sh
#!/usr/bin/env bash
# Builds the EventKit helper and places it where the app and electron-builder
# both expect it. Never commit the output: see .gitignore.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package="$root/resources/eventkit-helper"
output="$root/build/helper"

swift build --package-path "$package" -c release --arch arm64
mkdir -p "$output"
cp "$(swift build --package-path "$package" -c release --arch arm64 --show-bin-path)/UpNextEventKit" \
  "$output/up-next-eventkit"
echo "built $output/up-next-eventkit"
```

```bash
chmod +x scripts/build-helper.sh
```

In `package.json`, add the script and make the two build entry points depend on it:

```json
"build:helper": "./scripts/build-helper.sh",
"build": "npm run check-node && npm run build:helper && electron-vite build",
```

Add to `.gitignore`:

```
# Compiled EventKit helper; rebuild with `npm run build:helper`.
build/helper/
resources/eventkit-helper/.build/
```

- [ ] **Step 7: Build it and prove it runs**

Run: `npm run build:helper && ./build/helper/up-next-eventkit --probe`
Expected: the first run triggers the macOS calendar permission prompt, then one line per calendar source. If the Mac has no calendar accounts, no lines and exit 0.

- [ ] **Step 8: Commit**

```bash
git add resources/eventkit-helper scripts/build-helper.sh package.json .gitignore
git commit -m "feat(eventkit): a Swift helper that reads the macOS calendar store"
```

---

### Task 6: Provider, authenticator and factory

**Files:**

- Create: `src/main/calendar/providers/eventkit/EventKitProvider.ts`
- Create: `src/main/calendar/providers/eventkit/EventKitAuthorizer.ts`
- Modify: `src/shared/types/calendar.ts:3`
- Modify: `src/main/calendar/CalendarProvider.ts:41`
- Modify: `src/main/calendar/providers/google/GoogleAuthClient.ts`
- Modify: `src/main/calendar/ProviderFactory.ts`
- Test: `tests/unit/eventKitProvider.test.ts`

**Interfaces:**

- Consumes: `EventKitHelperProcess` (Task 3), `mapEventKitEvents` (Task 4), `EventKitError` (Task 2).
- Produces:
  - `ProviderKind` becomes `'google' | 'eventkit' | 'mock'`.
  - `AccountAuthenticator.authenticate(): Promise<AuthenticationResult[]>` — **now a list**, because one EventKit grant yields one account per source. `GoogleAuthClient` wraps its single result in an array.
  - `class EventKitProvider implements CalendarProvider` constructed as `new EventKitProvider(accountId, sourceId, helper, logger)`.
  - `class EventKitAuthorizer implements AccountAuthenticator` constructed as `new EventKitAuthorizer(helper, logger)`.
  - `eventKitAccountId(sourceId: string): string` exported from `EventKitProvider.ts`, returning `eventkit:${sourceId}`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/eventKitProvider.test.ts
import type { Mock } from 'vitest'
import { describe, expect, it, vi } from 'vitest'
import { EventKitAuthorizer } from '../../src/main/calendar/providers/eventkit/EventKitAuthorizer.ts'
import {
  EventKitProvider,
  eventKitAccountId,
} from '../../src/main/calendar/providers/eventkit/EventKitProvider.ts'
import type { EventKitRequester } from '../../src/main/calendar/providers/eventkit/EventKitHelperProcess.ts'
import { silentLogger } from '../mocks/logger.ts'

/**
 * The requester interface is deliberately narrow, so a fake is a plain object
 * and no cast is needed.
 */
function helperReturning(...results: unknown[]): EventKitRequester & { request: Mock } {
  const request = vi.fn()
  for (const result of results) {
    request.mockResolvedValueOnce(result)
  }
  return { request }
}

describe('eventKitAccountId', () => {
  it('namespaces the source identifier', () => {
    expect(eventKitAccountId('ABC')).toBe('eventkit:ABC')
  })
})

describe('EventKitProvider', () => {
  it('maps the helper events for its own account', async () => {
    const helper = helperReturning([
      {
        id: 'E1',
        calendarId: 'cal-1',
        externalId: 'uid-1',
        title: 'Standup',
        start: '2026-10-17T09:00:00+01:00',
        end: '2026-10-17T09:15:00+01:00',
        isAllDay: false,
        url: null,
        location: null,
        notes: null,
        status: 'confirmed',
        selfDeclined: false,
      },
    ])
    const provider = new EventKitProvider('eventkit:src', 'src', helper, silentLogger())

    const events = await provider.fetchEvents(['cal-1'], {
      start: '2026-10-17T00:00:00+01:00',
      end: '2026-10-18T00:00:00+01:00',
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ accountId: 'eventkit:src', title: 'Standup' })
  })

  it('lists its source calendars and reports the default as primary', async () => {
    const helper = helperReturning([{ id: 'cal-1', title: 'Home', isDefault: true }])
    const provider = new EventKitProvider('eventkit:src', 'src', helper, silentLogger())

    await expect(provider.listCalendars()).resolves.toEqual([
      { id: 'cal-1', title: 'Home', primary: true },
    ])
  })

  it('disconnects without calling the helper, because there is nothing to revoke', async () => {
    const helper = helperReturning()
    const provider = new EventKitProvider('eventkit:src', 'src', helper, silentLogger())

    await expect(provider.disconnect()).resolves.toBeUndefined()
    expect(helper.request).not.toHaveBeenCalled()
  })
})

describe('EventKitAuthorizer', () => {
  it('returns one result per source, defaulting to that source default calendar', async () => {
    const helper = helperReturning({ status: 'granted' }, [
      { id: 'icloud', title: 'iCloud', defaultCalendarId: 'cal-1' },
      { id: 'work', title: 'Work', defaultCalendarId: null },
    ])
    const authorizer = new EventKitAuthorizer(helper, silentLogger())

    const results = await authorizer.authenticate()

    expect(results).toEqual([
      {
        identity: { providerAccountId: 'eventkit:icloud', label: 'iCloud' },
        grantedScopes: ['eventkit.read'],
        defaultCalendarIds: ['cal-1'],
      },
      {
        identity: { providerAccountId: 'eventkit:work', label: 'Work' },
        grantedScopes: ['eventkit.read'],
        defaultCalendarIds: [],
      },
    ])
  })

  it('throws when the user refuses access', async () => {
    const helper = helperReturning({ status: 'denied' })
    const authorizer = new EventKitAuthorizer(helper, silentLogger())

    await expect(authorizer.authenticate()).rejects.toMatchObject({ kind: 'denied' })
  })

  it('treats write-only access as refusal, because the app only reads', async () => {
    const helper = helperReturning({ status: 'writeOnly' })
    const authorizer = new EventKitAuthorizer(helper, silentLogger())

    await expect(authorizer.authenticate()).rejects.toMatchObject({ kind: 'writeOnly' })
  })

  it('returns no accounts when the Mac has no calendar sources', async () => {
    const helper = helperReturning({ status: 'granted' }, [])
    const authorizer = new EventKitAuthorizer(helper, silentLogger())

    await expect(authorizer.authenticate()).resolves.toEqual([])
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/unit/eventKitProvider.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Widen `ProviderKind` and make `authenticate` return a list**

In `src/shared/types/calendar.ts`:

```typescript
export type ProviderKind = 'google' | 'eventkit' | 'mock'
```

In `src/main/calendar/CalendarProvider.ts`:

```typescript
/**
 * Separate from the provider because a provider is bound to a stored
 * credential, which does not exist until the first sign-in succeeds.
 *
 * A list, not one: a single EventKit grant yields one account per calendar
 * source. Google returns a list of one.
 */
export interface AccountAuthenticator {
  readonly kind: ProviderKind
  authenticate(): Promise<AuthenticationResult[]>
}
```

In `src/main/calendar/providers/google/GoogleAuthClient.ts`, change the signature of `authenticate` to `Promise<AuthenticationResult[]>` and wrap the existing returned object in `[ ... ]`. Nothing else in that file changes.

- [ ] **Step 4: Write the provider and authorizer**

```typescript
// src/main/calendar/providers/eventkit/EventKitProvider.ts
import type {
  AccountId,
  CalendarEvent,
  CalendarId,
  CalendarSummary,
  ProviderKind,
  TimeRange,
} from '../../../../shared/types/calendar.ts'
import type { AppLogger } from '../../../infra/logger.ts'
import type { CalendarProvider } from '../../CalendarProvider.ts'
import { mapEventKitEvents } from './eventKitEventMapper.ts'
import type { EventKitRequester } from './EventKitHelperProcess.ts'
import { eventKitCalendarListSchema, eventKitEventListSchema } from './EventKitProtocol.ts'

export function eventKitAccountId(sourceId: string): AccountId {
  return `eventkit:${sourceId}`
}

/**
 * One macOS calendar source — iCloud, an Exchange account — behind the
 * provider interface (docs/spec.md §3). There is no credential and no
 * network: everything comes from the shared helper process.
 */
export class EventKitProvider implements CalendarProvider {
  readonly kind: ProviderKind = 'eventkit'

  constructor(
    readonly accountId: AccountId,
    private readonly sourceId: string,
    private readonly helper: EventKitRequester,
    private readonly logger: AppLogger,
  ) {}

  isAuthenticated(): boolean {
    return true
  }

  canListCalendars(): boolean {
    return true
  }

  async listCalendars(): Promise<CalendarSummary[]> {
    const calendars = await this.helper.request(
      'calendars',
      { sourceId: this.sourceId },
      eventKitCalendarListSchema,
    )
    return calendars.map((calendar) => ({
      id: calendar.id,
      title: calendar.title,
      primary: calendar.isDefault,
    }))
  }

  async fetchEvents(
    calendarIds: readonly CalendarId[],
    range: TimeRange,
  ): Promise<CalendarEvent[]> {
    const raw = await this.helper.request(
      'events',
      {
        sourceId: this.sourceId,
        calendarIds: [...calendarIds],
        start: range.start,
        end: range.end,
      },
      eventKitEventListSchema,
    )
    this.logger.debug('read events from the calendar store', { events: raw.length })

    const events: CalendarEvent[] = []
    for (const calendarId of groupByCalendar(raw)) {
      const forCalendar = raw.filter((event) => event.calendarId === calendarId)
      events.push(...mapEventKitEvents(forCalendar, { accountId: this.accountId, calendarId }))
    }
    return events
  }

  /** Nothing to revoke: the grant belongs to the app, not to this account. */
  async disconnect(): Promise<void> {
    return await Promise.resolve()
  }
}

function groupByCalendar(events: readonly { calendarId: CalendarId }[]): readonly CalendarId[] {
  return [...new Set(events.map((event) => event.calendarId))]
}
```

```typescript
// src/main/calendar/providers/eventkit/EventKitAuthorizer.ts
import type { ProviderKind } from '../../../../shared/types/calendar.ts'
import { EventKitError } from '../../../infra/errors.ts'
import type { AppLogger } from '../../../infra/logger.ts'
import type { AccountAuthenticator, AuthenticationResult } from '../../CalendarProvider.ts'
import type { EventKitRequester } from './EventKitHelperProcess.ts'
import { eventKitAuthorizationSchema, eventKitSourceListSchema } from './EventKitProtocol.ts'
import { eventKitAccountId } from './EventKitProvider.ts'

/**
 * Triggers the macOS calendar prompt, then turns every source the Mac knows
 * about into one account. No browser, no token, no vendor round trip.
 */
export class EventKitAuthorizer implements AccountAuthenticator {
  readonly kind: ProviderKind = 'eventkit'

  constructor(
    private readonly helper: EventKitRequester,
    private readonly logger: AppLogger,
  ) {}

  async authenticate(): Promise<AuthenticationResult[]> {
    const authorization = await this.helper.request('authorize', {}, eventKitAuthorizationSchema)

    if (authorization.status !== 'granted') {
      // Every status is reported as itself. denied, restricted and writeOnly
      // are terminal until a System Settings toggle changes; promptUnavailable
      // means macOS was never asked at all.
      throw new EventKitError(authorization.status)
    }

    const sources = await this.helper.request('sources', {}, eventKitSourceListSchema)
    this.logger.info('calendar access granted', { sources: sources.length })

    return sources.map((source) => ({
      identity: { providerAccountId: eventKitAccountId(source.id), label: source.title },
      grantedScopes: ['eventkit.read'],
      defaultCalendarIds: source.defaultCalendarId ? [source.defaultCalendarId] : [],
    }))
  }
}
```

- [ ] **Step 5: Teach the factory about the new kind**

In `src/main/calendar/ProviderFactory.ts`, take the helper as a constructor dependency and add the branches:

```typescript
  constructor(
    private readonly config: AppConfig,
    private readonly vault: TokenVault,
    private readonly browser: SystemBrowser,
    private readonly helper: EventKitRequester,
    private readonly logger: AppLogger,
  ) {}

  canConnect(kind: ProviderKind): boolean {
    if (kind === 'mock' || kind === 'eventkit') {
      return true
    }
    return this.config.google !== null
  }

  createAuthenticator(kind: ProviderKind): AccountAuthenticator {
    if (kind === 'eventkit') {
      return new EventKitAuthorizer(this.helper, this.logger.child('eventkit-auth'))
    }
    if (kind !== 'google') {
      throw new Error(`no authenticator for provider ${kind}`)
    }
    // ...unchanged Google branch
  }

  async create(account: AccountConfig): Promise<CalendarProvider | null> {
    if (account.provider === 'mock') {
      return new MockCalendarProvider(account.id)
    }

    if (account.provider === 'eventkit') {
      const sourceId = account.id.replace(/^eventkit:/, '')
      return new EventKitProvider(account.id, sourceId, this.helper, this.logger.child('eventkit'))
    }

    // ...unchanged Google branch
  }
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS. Existing tests that call `authenticate()` on a Google stub need their return value wrapped in an array — fix those, they are the only expected breakage.

- [ ] **Step 7: Commit**

```bash
git add src/main/calendar src/shared/types/calendar.ts tests/unit/eventKitProvider.test.ts
git commit -m "feat(eventkit): a provider and authorizer per calendar source"
```

---

### Task 7: Connecting from the UI

**Files:**

- Modify: `src/main/calendar/AccountService.ts:109-150`
- Modify: `src/shared/ipc/contract.ts:42,230,266`
- Modify: `src/shared/ipc/bridge.ts:56`
- Modify: `src/preload/index.ts:162`
- Modify: `src/main/ipc/handlers/accountHandlers.ts:14`
- Modify: `src/renderer/common/hooks/useAccounts.ts:10,63`
- Modify: `src/renderer/settings/views/AccountsView.tsx`
- Modify: `docs/spec.md` §8.5
- Test: `tests/unit/accountService.test.ts`, `tests/unit/ipcContract.test.ts`

**Interfaces:**

- Consumes: `ProviderKind`, the factory branches from Task 6.
- Produces: `AccountService.connect(kind: ProviderKind): Promise<AccountView[]>`, `AccountService.canConnect(kind: ProviderKind): boolean`, `connectAccount(provider: ProviderKind)` across the bridge.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/accountService.test.ts — add to the existing file, or create it
import { describe, expect, it, vi } from 'vitest'

describe('AccountService.connect', () => {
  it('registers one account per authentication result', async () => {
    const results = [
      {
        identity: { providerAccountId: 'eventkit:icloud', label: 'iCloud' },
        grantedScopes: ['eventkit.read'],
        defaultCalendarIds: ['cal-1'],
      },
      {
        identity: { providerAccountId: 'eventkit:work', label: 'Work' },
        grantedScopes: ['eventkit.read'],
        defaultCalendarIds: [],
      },
    ]
    const { service, settings } = buildService({ authenticate: vi.fn().mockResolvedValue(results) })

    await service.connect('eventkit')

    expect(settings.getAccounts().map((account) => account.id)).toEqual([
      'eventkit:icloud',
      'eventkit:work',
    ])
  })

  it('reconnects an account using its own provider kind', async () => {
    const authenticate = vi.fn().mockResolvedValue([])
    const { service, createAuthenticator } = buildService({ authenticate })
    await service.connect('eventkit')

    await service.reconnect('eventkit:icloud')

    expect(createAuthenticator).toHaveBeenLastCalledWith('eventkit')
  })
})
```

Write `buildService` as a local helper in that test file, assembling `AccountService` from fakes for `SettingsStore`, `ProviderFactory`, `ProviderRegistry`, `AgendaService`, `TokenVault` and `SyncScheduler`. Follow whatever fake style `tests/unit/agendaService.test.ts` already uses.

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/unit/accountService.test.ts`
Expected: FAIL, `connect()` takes no argument and handles a single result.

- [ ] **Step 3: Rewrite `connect` and `reconnect`**

```typescript
  canConnect(kind: ProviderKind): boolean {
    return this.factory.canConnect(kind)
  }

  async connect(kind: ProviderKind): Promise<AccountView[]> {
    const authenticator = this.factory.createAuthenticator(kind)
    const results = await authenticator.authenticate()
    this.logger.info('sign-in returned', { provider: kind, accounts: results.length })

    // This is the boundary between a grant covering several sources and a
    // single UI response, so a failing source is caught and the rest are still
    // registered: losing all of iCloud because one local calendar could not be
    // written is not a trade the user would make.
    const failures: unknown[] = []
    let registered = 0

    for (const result of results) {
      try {
        await this.register(kind, result)
        registered += 1
      } catch (error) {
        failures.push(error)
        // No account id: for Google they are email addresses, and no label
        // either — it is the source's own name (§8.7).
        this.logger.warn('could not register account', {
          provider: kind,
          error: describeError(error),
        })
      }
    }

    // Before any rethrow: whatever did register needs scheduling, or it would
    // sit unsynced until the next restart.
    this.scheduler.reconcile()

    // Nothing landed, so there is nothing to show: the first failure travels on
    // to the IPC log and the renderer's generic sign-in error. Returning the
    // list here would look like success.
    if (registered === 0 && failures.length > 0) {
      throw failures[0]
    }

    return this.list()
  }

  /** Re-running consent for an existing account; a fresh grant replaces the dead one. */
  async reconnect(accountId: AccountId): Promise<AccountView[]> {
    const existing = this.settings.findAccount(accountId)
    const kind = existing?.provider ?? 'google'
    this.registry.forget(accountId)
    return await this.connect(kind)
  }

  private async register(kind: ProviderKind, result: AuthenticationResult): Promise<void> {
    const accountId = result.identity.providerAccountId

    this.settings.addAccount({
      id: accountId,
      provider: kind,
      label: result.identity.label,
      calendarIds: result.defaultCalendarIds,
    })

    const account = this.settings.findAccount(accountId)
    if (account) {
      const provider = await this.factory.create(account)
      if (provider) {
        this.registry.set(provider)
      }
    }

    this.agenda.setStatus(accountId, 'ready')
    // Deliberately not awaited: the first sync must not delay the UI response.
    void this.scheduler.syncNow(accountId)
  }
```

The loop tolerates per-result failure on purpose. One EventKit grant returns an
`AuthenticationResult` per calendar source and `register` writes to disk, so an
all-or-nothing loop would half-persist the batch and skip `reconcile()`
entirely: the accounts that did land would get no scheduled sync until the next
restart. Hence `reconcile()` runs on every path, and only a clean sweep of
failures rethrows — the renderer has one generic sign-in error, so a partial
success must come back as the list of what worked, not as an error. Cover both
cases in Step 1: one result failing out of several still registers the rest and
still reconciles exactly once, and every result failing rejects.

- [ ] **Step 4: Widen the IPC contract**

In `src/shared/ipc/contract.ts`:

```typescript
const providerKind = z.enum(['google', 'eventkit', 'mock'])

export const connectAccountSchema = z.strictObject({
  provider: z.enum(['google', 'eventkit']),
})
```

and replace both `provider: z.enum(['google', 'mock'])` occurrences (in `accountViewSchema` and `accountConfigSchema`) with `provider: providerKind`.

In `src/shared/ipc/bridge.ts`: `connectAccount(provider: ProviderKind): Promise<AccountView[]>`.

In `src/preload/index.ts`, pass the argument through to `CHANNELS.accountsConnect` as `{ provider }`.

In `src/main/ipc/handlers/accountHandlers.ts`:

```typescript
router.handle(
  CHANNELS.accountsConnect,
  async ({ provider }) => await deps.accounts.connect(provider),
)
```

- [ ] **Step 5: Update the renderer**

In `src/renderer/common/hooks/useAccounts.ts`, `connect` takes the provider:

```typescript
  connect(provider: ProviderKind): Promise<void>
```

```typescript
const connect = useCallback(
  async (provider: ProviderKind) => {
    await run(() => settingsApi().connectAccount(provider), 'Could not connect that account.')
  },
  [run],
)
```

In `src/renderer/settings/views/AccountsView.tsx`, offer both, and say what each one is:

```tsx
        <button
          type="button"
          disabled={state.busy}
          onClick={() => void state.connect('eventkit')}
          className="rounded border border-border px-3 py-1 text-xs text-accent hover:bg-accent/10 disabled:opacity-50"
        >
          Use Apple Calendar
        </button>
        <button
          type="button"
          disabled={state.busy}
          onClick={() => void state.connect('google')}
          className="rounded border border-border px-3 py-1 text-xs text-accent hover:bg-accent/10 disabled:opacity-50"
        >
          Connect Google account
        </button>
```

Replace the empty-state copy, which currently talks only about Google:

```tsx
<p className="text-sm text-text-muted">
  No accounts yet. Apple Calendar reads whatever accounts this Mac already syncs — iCloud, Exchange,
  anything in Calendar.app — and never leaves the machine. Connecting Google instead opens your
  browser to sign in; the app never sees your password.
</p>
```

And the footer line, which claims every disconnect revokes a token:

```tsx
<p className="text-xs text-text-muted">
  Disconnecting a Google account revokes the token, then deletes it from this Mac. Apple Calendar
  accounts have no token to revoke; macOS keeps the permission until you remove it in System
  Settings.
</p>
```

- [ ] **Step 6: Record the channel change in the spec**

In `docs/spec.md` §8.5, update the `accounts:connect` row so its payload reads `{ provider: 'google' | 'eventkit' }` rather than `{ provider: 'google' }`. Schema, sender check and table change together or the channel does not ship.

- [ ] **Step 7: Run everything**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src tests docs/spec.md
git commit -m "feat(accounts): choose a provider when connecting"
```

---

### Task 8: Resync when the calendar store changes

**Files:**

- Modify: `src/main/sync/SyncScheduler.ts`
- Modify: `src/main/bootstrap.ts`
- Test: `tests/unit/syncScheduler.test.ts`

**Interfaces:**

- Consumes: `EventKitHelperProcess.changed` (Task 3).
- Produces: `SyncScheduler.syncProviderNow(kind: ProviderKind, reason: string): void`, debounced by `STORE_CHANGE_DEBOUNCE_MS = 2_000`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/syncScheduler.test.ts — add to the existing file, or create it
describe('syncProviderNow', () => {
  it('syncs only the accounts of that provider, once per burst', async () => {
    vi.useFakeTimers()
    const { scheduler, coordinator } = buildScheduler({
      accounts: [
        { id: 'eventkit:icloud', provider: 'eventkit' },
        { id: 'work@example.com', provider: 'google' },
      ],
    })
    scheduler.start()
    coordinator.syncAccount.mockClear()

    scheduler.syncProviderNow('eventkit', 'calendar store changed')
    scheduler.syncProviderNow('eventkit', 'calendar store changed')
    scheduler.syncProviderNow('eventkit', 'calendar store changed')
    await vi.advanceTimersByTimeAsync(2_100)

    expect(coordinator.syncAccount).toHaveBeenCalledOnce()
    expect(coordinator.syncAccount).toHaveBeenCalledWith('eventkit:icloud')

    scheduler.stop()
    vi.useRealTimers()
  })

  it('fires 2s after the leading change, not 2s after the last one', async () => {
    // t=0 arms the timer, t=1500 joins it, so it fires at t=2000.
    // A reset-on-each-event debounce would still be waiting at t=2100.
  })

  it('debounces each provider kind independently', async () => {
    // 'eventkit' at t=0 and 'google' at t=500 must both fire,
    // each syncing only its own accounts.
  })
})
```

Build `buildScheduler` with a `coordinator` whose `syncAccount` is `vi.fn().mockResolvedValue('ok')` and a settings fake returning the given accounts, matching the fake style already used in the suite.

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/unit/syncScheduler.test.ts`
Expected: FAIL, `syncProviderNow is not a function`.

- [ ] **Step 3: Implement it**

Add to `src/main/sync/SyncScheduler.ts`:

```typescript
import type { AccountId, ProviderKind } from '../../shared/types/calendar.ts'

const STORE_CHANGE_DEBOUNCE_MS = 2_000
```

The timer is keyed by `ProviderKind`, not a single field. A single field would
mean a change from one provider silently dropping a change from another: the
second call hits the pending-timer guard and returns, and the kind that closed
over the `setTimeout` is the only one that ever syncs. Per-kind keying makes the
method do what its signature promises — each kind coalesces on its own window.

```typescript
  private readonly storeChangeTimers = new Map<ProviderKind, NodeJS.Timeout>()

  /**
   * The macOS calendar store announces changes in bursts — one per calendar
   * touched — so the first one starts a short timer and the rest join it.
   *
   * The timer is keyed by kind: a burst from one provider must not swallow a
   * change from another, and each kind coalesces on its own window.
   */
  syncProviderNow(kind: ProviderKind, reason: string): void {
    if (!this.running || this.storeChangeTimers.has(kind)) {
      return
    }

    const timer = setTimeout(() => {
      this.storeChangeTimers.delete(kind)
      this.logger.info('sync triggered', { reason, provider: kind })
      for (const account of this.settings.getAccounts()) {
        if (account.provider === kind) {
          void this.syncNow(account.id)
        }
      }
    }, STORE_CHANGE_DEBOUNCE_MS)
    this.storeChangeTimers.set(kind, timer)
  }
```

Note the debounce is leading-arm/trailing-fire: the first change arms the timer
and later ones join it rather than pushing it back, so a steady trickle of
changes still syncs every 2s instead of starving.

Clear **every** pending timer in `stop()`, not just one:

```typescript
  stop(): void {
    this.running = false
    for (const timer of this.storeChangeTimers.values()) {
      clearTimeout(timer)
    }
    this.storeChangeTimers.clear()
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
  }
```

- [ ] **Step 4: Wire it in `bootstrap.ts`**

Construct the helper before the factory, pass it in, and subscribe after the scheduler exists:

```typescript
const helper = new EventKitHelperProcess(
  resolveHelperPath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  }),
  defaultHelperSpawn,
  this.logger.child('eventkit-helper'),
)

const factory = new ProviderFactory(config, vault, browser, helper, this.logger.child('providers'))
```

```typescript
helper.changed.subscribe(() => {
  scheduler.syncProviderNow('eventkit', 'calendar store changed')
})
```

And in whatever teardown path already calls `scheduler.stop()`, call `helper.stop()` beside it.

- [ ] **Step 5: Run everything**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/sync/SyncScheduler.ts src/main/bootstrap.ts tests/unit/syncScheduler.test.ts
git commit -m "feat(eventkit): resync when the macOS calendar store changes"
```

---

### Task 9: Refused permission becomes a fixable status

**Files:**

- Modify: `src/main/sync/SyncCoordinator.ts:80-99`, `src/main/infra/errors.ts`
- Modify: `src/main/calendar/AccountService.ts`
- Modify: `src/shared/constants.ts`, `src/shared/types/account.ts`
- Modify: `src/shared/ipc/channels.ts`, `src/shared/ipc/contract.ts`, `src/shared/ipc/bridge.ts`, `src/preload/index.ts`
- Modify: `src/main/ipc/handlers/accountHandlers.ts`
- Modify: `src/renderer/common/hooks/useAccounts.ts`, `src/renderer/settings/views/AccountsView.tsx`
- Modify: `docs/spec.md` §8.5, §8.6
- Test: `tests/unit/syncCoordinator.test.ts`, `tests/unit/accountService.test.ts`, `tests/unit/ipcContract.test.ts`

**Interfaces:**

- Consumes: `EventKitError` and `isEventKitError` (Task 2).
- Produces: `CALENDAR_ACCESS_REFUSALS` in `src/shared/constants.ts` and `isCalendarAccessRefusal` in `src/main/infra/errors.ts`, shared by the sync path and the sign-in path.
- Produces: `AccountService.connect`/`reconnect` returning `ConnectAccountsResult` (`{ accounts, accessProblem }`) instead of `AccountView[]`, across the bridge. Amended by Task 12: the field was `refusal` here, and widened once a fourth state appeared that is not a refusal.
- Produces: a new no-payload channel `CHANNELS.accountsOpenCalendarPrivacy`, and `openCalendarPrivacy(): Promise<void>` on the settings bridge.

Without this, a user who clicks Deny gets an account stuck on `offline` that
retries forever and never says what to do. `denied`, `restricted` and
`writeOnly` are terminal until a System Settings toggle changes, which is
exactly what `needsReauth` means.

**There is a fourth state, and it is not a refusal.** See Task 12: a request
that macOS will not put on screen at all reports `promptUnavailable`, travels
on the same response field, and is deliberately kept out of
`CALENDAR_ACCESS_REFUSALS` because no System Settings toggle changes it.

**Two journeys reach the same refusal, and both have to be served.** An
account that was granted and later revoked refuses through `fetchEvents`,
which lands in `SyncCoordinator.classify` and becomes a `needsReauth` status
on an existing row. A user who clicks Deny on the _first_ prompt refuses
through `EventKitAuthorizer.authenticate()`, before any account row exists —
there is nothing to put a status on, and a placeholder account for a
permission the user refused would then show up in the agenda, the tray and
the sync schedule. So that refusal is reported in the connect response
instead. It cannot be thrown: `IpcRouter` turns every handler error into the
same opaque `'request rejected'`, so a thrown refusal is indistinguishable
from a network failure by the time the renderer sees it.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/syncCoordinator.test.ts — the revoked account, refusing mid-sync
import { EventKitError } from '../../src/main/infra/errors.ts'
import { CALENDAR_ACCESS_REFUSALS } from '../../src/shared/constants.ts'

describe('SyncCoordinator with EventKit failures', () => {
  // Driven by the shared list, so the sync path and the sign-in path cannot
  // classify differently.
  it.each(CALENDAR_ACCESS_REFUSALS)('treats %s as terminal', async (kind) => {
    const { coordinator, agenda } = buildCoordinator({
      fetchEvents: vi.fn().mockRejectedValue(new EventKitError(kind)),
    })

    await expect(coordinator.syncAccount('eventkit:icloud')).resolves.toBe('reauth')
    expect(agenda.setStatus).toHaveBeenLastCalledWith('eventkit:icloud', 'needsReauth')
  })

  it('keeps retrying when the helper is merely unavailable', async () => {
    const { coordinator, agenda } = buildCoordinator({
      fetchEvents: vi.fn().mockRejectedValue(new EventKitError('helper_unavailable')),
    })

    await expect(coordinator.syncAccount('eventkit:icloud')).resolves.toBe('transient')
    expect(agenda.setStatus).toHaveBeenLastCalledWith('eventkit:icloud', 'offline')
  })
})
```

```typescript
// tests/unit/accountService.test.ts — the first-time Deny, refusing at sign-in
it.each(CALENDAR_ACCESS_REFUSALS)(
  'reports %s from the permission prompt as a refusal, not a failure',
  async (kind) => {
    const { service, settings, scheduler } = buildService({
      authenticate: vi.fn().mockRejectedValue(new EventKitError(kind)),
    })
    const reconcile = vi.spyOn(scheduler, 'reconcile')

    const result = await service.connect('eventkit')

    // No placeholder account: nothing was granted, so nothing may appear in
    // the agenda, the tray or the sync schedule.
    expect(result).toEqual({ accounts: [], refusal: kind })
    expect(settings.getAccounts()).toEqual([])
    expect(reconcile).not.toHaveBeenCalled()
  },
)

it('still rejects when the helper itself could not be reached', async () => {
  const { service } = buildService({
    authenticate: vi.fn().mockRejectedValue(new EventKitError('helper_unavailable')),
  })

  await expect(service.connect('eventkit')).rejects.toThrow(EventKitError)
})
```

Build `buildCoordinator` with fakes for `ProviderRegistry`, `SettingsStore`,
`AgendaService` and `AppLogger`, matching the fake style already used in the
suite. `buildService` already exists in `accountService.test.ts`; its existing
cases assert on `AccountView[]` and move to `result.accounts`.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run tests/unit/syncCoordinator.test.ts tests/unit/accountService.test.ts`
Expected: FAIL — the sync case resolves `transient`, and `connect` rejects with
the `EventKitError` instead of reporting it.

- [ ] **Step 3: Classify the terminal kinds, in one place**

In `src/shared/constants.ts`:

```typescript
/** Terminal until a System Settings toggle changes, so retrying only spins
 * (§7). Shared: both the sync path and the connect response classify against
 * this one list. */
export const CALENDAR_ACCESS_REFUSALS = ['denied', 'restricted', 'writeOnly'] as const
```

with `export type CalendarAccessRefusal = (typeof CALENDAR_ACCESS_REFUSALS)[number]` in
`src/shared/types/account.ts`.

In `src/main/infra/errors.ts`:

```typescript
/** Typed against the error's own union, so a member that is not an EventKit
 * kind will not compile. */
const REFUSED_KINDS: ReadonlySet<EventKitError['kind']> = new Set<EventKitError['kind']>(
  CALENDAR_ACCESS_REFUSALS,
)

export function isCalendarAccessRefusal(
  error: unknown,
): error is EventKitError & { readonly kind: CalendarAccessRefusal } {
  return isEventKitError(error) && REFUSED_KINDS.has(error.kind)
}
```

In `src/main/sync/SyncCoordinator.ts`, at the top of `classify`:

```typescript
// Refused, restricted by policy, or granted write-only: all three need a
// System Settings change, so retrying would only spin (§7).
if (isCalendarAccessRefusal(error)) {
  this.agenda.setStatus(accountId, 'needsReauth')
  this.logger.warn('calendar access refused', { kind: error.kind })
  return 'reauth'
}
```

- [ ] **Step 3b: Report the refusal the first prompt produces**

`AccountService.connect` calls `authenticate()` before any account row
exists, so a refusal there has nothing to flag and must not escape as a
generic sign-in failure. Return it instead. In
`src/shared/types/account.ts`:

```typescript
export interface ConnectAccountsResult {
  readonly accounts: readonly AccountView[]
  readonly refusal: CalendarAccessRefusal | null
}
```

In `src/main/calendar/AccountService.ts`, `connect` and `reconnect` return
`Promise<ConnectAccountsResult>`, and the `authenticate()` call is guarded:

```typescript
let results: readonly AuthenticationResult[]
try {
  results = await authenticator.authenticate()
} catch (error) {
  // Caught to answer the user, not to swallow. Anything that is not a
  // refusal is a real failure and carries on to the IPC boundary.
  if (!isCalendarAccessRefusal(error)) {
    throw error
  }
  this.logger.warn('calendar access refused at sign-in', { provider: kind, kind: error.kind })
  return { accounts: this.list(), refusal: error.kind }
}
```

Every other `return this.list()` in `connect` becomes
`return { accounts: this.list(), refusal: null }`. Do **not** create a
placeholder account for the refused permission: it would be synced, shown in
the agenda and counted in the tray, for calendars the app cannot read.

In `src/shared/ipc/contract.ts`, beside `accountListSchema`:

```typescript
export const connectAccountsResultSchema = z.strictObject({
  accounts: accountListSchema,
  refusal: z.enum(CALENDAR_ACCESS_REFUSALS).nullable(),
})
```

`connectAccount` and `reconnectAccount` return `Promise<ConnectAccountsResult>`
in `src/shared/ipc/bridge.ts` and `src/preload/index.ts`. The handlers in
`accountHandlers.ts` are unchanged — they already return whatever the service
returns.

In `src/renderer/common/hooks/useAccounts.ts`, connect and reconnect parse
`connectAccountsResultSchema` rather than `accountListSchema`, and the hook
exposes `calendarAccessRefusal: CalendarAccessRefusal | null` alongside the
generic `error` string, so the pane can tell a refusal from a failure.

- [ ] **Step 4: Add the channel that opens System Settings**

In `src/shared/ipc/channels.ts`, add `accountsOpenCalendarPrivacy: 'accounts:openCalendarPrivacy'`.

In `src/shared/ipc/contract.ts`, add the row `[CHANNELS.accountsOpenCalendarPrivacy]: noPayload` to `REQUEST_SCHEMAS`.

In `src/main/ipc/handlers/accountHandlers.ts`:

```typescript
router.handle(CHANNELS.accountsOpenCalendarPrivacy, async () => {
  await shell.openExternal(CALENDAR_PRIVACY_URL)
})
```

with, at the top of the file:

```typescript
/** The Calendars pane of Privacy & Security. A fixed constant, never built
 * from anything the renderer sends (§8.6). */
const CALENDAR_PRIVACY_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars'
```

Add `openCalendarPrivacy(): Promise<void>` to the settings bridge in
`src/shared/ipc/bridge.ts` and expose it in `src/preload/index.ts` alongside
the other account calls.

- [ ] **Step 5: Offer the fix next to the problem**

In `src/renderer/settings/views/AccountsView.tsx`, the reconnect button is
wrong for an EventKit account — there is nothing to reconnect. The same
button is needed in two places: beside a revoked account, and beside a
refused sign-in where no account exists. So it is one component, and the
click goes through `useAccounts`.

**The channel is rate-limited (`channel:role`, `RATE_LIMIT_WINDOW_MS`), so a
double-click is refused and the second promise rejects.** `onClick={() => void
settingsApi().openCalendarPrivacy()}` would make that an unhandled rejection:
`void` satisfies the lint rule and handles nothing. The hook owns the failure,
as it does for connect and disconnect:

```typescript
// useAccounts.ts
const openCalendarPrivacy = useCallback(async () => {
  try {
    await settingsApi().openCalendarPrivacy()
    setError(null)
  } catch {
    setError('Could not open System Settings. Try again in a moment.')
  }
}, [])
```

```tsx
function PrivacySettingsButton({ state }: AccountsViewProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => void state.openCalendarPrivacy()}
      className="rounded border border-border px-2 py-1 text-xs text-accent hover:bg-accent/10"
    >
      Open Calendar privacy settings
    </button>
  )
}
```

Used in both places:

```tsx
{
  state.calendarAccessRefusal && (
    <div className="flex items-center gap-3 rounded-md border border-urgent/40 px-3 py-2">
      <p className="flex-1 text-xs text-urgent">{REFUSAL_MESSAGE[state.calendarAccessRefusal]}</p>
      <PrivacySettingsButton state={state} />
    </div>
  )
}
```

```tsx
{
  account.status === 'needsReauth' &&
    (account.provider === 'eventkit' ? (
      <PrivacySettingsButton state={state} />
    ) : (
      <button
        type="button"
        disabled={state.busy}
        onClick={() => void state.reconnect(account.id)}
        className="rounded border border-border px-2 py-1 text-xs text-accent hover:bg-accent/10 disabled:opacity-50"
      >
        Reconnect
      </button>
    ))
}
```

`PreferencesView.tsx` calls `settingsApi().syncNow()` and `testAlert()` the
same way, and both channels are rate-limited too: move them onto `useSettings`
with the same try/catch-into-`error` mechanism.

- [ ] **Step 6: Record the channel in the spec**

Add a row for `accounts:openCalendarPrivacy` to `docs/spec.md` §8.5 — payload
`undefined`, sender role settings — and note in §8.6 that the URL is a
compile-time constant, so the renderer cannot choose what gets opened.

Also note under the §8.5 table that `accounts:connect` and
`accounts:reconnect` answer with `{ accounts, refusal }`: a refusal cannot be
thrown, because `IpcRouter` collapses every handler error into the same
opaque message and the renderer could not tell it from a network failure.

- [ ] **Step 7: Run everything**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src tests docs/spec.md
git commit -m "feat(eventkit): point refused calendar access at System Settings"
```

---

### Task 10: Packaging, entitlements and the macOS 14 floor

**Files:**

- Modify: `electron-builder.yml`
- Modify: `build/entitlements.mac.plist`
- Modify: `build/entitlements.adhoc.plist`
- Modify: `README.md`
- Modify: `docs/spec.md` §8.8 and §9

**Interfaces:**

- Consumes: `build/helper/up-next-eventkit` from Task 5.
- Produces: a signed, notarised DMG whose bundle contains the helper and whose Info.plist carries the usage string.

- [ ] **Step 1: Add the entitlement to both plists**

In `build/entitlements.mac.plist` and `build/entitlements.adhoc.plist`, inside the existing `<dict>`:

```xml
    <key>com.apple.security.personal-information.calendars</key>
    <true/>
```

Extend the comment at the top of `entitlements.mac.plist` so the reason is recorded next to it:

```xml
  personal-information.calendars: EventKit reads the macOS calendar store.
  Read-only use; the app never writes an event. TCC still gates it behind the
  user's own Allow, and the usage string is in Info.plist.
```

- [ ] **Step 2: Bundle, sign and declare the floor**

In `electron-builder.yml`, under `mac:`:

```yaml
extraResources:
  - from: build/helper/up-next-eventkit
    to: up-next-eventkit
# Signed explicitly: a nested executable outside the standard layout is not
# picked up automatically, and an unsigned one fails library validation.
binaries:
  - Contents/Resources/up-next-eventkit
extendInfo:
  LSUIElement: true
  LSMinimumSystemVersion: '14.0'
  NSCalendarsFullAccessUsageDescription: >-
    Up Next reads the calendars already set up on this Mac so it can show
    today's meetings. It only reads, and nothing leaves your Mac.
```

- [ ] **Step 3: Build a local package and verify the signature**

Run:

```bash
npm run package
codesign -dv --verbose=4 "dist/mac-arm64/Up Next.app/Contents/Resources/up-next-eventkit"
```

Expected: the helper is present and reports the same Team ID as the app. If it is unsigned, `binaries` is wrong — fix before continuing.

- [ ] **Step 4: Verify the real flow once, by hand**

Run: `npm run install:local`, open the app, go to Settings → Accounts → Use Apple Calendar.

Expected: macOS shows the calendar permission prompt naming Up Next; allowing it adds one account per source; the widget shows today's events from them; editing an event in `Calendar.app` updates the widget within a few seconds.

- [ ] **Step 5: Update the documentation**

In `README.md`: change the requirements line to **Apple silicon, macOS Sonoma or newer**, replace "and a Google account" with "and either a Google account or calendars already set up in Calendar.app", and add a line to the development section noting that `npm run dev` prompts for calendar access as "Electron", separately from the installed app's grant.

In `docs/spec.md`: move the EventKit bullet in §9 from "Later, optional" into the shipped phases, and add the entitlement and the helper to the §8.8 runtime-integrity notes.

- [ ] **Step 6: Commit**

```bash
git add electron-builder.yml build/entitlements.mac.plist build/entitlements.adhoc.plist README.md docs/spec.md
git commit -m "chore(package): bundle and sign the EventKit helper, require macOS 14"
```

---

### Task 11: The Homebrew cask

**Files:**

- Modify: `Casks/up-next.rb` in `edspressomartini/homebrew-tap` (a separate repository)

- [ ] **Step 1: Raise the OS floor**

The cask already has a `depends_on macos:` line pinned to Ventura. Change the
symbol, do not add a second line:

```ruby
  depends_on macos: :sonoma
```

A bare symbol already means "that version or newer". The `">= :sonoma"` form
is deprecated and `brew audit` warns three times per install — `docs/homebrew-plan.md`
records that lesson from the 0.1.0 cask.

- [ ] **Step 2: Verify on a clean install**

Run: `brew install --cask edspressomartini/tap/up-next` after the release is published.
Expected: installs on Sonoma or later, refuses with a clear message on Ventura.

- [ ] **Step 3: Commit in the tap repository**

```bash
git commit -am "chore: require macOS Sonoma for the EventKit build"
```

---

### Task 12: A prompt that could not be shown is not a denial

Found by running the feature: `npm run dev`, "Use Apple Calendar", and the
pane said macOS had declined — with no prompt ever having appeared.
`./build/helper/up-next-eventkit --probe` printed `authorization: 0`,
`notDetermined`, so nothing had been refused.

**Files:**

- Modify: `resources/eventkit-helper/Sources/UpNextEventKit/{main,Store}.swift`
- Modify: `src/main/calendar/providers/eventkit/{EventKitProtocol,EventKitAuthorizer}.ts`
- Modify: `src/shared/constants.ts`, `src/shared/types/account.ts`, `src/shared/ipc/contract.ts`
- Modify: `src/main/infra/errors.ts`, `src/main/calendar/AccountService.ts`, `src/main/bootstrap.ts`
- Modify: `src/renderer/common/hooks/useAccounts.ts`, `src/renderer/settings/views/AccountsView.tsx`
- Test: `resources/eventkit-helper/Tests/UpNextEventKitTests/StoreTests.swift`, `tests/unit/{eventKitProtocol,eventKitProvider,errors,accountService,ipcContract}.test.ts`

**Interfaces:**

- Produces: `promptUnavailable` in `eventKitAuthorizationSchema`'s status enum, replacing `notDetermined`, which was never an answer to having asked and existed only to be folded into `denied` on arrival.
- Produces: `CALENDAR_PROMPT_UNAVAILABLE` and `CALENDAR_ACCESS_PROBLEMS` in `src/shared/constants.ts`, `CalendarAccessProblem` in `src/shared/types/account.ts`, and `isCalendarAccessProblem` in `src/main/infra/errors.ts`.
- Produces: `ConnectAccountsResult.accessProblem`, renamed from `refusal`, carrying either.

**The model, with the fourth state in it:**

| State                               | How it is reached                                                         | Result                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `granted`                           | The status was already `.fullAccess`, or the request returned true.       | One account per calendar source.                                            |
| `denied`, `restricted`, `writeOnly` | The status reads so, before the request or after it.                      | `needsReauth`, with a button opening System Settings → Privacy → Calendars. |
| `promptUnavailable`                 | The request threw, or returned false leaving the status `.notDetermined`. | Said plainly in the pane, with **no** System Settings button.               |

`promptUnavailable` is terminal like the refusals, and is deliberately not one
of them: the privacy pane fixes a refusal and nothing else, so offering it here
would send the user somewhere nothing is wrong and nothing can be changed. The
ordinary cause is an app bundle with no `NSCalendarsFullAccessUsageDescription`
— macOS will not show a calendar prompt for one — which is why Task 13 gives
the dev Electron host that key.

Telling them apart means re-reading `EKEventStore.authorizationStatus(for:)`
after the request: a real Deny moves the status to `.denied`, a prompt that
never appeared leaves it `.notDetermined`. `try?` is gone from
`requestFullAccessToEvents()`; the error is caught to translate at the
boundary, and the status read is the translation.
