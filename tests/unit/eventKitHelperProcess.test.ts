import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  defaultHelperSpawn,
  EventKitHelperProcess,
} from '../../src/main/calendar/providers/eventkit/EventKitHelperProcess.ts'
import type { HelperChild } from '../../src/main/calendar/providers/eventkit/EventKitHelperProcess.ts'
import { recordingLogger, silentLogger, type LogEntry } from '../mocks/logger.ts'

interface FakeChild extends HelperChild {
  exit(): void
  emitLine(line: string): void
  emitChunk(text: string): void
}

/** Hands out the given children in order, then refuses. */
function spawnQueue(children: readonly FakeChild[]) {
  const queue = [...children]
  return vi.fn((): HelperChild => {
    const next = queue.shift()
    if (!next) {
      throw new Error('spawned more helpers than this test provides')
    }
    return next
  })
}

function fakeChild(): FakeChild {
  const stdout = new PassThrough()
  const stdin = new PassThrough()
  const exitListeners: (() => void)[] = []
  return {
    stdout,
    stdin,
    on: (_event: 'exit', listener: () => void) => exitListeners.push(listener),
    kill: () => undefined,
    exit: () => {
      exitListeners.forEach((listener) => {
        listener()
      })
    },
    emitLine: (line: string) => stdout.write(`${line}\n`),
    emitChunk: (text: string) => stdout.write(text),
  }
}

/** Lets the streams deliver everything written so far. */
function flushStreams(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

/** Long enough for a real child process to fail and report it. */
function flushProcessEvents(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 200)
  })
}

function written(child: HelperChild): Promise<string> {
  return new Promise((resolve) =>
    child.stdin.once('data', (chunk) => {
      resolve(String(chunk))
    }),
  )
}

