/**
 * A single TODO. Unlike an event it has no clock time: it belongs to a day,
 * and moves between days only when the user rolls it forward (docs/spec.md §6).
 */
export interface Todo {
  readonly id: string
  readonly title: string
  /** `YYYY-MM-DD` in local time — the day bucket it currently sits in. */
  readonly day: string
  /** Never changes, so "the day I added it" survives every roll. */
  readonly createdAt: string
  readonly completedAt: string | null
  /** How many times it has been deferred. */
  readonly rollCount: number
  /**
   * Where the user put it, ascending, within whichever group it falls into.
   *
   * On the item rather than in an ordering list alongside it: adding,
   * rolling, pruning and redacting all move items around already, and a
   * separate list would have to be reconciled with each of them.
   */
  readonly rank: number
}

/**
 * A past day's completed TODOs, for the history view (§6).
 *
 * Keyed by the day the work was ticked off rather than the day it was filed
 * under, because the question history answers is "what did I get done".
 */
export interface TodoHistoryDay {
  /** `YYYY-MM-DD` in local time. */
  readonly day: string
  readonly todos: readonly Todo[]
}

/**
 * What the widget renders. Grouped in main so the renderer never has to work
 * out what "today" means (§5).
 */
export interface TodoSnapshot {
  /** The local day the grouping was built against, as `YYYY-MM-DD`. */
  readonly today: string
  /** Incomplete and left behind on an earlier day. */
  readonly overdue: readonly Todo[]
  /** Everything filed under today, completed ones last. */
  readonly current: readonly Todo[]
  /** Rolled past today; shown only as a count, so nothing vanishes silently. */
  readonly upcoming: readonly Todo[]
  /**
   * Completed before today, most recent day first. Bounded by the same
   * retention that prunes the list, so it can never grow past 30 days.
   */
  readonly history: readonly TodoHistoryDay[]
}
