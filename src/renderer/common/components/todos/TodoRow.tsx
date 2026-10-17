import type { JSX } from 'react'
import type { Todo } from '../../../../shared/types/todo.ts'

interface TodoRowProps {
  readonly todo: Todo
  /** How many days late it is; zero for anything filed under today or later. */
  readonly daysLate: number
  readonly onToggle: (todoId: string) => void
  readonly onRoll: (todoId: string) => void
  readonly onRemove: (todoId: string) => void
  /** Null at the ends of the group, which disables the chevron rather than hiding it. */
  readonly onMoveUp: (() => void) | null
  readonly onMoveDown: (() => void) | null
}

/**
 * One line, click targets only (docs/spec.md §6). The widget never takes
 * keyboard focus, so nothing here may depend on typing.
 */
export function TodoRow({
  todo,
  daysLate,
  onToggle,
  onRoll,
  onRemove,
  onMoveUp,
  onMoveDown,
}: TodoRowProps): JSX.Element {
  const done = todo.completedAt !== null

  return (
    <li className="group flex items-center gap-1.5 px-3 py-0.5 text-body">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
        onClick={() => {
          onToggle(todo.id)
        }}
        className={`no-drag flex size-3.5 shrink-0 items-center justify-center rounded-sm border text-micro ${
          done ? 'border-accent bg-accent/20 text-accent' : 'border-border hover:border-accent'
        }`}
      >
        {done ? '✓' : ''}
      </button>

      <span
        className={`min-w-0 flex-1 truncate ${done ? 'text-text-muted line-through' : ''}`}
        title={todo.title}
      >
        {todo.title}
      </span>

      {daysLate > 0 && !done && (
        <span className="tabular shrink-0 font-mono text-micro text-urgent">{daysLate}d</span>
      )}

      {/* Disabled rather than absent at the ends of the group: a chevron that
          vanishes shifts every other control under the cursor mid-hover. */}
      {!done && (
        <>
          <MoveButton direction="up" onMove={onMoveUp} />
          <MoveButton direction="down" onMove={onMoveDown} />
        </>
      )}

      {!done && (
        <button
          type="button"
          onClick={() => {
            onRoll(todo.id)
          }}
          title={daysLate > 0 ? 'Move to today' : 'Move to tomorrow'}
          className="no-drag shrink-0 rounded px-1 text-text-muted opacity-0 group-hover:opacity-100 hover:bg-bg-subtle hover:text-accent"
        >
          →
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          onRemove(todo.id)
        }}
        title="Delete"
        className="no-drag shrink-0 rounded px-1 text-text-muted opacity-0 group-hover:opacity-100 hover:bg-bg-subtle hover:text-urgent"
      >
        ×
      </button>
    </li>
  )
}

const MOVE_LABEL = {
  up: { glyph: '▲', title: 'More important' },
  down: { glyph: '▼', title: 'Less important' },
} as const

function MoveButton({
  direction,
  onMove,
}: {
  direction: 'up' | 'down'
  onMove: (() => void) | null
}): JSX.Element {
  const { glyph, title } = MOVE_LABEL[direction]

  return (
    <button
      type="button"
      disabled={onMove === null}
      onClick={onMove ?? undefined}
      title={title}
      className="no-drag shrink-0 rounded px-0.5 text-micro text-text-muted opacity-0 group-hover:opacity-100 hover:bg-bg-subtle hover:text-accent disabled:opacity-0 disabled:group-hover:opacity-25 disabled:hover:bg-transparent disabled:hover:text-text-muted"
    >
      {glyph}
    </button>
  )
}
