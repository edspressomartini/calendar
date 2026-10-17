import { describe, expect, it } from 'vitest'
import { byRank, nextRank, renumber, reorder } from '../../src/main/agenda/todoRank.ts'
import { RANK_GAP } from '../../src/shared/constants.ts'
import type { Todo } from '../../src/shared/types/todo.ts'

/**
 * Ordering arithmetic (docs/spec.md §6). The interesting cases are the ones
 * where a midpoint does not exist, because that is where a move can silently
 * do nothing.
 */

function todo(id: string, rank: number): Todo {
  return {
    id,
    title: id,
    day: '2026-10-17',
    createdAt: '2026-10-17T08:00:00.000Z',
    completedAt: null,
    rollCount: 0,
    rank,
  }
}

const ids = (todos: readonly Todo[]): string[] => byRank(todos).map((item) => item.id)

/** Applies a reorder to a group the way TodoService does, for readability. */
function applied(group: readonly Todo[], movedId: string, afterId: string | null): string[] {
  const result = reorder(group, movedId, afterId)
  if (!result) {
    throw new Error('expected the move to be accepted')
  }
  const ranks = new Map(result.changed.map((item) => [item.id, item.rank] as const))

  return ids(
    group.map((item) => {
      const rank = ranks.get(item.id)

      return rank === undefined ? item : { ...item, rank }
    }),
  )
}

describe('nextRank', () => {
  it('starts above zero, so there is room to move something to the top', () => {
    expect(nextRank([])).toBeGreaterThan(0)
  })

  it('puts a new item past the highest rank, not past the last one listed', () => {
    const group = [todo('a', 3000), todo('b', 1000)]

    expect(nextRank(group)).toBe(3000 + RANK_GAP)
  })
})

describe('reorder', () => {
  const group = [todo('a', 1000), todo('b', 2000), todo('c', 3000)]

  it('moves an item up one place', () => {
    expect(applied(group, 'c', 'a')).toEqual(['a', 'c', 'b'])
  })

  it('moves an item down one place', () => {
    expect(applied(group, 'a', 'b')).toEqual(['b', 'a', 'c'])
  })

  it('moves an item to the top when there is no neighbour to follow', () => {
    expect(applied(group, 'c', null)).toEqual(['c', 'a', 'b'])
  })

  it('changes exactly one item when a midpoint exists', () => {
    const result = reorder(group, 'c', 'a')

    expect(result?.changed).toHaveLength(1)
  })

  it('refuses a neighbour that is not in the group', () => {
    expect(reorder(group, 'a', 'gone')).toBeNull()
  })

  it('refuses an item that is not in the group', () => {
    expect(reorder(group, 'gone', 'a')).toBeNull()
  })

  it('refuses to move an item after itself', () => {
    expect(reorder(group, 'a', 'a')).toBeNull()
  })

  /**
   * The case that decides whether the feature works or quietly stops: once
   * neighbours are adjacent integers there is no midpoint, and without the
   * renumber the move would be dropped.
   */
  it('renumbers when the neighbours have no whole number between them', () => {
    const tight = [todo('a', 10), todo('b', 11), todo('c', 12)]
    const result = reorder(tight, 'c', 'a')

    expect(result?.changed).toHaveLength(3)
    expect(applied(tight, 'c', 'a')).toEqual(['a', 'c', 'b'])
  })

  it('leaves room below the first item after renumbering', () => {
    const renumbered = renumber([todo('a', 10), todo('b', 11)])

    expect(Math.min(...renumbered.map((item) => item.rank))).toBeGreaterThan(0)
  })

  it('keeps every rank a whole number, since the contract requires integers', () => {
    const tight = [todo('a', 10), todo('b', 13)]
    const result = reorder(tight, 'b', null)

    for (const item of result?.changed ?? []) {
      expect(Number.isInteger(item.rank)).toBe(true)
    }
  })
})
