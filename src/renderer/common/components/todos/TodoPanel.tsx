import { useState, type JSX } from 'react'
import { formatAccelerator } from '../../../../shared/shortcuts.ts'
import { daysBetweenDayKeys } from '../../../../shared/time.ts'
import type { Todo, TodoHistoryDay, TodoSnapshot } from '../../../../shared/types/todo.ts'
import { formatDayKeyLabel } from '../../lib/formatTime.ts'
import { TodoRow } from './TodoRow.tsx'

interface TodoPanelProps {
  readonly snapshot: TodoSnapshot | null
  readonly shortcut: string
  /** Set when the timeline is hidden; see the call site for why it matters. */
  readonly compact: boolean
  /** Set when the timeline has collapsed because the day is clear. */
  readonly uncapped: boolean
  readonly onToggle: (todoId: string) => void
  readonly onRoll: (todoId: string) => void
  readonly onRollAllOverdue: () => void
  readonly onRemove: (todoId: string) => void
  readonly onReorder: (todoId: string, afterId: string | null) => void
  readonly onChangeShortcut: () => void
}

/**
 * The day's TODOs, under the timeline (docs/spec.md §6).
 *
 * Two groups only: what was left behind, and what is filed under today.
 * Anything rolled past today is reduced to a count, so deferring something
 * never makes it disappear without trace.
 *
 * History swaps into the same space rather than expanding below it. The panel
 * floats over the user's work, so growing it while they are reading is
 * hostile, and the two views are never wanted at once.
 */
