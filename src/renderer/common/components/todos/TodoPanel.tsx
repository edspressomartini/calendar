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
  readonly onToggle: (todoId: string) => void
  readonly onRoll: (todoId: string) => void
  readonly onRollAllOverdue: () => void
  readonly onRemove: (todoId: string) => void
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
  onToggle,
  onRoll,
  onRollAllOverdue,
  onRemove,
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
      className={`card mx-3 mb-2 flex shrink-0 flex-col overflow-hidden ${
        compact ? 'max-h-60' : 'max-h-[45%]'
      }`}
    >
      <header className="flex items-center gap-2 px-3 py-1">
        <button
          type="button"
          onClick={() => {
            setCollapsed((current) => !current)
          }}
          aria-expanded={!collapsed}
          className="no-drag flex min-w-0 flex-1 items-center gap-1.5 text-left text-[10px] font-semibold tracking-widest text-text-muted uppercase hover:text-text"
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
            className={`no-drag shrink-0 rounded px-1 text-[10px] hover:bg-bg-subtle hover:text-accent ${
              showingHistory ? 'text-accent' : 'text-text-muted'
            }`}
          >
            {showingHistory ? 'Back' : 'History'}
          </button>
        )}

        {!showingHistory && (
          <span className="shrink-0 text-[10px] text-text-muted" title="Opens the quick add box">
            {formatAccelerator(shortcut)}
          </span>
        )}
      </header>

      {!collapsed && showingHistory && <TodoHistory days={snapshot.history} />}

      {!collapsed && !showingHistory && (
        <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto pb-1">
          {isEmpty && (
            <p className="px-3 py-1 text-[11px] text-text-muted">
              Nothing to do. Press the shortcut to add one.
            </p>
          )}

          {snapshot.overdue.length > 0 && (
            <GroupHeading label="Earlier">
              <button
                type="button"
                onClick={onRollAllOverdue}
                className="no-drag rounded px-1 text-[10px] text-text-muted hover:bg-bg-subtle hover:text-accent"
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
          />

          {snapshot.upcoming.length > 0 && (
            <p className="px-3 pt-1 text-[10px] text-text-muted">
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
      <p className="px-3 py-1 text-[11px] text-text-muted">
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
                className="truncate px-3 py-0.5 text-[11px] text-text-muted"
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
      <span className="text-[10px] font-medium text-text-muted">{label}</span>
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
}: {
  todos: readonly Todo[]
  today: string
  onToggle: (todoId: string) => void
  onRoll: (todoId: string) => void
  onRemove: (todoId: string) => void
}): JSX.Element | null {
  if (todos.length === 0) {
    return null
  }

  return (
    <ul>
      {todos.map((todo) => (
        <TodoRow
          key={todo.id}
          todo={todo}
          daysLate={Math.max(0, daysBetweenDayKeys(todo.day, today))}
          onToggle={onToggle}
          onRoll={onRoll}
          onRemove={onRemove}
        />
      ))}
    </ul>
  )
}
