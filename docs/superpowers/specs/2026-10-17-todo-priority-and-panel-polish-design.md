# TODO priority, and two panel fixes

Three changes to the widget, grouped because they all touch the panel's
surface and would otherwise be three separate passes over the same files.

1. TODOs can be ranked by hand.
2. The title bar gets a card, so it is legible over busy windows.
3. An empty day stops spending the whole widget on empty grid.

## 1. Ranking TODOs by hand

### What the user gets

Two chevrons appear at the right of a TODO row on hover and move it up or
down within its group. Top means most important, because that is what
everyone already assumes a list means.

This is not a new idiom in this panel. `TodoRow` already reveals a roll
arrow and a delete cross on hover, in the same place, with the same
`opacity-0 group-hover:opacity-100` treatment. The chevrons join them.

### The rank field

`Todo` gains `readonly rank: number`.

Rank lives on the item rather than in a separate ordering array, so it
survives every operation that already moves items between groups. An item
ranked above its neighbours today is still above them after it rolls to
tomorrow, which is the behaviour a user who bothered to rank it expects.
A separate array would have to be reconciled on every add, roll, prune and
privacy redaction, and each of those is a place for the two to drift.

Ranks are spaced by `RANK_GAP = 1000`. Inserting between two items takes the
midpoint of its new neighbours and writes one item, so reordering is O(1) in
writes rather than renumbering the list. When two neighbours are adjacent
integers there is no midpoint left, and the group is renumbered from zero in
its current order before the move is applied. With `MAX_TODOS` items and a
gap of 1000 this is reachable only after roughly ten reorders between the
same pair, so it is rare, but it is handled rather than left to produce a
silently ignored move.

### Migration

`TODO_FALLBACKS` in `todoSchema.ts` gains `rank: 0`, and the contract's
`todoSchema` gains `rank: z.number()`.

A stored list written before this change has no `rank`, so every row would
fall back to 0 and the order would be whatever the file happened to hold.
`parseTodos` therefore assigns ranks to any row that arrived without one,
spaced by `RANK_GAP`, **in the order the rows already sort by `createdAt`** —
which is the order the user last saw. The upgrade is invisible: the list
opens exactly as it closed.

Rows that arrive with a `rank` keep it. This is not a schema version bump,
because nothing about the file becomes unreadable to an older build: an
older build ignores the unknown field, having no entry for it in
`TODO_FALLBACKS`.

### Sorting

`byUrgency` in `TodoService` sorts by `rank` ascending instead of by
`createdAt`. Completed items still sink to the bottom of their group,
ordered among themselves by `completedAt`; ticking something off moves it
out of the ranked run, so done work never sits between ranked items.

Sorting is per group. `overdue` and `current` are ranked independently and
the two blocks stay separate, because an overdue item is late whatever its
rank and merging the groups would hide that. `upcoming` is rendered as a
count, so its order is not observable.

A new TODO is appended with the highest rank in the list plus `RANK_GAP`, so
it lands at the bottom: a thing you have just typed is unranked until you
rank it.

### IPC

One new channel, `todos:reorder`, carrying:

```ts
export const reorderTodoSchema = z.strictObject({
  todoId: identifier,
  /** The item it should sit immediately after; null means first in its group. */
  afterId: identifier.nullable(),
})
```

A neighbour id rather than a target index. An index computed in the renderer
is stale as soon as a sync, a midnight regroup or the other window changes
the list, and acting on a stale index silently moves the wrong row. A
neighbour id either still exists, in which case the intent is unambiguous,
or it does not, in which case main drops the request rather than guessing.

`CHANNEL_CALLERS` gives it `['widget']` only. Quick-add can add a TODO and
nothing else, and reordering from a window with no list on screen is not a
capability it needs.

Main resolves `afterId`, confirms both items are in the same group, and
computes the new rank. A request naming two items from different groups, or
an id that no longer exists, is dropped and logged without its payload, the
same as any other request main cannot satisfy.

### What is deliberately not built

No drag and drop. The rows are 20px in a panel 260px wide at its minimum,
which makes a drag handle a mis-click generator, and the widget is
`acceptFirstMouse` over other applications where a mis-drag moves the window
instead. Chevrons are precise.

No priority levels, flags or colours. The user asked for ordering; a second
axis of importance on top of an explicit order is two things to keep in
agreement.

## 2. The title bar gets a card

The title bar is the only part of the widget still sitting on bare glass.
Every other section was given a card in the redesign, and the result is that
the one strip without one is the least readable part of the panel: over a
chat window, the text behind it shows through next to the date.

`TitleBar` gets the same `card mx-3` treatment as the other sections, with
`mt-2` instead of the panel's own top padding.

The drag region moves onto the card. The margin around it stays part of the
window's draggable area, so the grabbable region does not shrink — it
changes shape, not size.

## 3. An empty day collapses

When a day has no timed events and no all-day events, the timeline is
currently drawn in full: hour lines, half-hour lines, both gutter columns and
a "Nothing scheduled today" message floating in the middle of several hundred
pixels of empty grid.

In that state `WidgetApp` renders a short card containing the message instead
of `DayTimeline`, and drops `flex-1` from it so it takes only the height it
needs. The TODO panel's `max-h-[45%]` cap is lifted in the same state, so the
reclaimed space goes to the list.

The window is not resized. Resizing would mean the widget changed size
whenever the last meeting of the day was cancelled, which is movement in
peripheral vision caused by something the user did not do.

`EmptyState` already renders the message and needs no change.

## Testing

| Unit                                                                 | Covered by                                 |
| -------------------------------------------------------------------- | ------------------------------------------ |
| `rankFor(before, after)` midpoint and renumber-on-exhaustion         | unit tests, pure function                  |
| `parseTodos` assigning ranks to a pre-rank file in `createdAt` order | unit test against a fixture with no `rank` |
| `parseTodos` preserving ranks that are present                       | unit test                                  |
| `byUrgency` ordering by rank with completed sunk                     | unit test                                  |
| `TodoService.add` appending at the highest rank                      | unit test                                  |
| `TodoService.reorder` rejecting a cross-group or unknown `afterId`   | unit test                                  |
| `reorderTodoSchema` rejecting a payload with extra keys              | contract test                              |

The title bar card and the empty-day collapse are visual and get no unit
test. A test asserting on class names would pass just as happily with the
broken markup, which is exactly how the timeline scroll bug in 0.5.0 reached
a release. Both are checked by measuring the running widget over the Chrome
DevTools Protocol instead.

## Risks

**The renumber path is the one that can corrupt order.** It rewrites every
item in a group. It is covered by a unit test, and it runs inside the same
`commit` as any other mutation, so a failure leaves the stored list
untouched rather than half-renumbered.

**Lifting the TODO cap on an empty day re-enters the height chain that broke
twice during the redesign.** `max-h-[45%]` needs a parent with a definite
height; the empty-day card must not become a block container, or the TODO
panel will take the whole widget. Verified by measurement, not by reading.