describe('EventKitHelperProcess', () => {
  it('matches a reply to its request by id', async () => {
    const child = fakeChild()
    const helper = new EventKitHelperProcess('/bin/helper', () => child, silentLogger())

    const pending = helper.request('sources', {}, z.array(z.string()))
    const line = await written(child)
    const sent: unknown = JSON.parse(line)
    expect(sent).toMatchObject({ id: 1, op: 'sources' })

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

    // Not awaited: nothing answers this request, and the push arrives on the
    // same stream while it is still in flight.
    const pending = helper.request('sources', {}, z.array(z.string()))
    await written(child)
    child.emitLine(JSON.stringify({ event: 'changed' }))
    await vi.waitFor(() => {
      expect(seen).toHaveBeenCalledOnce()
    })

    const abandoned = expect(pending).rejects.toMatchObject({ kind: 'helper_unavailable' })
    helper.stop()
    await abandoned
  })

  it('times out a request that is never answered, and stop clears the timer', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    const helper = new EventKitHelperProcess('/bin/helper', () => child, silentLogger(), 1_000)

    const pending = helper.request('sources', {}, z.array(z.string()))
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'timeout' })
    await vi.advanceTimersByTimeAsync(1_001)
    await assertion

    const abandoned = helper.request('sources', {}, z.array(z.string()))
    const stopped = expect(abandoned).rejects.toMatchObject({ kind: 'helper_unavailable' })
    helper.stop()
    await stopped
    expect(vi.getTimerCount()).toBe(0)

    vi.useRealTimers()
  })

  it('fails pending requests when the helper exits, and respawns on the next one', async () => {
    vi.useFakeTimers()
    const firstChild = fakeChild()
    const secondChild = fakeChild()
    const spawn = spawnQueue([firstChild, secondChild])
    const helper = new EventKitHelperProcess('/bin/helper', spawn, silentLogger())

    const pending = helper.request('sources', {}, z.array(z.string()))
    firstChild.exit()
    await expect(pending).rejects.toMatchObject({ kind: 'helper_unavailable' })

    // Past the restart backoff, so this request is allowed to respawn.
    await vi.advanceTimersByTimeAsync(1_000)
    const second = helper.request('sources', {}, z.array(z.string()))
    secondChild.emitLine(JSON.stringify({ id: 2, ok: true, result: [] }))
    await expect(second).resolves.toEqual([])
    expect(spawn).toHaveBeenCalledTimes(2)

    helper.stop()
    vi.useRealTimers()
  })

  it('refuses to respawn until the restart backoff has elapsed', async () => {
    vi.useFakeTimers()
    const firstChild = fakeChild()
    const secondChild = fakeChild()
    const spawn = spawnQueue([firstChild, secondChild])
    const helper = new EventKitHelperProcess('/bin/helper', spawn, silentLogger())

    const pending = helper.request('sources', {}, z.array(z.string()))
    firstChild.exit()
    await expect(pending).rejects.toMatchObject({ kind: 'helper_unavailable' })

    // A helper that dies on startup must not be respawned once per request.
    await vi.advanceTimersByTimeAsync(999)
    const tooSoon = helper.request('sources', {}, z.array(z.string()))
    await expect(tooSoon).rejects.toMatchObject({ kind: 'helper_unavailable' })
    expect(spawn).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2)
    const allowed = helper.request('sources', {}, z.array(z.string()))
    // A refused request consumes no id, so this is still the second one.
    secondChild.emitLine(JSON.stringify({ id: 2, ok: true, result: ['icloud'] }))
    await expect(allowed).resolves.toEqual(['icloud'])
    expect(spawn).toHaveBeenCalledTimes(2)

    helper.stop()
    vi.useRealTimers()
  })

  it('ignores an exit from a child it has already replaced', async () => {
    const firstChild = fakeChild()
    const secondChild = fakeChild()
    const spawn = spawnQueue([firstChild, secondChild])
    const helper = new EventKitHelperProcess('/bin/helper', spawn, silentLogger())

    const abandoned = helper.request('sources', {}, z.array(z.string()))
    const stopped = expect(abandoned).rejects.toMatchObject({ kind: 'helper_unavailable' })
    helper.stop()
    await stopped

    const pending = helper.request('sources', {}, z.array(z.string()))
    // The killed child's exit arrives late; it must not orphan its successor.
    firstChild.exit()
    secondChild.emitLine(JSON.stringify({ id: 2, ok: true, result: ['icloud'] }))
    await expect(pending).resolves.toEqual(['icloud'])
    expect(spawn).toHaveBeenCalledTimes(2)

    helper.stop()
  })

  it('does not splice a dead child\u2019s late bytes into its successor\u2019s frames', async () => {
    const firstChild = fakeChild()
    const secondChild = fakeChild()
    const spawn = spawnQueue([firstChild, secondChild])
    const helper = new EventKitHelperProcess('/bin/helper', spawn, silentLogger(), 1_000)

    const abandoned = helper.request('sources', {}, z.array(z.string()))
    const stopped = expect(abandoned).rejects.toMatchObject({ kind: 'helper_unavailable' })
    helper.stop()
    await stopped

    const second = helper.request('sources', {}, z.array(z.string()))
    // Two halves of a reply for the id the *successor* is waiting on.
    firstChild.emitChunk('{"id":2,"ok":true,"res')
    firstChild.emitLine('ult":[]}')
    await flushStreams()

    secondChild.emitLine(JSON.stringify({ id: 2, ok: true, result: ['icloud'] }))
    await expect(second).resolves.toEqual(['icloud'])

    helper.stop()
  })

  it('keeps the framing fields authoritative over the payload', async () => {
    const child = fakeChild()
    const helper = new EventKitHelperProcess('/bin/helper', () => child, silentLogger())

    const pending = helper.request('sources', { id: 99, op: 'overwritten' }, z.array(z.string()))
    const sent: unknown = JSON.parse(await written(child))
    expect(sent).toMatchObject({ id: 1, op: 'sources' })

    child.emitLine(JSON.stringify({ id: 1, ok: true, result: [] }))
    await expect(pending).resolves.toEqual([])
    helper.stop()
  })

  it('does not spawn until the first request', () => {
    const spawn = vi.fn(() => fakeChild())
    const helper = new EventKitHelperProcess('/bin/helper', spawn, silentLogger())
    expect(spawn).not.toHaveBeenCalled()
    helper.stop()
  })
})

