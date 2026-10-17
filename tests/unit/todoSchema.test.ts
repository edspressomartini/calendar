import { describe, expect, it } from 'vitest'
import { parseTodos, pruneCompleted } from '../../src/main/storage/todoSchema.ts'
import type { Todo } from '../../src/shared/types/todo.ts'

/**
 * A hand-edited or half-written file must cost the user one line at most,
 * never the list (docs/spec.md §8.2).
 */

const todo: Todo = {
  id: 'a',
  title: 'Book the thing',
  day: '2026-09-30',
  createdAt: '2026-09-30T08:00:00.000Z',
  completedAt: null,
  rollCount: 0,
  rank: 1000,
}

describe('parseTodos', () => {
  it('keeps the rows it understands', () => {
    const parsed = parseTodos({ todos: [todo, { ...todo, id: 'b' }] })
    expect(parsed).toHaveLength(2)
  })

  it('drops one unreadable row rather than failing the file', () => {
    const parsed = parseTodos({
      todos: [todo, { ...todo, id: 'b', day: 'whenever' }, { ...todo, id: 'c' }],
    })
    expect(parsed.map((entry) => entry.id)).toEqual(['a', 'c'])
  })

  it('fills in a field added after the file was written', () => {
    const older: Record<string, unknown> = { ...todo }
    delete older['rollCount']

    const parsed = parseTodos({ todos: [older] })

    expect(parsed[0]?.rollCount).toBe(0)
  })

  it('drops a field that no longer exists', () => {
    const parsed = parseTodos({ todos: [{ ...todo, remindAt: 'nope' }] })
    expect(parsed[0]).not.toHaveProperty('remindAt')
  })

  it('refuses a duplicated id, which would break every lookup by id', () => {
    const parsed = parseTodos({ todos: [todo, { ...todo, title: 'Different' }] })
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.title).toBe('Book the thing')
  })

  it('returns nothing for a file that is not a list at all', () => {
    expect(parseTodos(null)).toEqual([])
    expect(parseTodos('nonsense')).toEqual([])
    expect(parseTodos({ todos: 'nonsense' })).toEqual([])
  })
})

/**
 * A list written before ranking existed must open in the order the user last
 * saw it, which was `createdAt` ascending — not in file order, and not all
 * sharing a rank of zero.
 */
describe('parseTodos on a file written before ranking', () => {
  const withoutRank = (id: string, createdAt: string): Record<string, unknown> => {
    const row: Record<string, unknown> = { ...todo, id, createdAt }
    delete row['rank']

    return row
  }

  const unranked = [
    withoutRank('newest', '2026-09-30T10:00:00.000Z'),
    withoutRank('oldest', '2026-09-30T08:00:00.000Z'),
    withoutRank('middle', '2026-09-30T09:00:00.000Z'),
  ]

  it('ranks them oldest first, which is the order they used to display in', () => {
    const parsed = parseTodos({ todos: unranked })
    const order = [...parsed].sort((left, right) => left.rank - right.rank).map((item) => item.id)

    expect(order).toEqual(['oldest', 'middle', 'newest'])
  })

  it('gives every row a distinct rank, so the order is not left to chance', () => {
    const parsed = parseTodos({ todos: unranked })

    expect(new Set(parsed.map((item) => item.rank)).size).toBe(parsed.length)
  })

  it('leaves room below the first item', () => {
    const parsed = parseTodos({ todos: unranked })

    expect(Math.min(...parsed.map((item) => item.rank))).toBeGreaterThan(0)
  })

  it('leaves ranks alone once every row has one', () => {
    const ranked = [
      { ...todo, id: 'a', rank: 7 },
      { ...todo, id: 'b', rank: 3 },
    ]

    expect(parseTodos({ todos: ranked }).map((item) => item.rank)).toEqual([7, 3])
  })
})

describe('pruneCompleted', () => {
  const done: Todo = { ...todo, id: 'done', completedAt: '2026-09-30T09:00:00.000Z' }

  it('keeps recently completed items, so a mistaken tick can be undone', () => {
    expect(pruneCompleted([done], '2026-10-05')).toHaveLength(1)
  })

  it('drops long-completed items so the file cannot grow forever', () => {
    expect(pruneCompleted([done], '2026-12-31')).toHaveLength(0)
  })

  it('never drops something still outstanding, however old', () => {
    expect(pruneCompleted([todo], '2030-01-01')).toHaveLength(1)
  })
})
