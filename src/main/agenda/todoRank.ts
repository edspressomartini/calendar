import { RANK_GAP } from '../../shared/constants.ts'
import type { Todo } from '../../shared/types/todo.ts'

/**
 * Ordering arithmetic for the TODO list (docs/spec.md §6).
 *
 * Ranks are spaced rather than consecutive so that moving one item writes one
 * item: the new rank is the midpoint of its neighbours, and the rest of the
 * list is left alone.
 */

/** Ascending by rank. Ties keep their relative order, which `sort` guarantees. */
export function byRank(todos: readonly Todo[]): Todo[] {
  return [...todos].sort((left, right) => left.rank - right.rank)
}

/** The rank an item appended to the end of `todos` should take. */
export function nextRank(todos: readonly Todo[]): number {
  if (todos.length === 0) {
    return RANK_GAP
  }
  const highest = todos.reduce((max, todo) => (todo.rank > max ? todo.rank : max), 0)

  return highest + RANK_GAP
}

/**
 * Renumbers a group `RANK_GAP` apart in its current order.
 *
 * Starts at `RANK_GAP` rather than at zero so there is room below the first
 * item. Starting at zero would leave no midpoint under it, and "move to the
 * top" — the most likely move anyone makes — would renumber the whole group
 * every single time.
 */
export function renumber(group: readonly Todo[]): Todo[] {
  return rankedInOrder(byRank(group))
}

function rankedInOrder(ordered: readonly Todo[]): Todo[] {
  return ordered.map((todo, index) => ({ ...todo, rank: (index + 1) * RANK_GAP }))
}

export interface ReorderResult {
  /** Every item whose rank changed — one in the usual case, the group when renumbering. */
  readonly changed: readonly Todo[]
}

/**
 * Moves `moved` to sit immediately after `afterId` within `group`, or to the
 * front when `afterId` is null.
 *
 * Returns null when the move cannot be made sense of: the item is not in this
 * group, the neighbour is not either, or the neighbour is the item itself.
 * Refusing is deliberate. The caller is acting on a request from the renderer,
 * which may have been built against a list that has since changed, and moving
 * the wrong row is worse than ignoring a stale click.
 */
export function reorder(
  group: readonly Todo[],
  movedId: string,
  afterId: string | null,
): ReorderResult | null {
  const ordered = byRank(group)
  const moved = ordered.find((todo) => todo.id === movedId)
  if (!moved || movedId === afterId) {
    return null
  }

  const withoutMoved = ordered.filter((todo) => todo.id !== movedId)
  const index = afterId === null ? -1 : withoutMoved.findIndex((todo) => todo.id === afterId)
  if (afterId !== null && index === -1) {
    return null
  }

  const before = index === -1 ? null : withoutMoved[index]
  const after = withoutMoved[index + 1] ?? null
  const rank = rankBetween(before?.rank ?? null, after?.rank ?? null)

  if (rank !== null) {
    return { changed: [{ ...moved, rank }] }
  }

  // No midpoint left between the neighbours. Space the group out again with
  // the item already in its new position, so the move still happens.
  const placed = [...withoutMoved.slice(0, index + 1), moved, ...withoutMoved.slice(index + 1)]

  return { changed: rankedInOrder(placed) }
}

/**
 * A whole rank strictly between the two, or null when there is no room.
 *
 * Open-ended on either side: nothing before it goes a gap below, nothing
 * after it goes a gap above.
 */
function rankBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) {
    return RANK_GAP
  }
  if (before === null) {
    // Non-null by the check above.
    const next = after as number

    return next > 0 ? Math.floor(next / 2) : null
  }
  if (after === null) {
    return before + RANK_GAP
  }

  const midpoint = Math.floor((before + after) / 2)

  return midpoint > before && midpoint < after ? midpoint : null
}
