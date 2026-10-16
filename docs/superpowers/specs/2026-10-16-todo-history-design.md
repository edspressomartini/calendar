# TODO history

**Date:** 16 October 2026
**Status:** approved, not implemented

## Why

People are using the TODO list to write their standup and weekly updates, which
means they need to read back what they ticked off. Right now they cannot. A
completed TODO keeps the `day` it was filed under, and `TodoService.build()`
buckets items into `overdue`, `current` and `upcoming` — a thing completed
yesterday matches none of those, so it vanishes from the widget the moment the
day rolls over and stays invisible until `pruneCompleted` deletes it at thirty
days.

The data is already on disk. This is a grouping and display problem, not a
storage one.

## What it is

A read-only history view inside the widget's TODO section, reached by a small
button, listing completed TODOs grouped by the day they were ticked off, most
recent first.

Explicitly not in scope:

- Un-ticking an item from history. Considered and rejected: history that
  changes under you while you are reading it out is confusing, and the open
  list is one click away for anything that needs correcting.
- Copying a day to the clipboard. The same reasoning — worth revisiting once
  people have actually used the view, not before.
- Anything about incomplete TODOs. Rolling and deferral already have their own
  behaviour and history says nothing about them.

## Lookback

Thirty days, which is what it already is. `TODO_COMPLETED_RETENTION_DAYS`
deletes completed items older than that when the list is written, so history
cannot show more than thirty days whatever we do. That covers any standup or
weekly, the privacy policy already states the figure, and raising it would mean
changing the published policy for a benefit nobody has asked for.

No separate "lookback window" exists. An earlier design grouped by "the last day
you completed something" so that Monday would show Friday; a full history makes
that unnecessary, because Friday is simply the first day in the list.

## Architecture

The chosen approach adds a fourth group to the existing snapshot. Two
alternatives were considered:

| Approach                                            | Why not                                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A new `todos:history` IPC channel fetched on demand | Costs a schema, a sender check and a row in the §8.5 table, and gives the renderer a second copy of state that can go stale against the live snapshot. |
| Let the renderer filter the raw list                | The renderer never receives raw TODOs, and privacy redaction happens in main. It would break the architecture to save nothing.                         |

The payload argument for a separate channel does not hold: `MAX_TODOS` caps the
whole list at 500 items, so carrying the completed ones in every snapshot is
bounded and small. Adding a group keeps the rule that main owns the grouping and
the renderer derives nothing.

### Main

`TodoSnapshot` gains a `history` field, shaped as days rather than a flat list
so the renderer does not have to work out where one day ends and the next
begins:

```typescript
/** A day's worth of completed TODOs, for the history view. */
export interface TodoHistoryDay {
  /** Local `YYYY-MM-DD` the items were ticked off, not the day they were filed. */
  readonly day: string
  readonly todos: readonly Todo[]
}
```

`TodoService.build()` constructs it from every completed TODO whose **completion
day** is earlier than today:

- The key is the local day of `completedAt`, not `todo.day`. Something filed on
  Monday and ticked on Wednesday belongs under Wednesday, because the question
  being answered is "what did I get done", not "what was this filed against".
- Items completed today are excluded. They are already visible in `current`, and
  showing them twice would make the counts disagree.
- Days are ordered most recent first. Items within a day are ordered by
  `completedAt` descending, so the last thing ticked reads first.
- Privacy mode applies through the same `redact()` the other groups use. A
  screen recording of history shows `Task`, exactly as the live list does.

`completedAt` is an ISO instant, so the day key comes from
`toLocalDayKey(new Date(todo.completedAt))` rather than from slicing the string.
Slicing would bucket by UTC and put anything ticked after early evening on the
wrong day for most of the year.

### Renderer

The TODO section header gains a small history button. Pressing it replaces the
list with history **in the same space**: the widget does not grow, because it
floats over the user's work and changing its height while they are reading is
hostile. The header shows a way back.

History renders as a flat sequence of day headings and titles. No checkboxes, no
roll affordance, no delete — nothing in it is a click target. An empty state
covers the case where nothing has been completed before today.

Whether history is showing is renderer-local component state. It is not a
setting, is not persisted, and does not survive the widget being hidden and
shown again: the expected use is to open it, read the update out, and close it.

## Testing

`TodoService`:

- An item completed yesterday appears in `history` and in none of the other
  groups.
- An item filed on one day and completed on a later day is bucketed under the
  completion day.
- An item completed today appears in `current` and not in `history`.
- An incomplete item from a past day stays in `overdue` and never reaches
  `history`.
- Days are ordered most recent first; items within a day are ordered by
  `completedAt` descending.
- Privacy mode redacts history titles.
- Day bucketing uses local time, verified with a `completedAt` late enough in
  the day that UTC and local disagree.

Renderer:

- The history button swaps the view and the back affordance restores it.
- History renders no interactive controls.
- The empty state shows when there is no history.

## Documentation to update

- `docs/spec.md` §6 for the widget's TODO section, and the `TodoSnapshot` shape
  wherever §5 describes it.
- Nothing on the website. Retention is unchanged, no new data is stored, and
  nothing new leaves the machine, so the privacy policy and security overview
  stay as they are.