/**
 * These run a real child process, because the hazard being tested is a Node
 * one: an 'error' event with no listener is rethrown as an uncaught exception,
 * and in the main process that is fatal.
 */
describe('defaultHelperSpawn', () => {
  const MISSING_BINARY = '/nonexistent/up-next-eventkit'
  const temporaryDirectories: string[] = []

  afterAll(async () => {
    await Promise.all(temporaryDirectories.map((dir) => rm(dir, { force: true, recursive: true })))
  })

  /** An executable helper stand-in, since the Swift binary does not exist yet. */
  async function helperFixture(script: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'up-next-helper-'))
    temporaryDirectories.push(dir)
    const binary = join(dir, 'up-next-eventkit')
    await writeFile(binary, script, { mode: 0o755 })
    return binary
  }

  /** A missing binary is the normal state of a dev tree. */
  it('reports a binary that cannot be spawned instead of throwing uncaught', async () => {
    const helper = new EventKitHelperProcess(
      MISSING_BINARY,
      defaultHelperSpawn(silentLogger()),
      silentLogger(),
      2_000,
    )

    const pending = helper.request('sources', {}, z.array(z.string()))
    await expect(pending).rejects.toMatchObject({ kind: 'helper_unavailable' })
    helper.stop()
  })

  it('logs why the spawn failed, so a broken install is diagnosable', async () => {
    const entries: LogEntry[] = []
    const helper = new EventKitHelperProcess(
      MISSING_BINARY,
      defaultHelperSpawn(recordingLogger(entries)),
      silentLogger(),
      2_000,
    )

    const pending = helper.request('sources', {}, z.array(z.string()))
    await expect(pending).rejects.toMatchObject({ kind: 'helper_unavailable' })

    expect(entries).toContainEqual(
      expect.objectContaining({ level: 'warn', context: { code: 'ENOENT' } }),
    )
    helper.stop()
  })

  it('does not depend on the caller subscribing to stay alive', async () => {
    // Spawn and ignore: the crash guard must not live in the subscription.
    const spawn = defaultHelperSpawn(silentLogger())
    const child = spawn(MISSING_BINARY)

    expect(child.stdin.writable).toBe(true)
    await flushProcessEvents()
    child.kill()
  })

  /**
   * The gap this class exists to survive: the OS closes the pipe the moment
   * the helper lets go of it, but `this.child` stays set until 'exit' is
   * delivered. A request in that window writes to a dead pipe, and the EPIPE
   * is emitted on the socket.
   */
  it('fails a request when the helper has closed its stdin', async () => {
    const binary = await helperFixture('#!/bin/sh\nexec 0<&-\nsleep 5\n')
    const helper = new EventKitHelperProcess(
      binary,
      defaultHelperSpawn(silentLogger()),
      silentLogger(),
      500,
    )

    // Nothing answers this, and it gives the helper time to close fd 0.
    const unanswered = helper.request('sources', {}, z.array(z.string()))
    await expect(unanswered).rejects.toMatchObject({ kind: 'timeout' })

    // The helper is still running, so this writes to the closed pipe.
    const broken = helper.request('sources', {}, z.array(z.string()))
    await expect(broken).rejects.toMatchObject({ kind: 'helper_unavailable' })
    helper.stop()
  })

  it('logs a broken pipe with its code', async () => {
    const binary = await helperFixture('#!/bin/sh\nexec 0<&-\nsleep 5\n')
    const entries: LogEntry[] = []
    const helper = new EventKitHelperProcess(
      binary,
      defaultHelperSpawn(recordingLogger(entries)),
      silentLogger(),
      500,
    )

    await expect(helper.request('sources', {}, z.array(z.string()))).rejects.toMatchObject({
      kind: 'timeout',
    })
    await expect(helper.request('sources', {}, z.array(z.string()))).rejects.toMatchObject({
      kind: 'helper_unavailable',
    })

    expect(entries).toContainEqual(
      expect.objectContaining({ level: 'warn', context: { source: 'stdin', code: 'EPIPE' } }),
    )
    helper.stop()
  })
})
