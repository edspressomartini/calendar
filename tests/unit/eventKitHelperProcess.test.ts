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
    exit: () => {
      exitListeners.forEach((listener) => {
        listener()
      })
    },
    emitLine: (line: string) => stdout.write(`${line}\n`),
  }
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
    const firstChild = fakeChild()
    const secondChild = fakeChild()
    const queue = [firstChild, secondChild]
    const spawn = vi.fn((): HelperChild => {
      const next = queue.shift()
      if (!next) {
        throw new Error('spawned more helpers than this test provides')
      }
      return next
    })
    const helper = new EventKitHelperProcess('/bin/helper', spawn, silentLogger())

    const pending = helper.request('sources', {}, z.array(z.string()))
    firstChild.exit()
    await expect(pending).rejects.toMatchObject({ kind: 'helper_unavailable' })

    const second = helper.request('sources', {}, z.array(z.string()))
    secondChild.emitLine(JSON.stringify({ id: 2, ok: true, result: [] }))
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
