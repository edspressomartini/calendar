import { useState, type JSX } from 'react'
import { QUICK_ADD_SHORTCUT } from '../../../../shared/constants.ts'
import { daysBetweenDayKeys } from '../../../../shared/time.ts'
import type { TodoPlacement } from '../../../../shared/types/settings.ts'
import type { Todo, TodoSnapshot } from '../../../../shared/types/todo.ts'
import { TodoRow } from './TodoRow.tsx'

interface TodoPanelProps {
  readonly snapshot: TodoSnapshot | null
  readonly placement: TodoPlacement
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
 */
export function TodoPanel({
  snapshot,
  placement,
  onToggle,
  onRoll,
  onRollAllOverdue,
  onRemove,
}: TodoPanelProps): JSX.Element | null {
  const [collapsed, setCollapsed] = useState(false)

  if (!snapshot) {
    return null
  }

  const outstanding =
    snapshot.overdue.length + snapshot.current.filter((todo) => todo.completedAt === null).length
  const isEmpty = snapshot.overdue.length + snapshot.current.length + snapshot.upcoming.length === 0

  return (
    <section
      className={`flex max-h-[45%] shrink-0 flex-col border-border ${
        placement === 'above' ? 'border-b' : 'border-t'
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
          <span>Todo</span>
          {outstanding > 0 && <span className="tabular font-mono">{outstanding}</span>}
        </button>
        <span className="shrink-0 text-[10px] text-text-muted" title="Opens the quick add box">
          {QUICK_ADD_SHORTCUT.replace('Command', '⌘').replace('Shift', '⇧').replaceAll('+', '')}
        </span>
      </header>

      {!collapsed && (
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