export function TodoPanel({
  snapshot,
  shortcut,
  compact,
  uncapped,
  onToggle,
  onRoll,
  onRollAllOverdue,
  onRemove,
  onReorder,
  onChangeShortcut,
}: TodoPanelProps): JSX.Element | null {
  const [collapsed, setCollapsed] = useState(false)
  // Transient on purpose: you open history, read your update out, and leave.
  // Persisting it would mean reopening the widget onto yesterday's work.
  const [showingHistory, setShowingHistory] = useState(false)

  if (!snapshot) {
    return null
  }

  const outstanding =
    snapshot.overdue.length + snapshot.current.filter((todo) => todo.completedAt === null).length
  const isEmpty = snapshot.overdue.length + snapshot.current.length + snapshot.upcoming.length === 0

  // The card sits on this element rather than on a wrapper around it:
  // max-h-[45%] needs a parent with a definite height, and a wrapper sized to
  // its own content gives the percentage nothing to resolve against.
  return (
    <section
      className={`card mx-3 mb-2 flex flex-col overflow-hidden ${
        uncapped ? 'min-h-0 flex-1' : `shrink-0 ${compact ? 'max-h-60' : 'max-h-[45%]'}`
      }`}
    >
      <header className="flex items-center gap-2 px-3 py-1">
        <button
          type="button"
          onClick={() => {
            setCollapsed((current) => !current)
          }}
          aria-expanded={!collapsed}
          className="no-drag flex min-w-0 flex-1 items-center gap-1.5 text-left text-small font-semibold tracking-widest text-text-muted uppercase hover:text-text"
        >
          <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
          <span>{showingHistory ? 'Done earlier' : 'Todo'}</span>
          {!showingHistory && outstanding > 0 && (
            <span className="tabular font-mono">{outstanding}</span>
          )}
        </button>

        {!collapsed && (
          <button
            type="button"
            aria-pressed={showingHistory}
            title={showingHistory ? 'Back to today' : 'What you ticked off before today'}
            onClick={() => {
              setShowingHistory((current) => !current)
            }}
            className={`no-drag shrink-0 rounded px-1 text-small hover:bg-bg-subtle hover:text-accent ${
              showingHistory ? 'text-accent' : 'text-text-muted'
            }`}
          >
            {showingHistory ? 'Back' : 'History'}
          </button>
        )}

        {!showingHistory && (
          <span className="shrink-0 text-small text-text-muted" title="Opens the quick add box">
            {formatAccelerator(shortcut)}
          </span>
        )}
      </header>

      {!collapsed && showingHistory && <TodoHistory days={snapshot.history} />}

      {!collapsed && !showingHistory && (
        <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto pb-1">
          {isEmpty && (
            <div className="flex flex-col gap-1 px-3 py-1 text-body text-text-muted">
              <span>
                Nothing on the list. Press {formatAccelerator(shortcut)} anywhere to add something.
              </span>
              <button
                type="button"
                onClick={onChangeShortcut}
                className="no-drag self-start text-accent hover:underline"
              >
                Change the shortcut
              </button>
            </div>
          )}

          {snapshot.overdue.length > 0 && (
            <GroupHeading label="Earlier">
              <button
                type="button"
                onClick={onRollAllOverdue}
                className="no-drag rounded px-1 text-small text-text-muted hover:bg-bg-subtle hover:text-accent"
              >
                Roll all to today
              </button>
            </GroupHeading>
          )}
          <TodoList
            todos={snapshot.overdue}
            today={snapshot.today}
            onToggle={onToggle}
            onRoll={onRoll}
            onRemove={onRemove}
            onReorder={onReorder}
          />

          {snapshot.overdue.length > 0 && snapshot.current.length > 0 && (
            <GroupHeading label="Today" />
          )}
          <TodoList
            todos={snapshot.current}
            today={snapshot.today}
            onToggle={onToggle}
            onRoll={onRoll}
            onRemove={onRemove}
            onReorder={onReorder}
          />

          {snapshot.upcoming.length > 0 && (
            <p className="px-3 pt-1 text-small text-text-muted">
              {snapshot.upcoming.length} rolled to a later day
            </p>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * Read-only by design. Nothing here is a click target: history that changes
 * while you are reading it out is confusing, and the live list is one button
 * away for anything that needs correcting.
 */
function TodoHistory({ days }: { days: readonly TodoHistoryDay[] }): JSX.Element {
  if (days.length === 0) {
    return (
      <p className="px-3 py-1 text-body text-text-muted">
        Nothing finished before today yet. Completed items stay here for 30 days.
      </p>
    )
  }

  return (
    <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto pb-1">
      {days.map((entry) => (
        <section key={entry.day}>
          <GroupHeading label={formatDayKeyLabel(entry.day)} />
          <ul>
            {entry.todos.map((todo) => (
              <li
                key={todo.id}
                className="truncate px-3 py-0.5 text-body text-text-muted"
                title={todo.title}
              >
                {todo.title}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function GroupHeading({ label, children }: { label: string; children?: JSX.Element }): JSX.Element {
  return (
    <div className="flex items-center gap-2 px-3 pt-1">
      <span className="text-small font-medium text-text-muted">{label}</span>
      <span className="h-px flex-1 bg-border" />
      {children}
    </div>
  )
}

function TodoList({
  todos,
  today,
  onToggle,
  onRoll,
  onRemove,
  onReorder,
}: {
  todos: readonly Todo[]
  today: string
  onToggle: (todoId: string) => void
  onRoll: (todoId: string) => void
  onRemove: (todoId: string) => void
  onReorder: (todoId: string, afterId: string | null) => void
}): JSX.Element | null {
  if (todos.length === 0) {
    return null
  }

  // Only what is still outstanding is ranked. Completed items have already
  // sunk below this run, so including them would offer a move into a part of
  // the list the sort is about to undo.
  const rankable = todos.filter((todo) => todo.completedAt === null)

  return (
    <ul>
      {todos.map((todo) => {
        const position = rankable.indexOf(todo)

        return (
          <TodoRow
            key={todo.id}
            todo={todo}
            daysLate={Math.max(0, daysBetweenDayKeys(todo.day, today))}
            onToggle={onToggle}
            onRoll={onRoll}
            onRemove={onRemove}
            onMoveUp={moveHandler(rankable, position, -1, onReorder)}
            onMoveDown={moveHandler(rankable, position, 1, onReorder)}
          />
        )
      })}
    </ul>
  )
}

/**
 * The move one step in `offset`, expressed as the neighbour to land after, or
 * null when the item is already at that end of its group.
 *
 * Moving up by one means landing after whatever currently precedes the
 * predecessor, which is nothing at all when the item is about to become
 * first — hence the deliberate null rather than an index of -1.
 */
function moveHandler(
  rankable: readonly Todo[],
  position: number,
  offset: -1 | 1,
  onReorder: (todoId: string, afterId: string | null) => void,
): (() => void) | null {
  const target = position + offset
  if (position === -1 || target < 0 || target >= rankable.length) {
    return null
  }

  const afterIndex = offset === -1 ? target - 1 : target
  const after = rankable[afterIndex]
  const todoId = rankable[position]?.id

  if (todoId === undefined) {
    return null
  }

  return () => {
    onReorder(todoId, after?.id ?? null)
  }
}
