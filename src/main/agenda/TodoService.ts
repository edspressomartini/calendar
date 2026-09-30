import { randomUUID } from 'node:crypto'
import { MAX_TODOS, MAX_TODO_TITLE_LENGTH } from '../../shared/constants.ts'
import { addLocalDays, toLocalDayKey } from '../../shared/time.ts'
import type { Todo, TodoSnapshot } from '../../shared/types/todo.ts'
import { Signal } from '../infra/Signal.ts'
import type { AppLogger } from '../infra/logger.ts'
import { pruneCompleted } from '../storage/todoSchema.ts'
import type { TodoWriter } from '../storage/TodoStore.ts'

/**
 * The TODO list, grouped against today (docs/spec.md §5, §6).
 *
 * Shaped like AgendaService on purpose: main owns the clock and the grouping,
 * emits a snapshot, and the renderer only ever draws what it is given. Nothing
 * here knows about IPC.
 *
 * Rolling forward is always something the user asks for. Midnight only changes
 * which group an item falls into, never the day it is filed under, so an
 * untouched TODO still shows the day it was actually added.
 */
export class TodoService {
  readonly changed = new Signal<TodoSnapshot>()

  private snapshot: TodoSnapshot

  constructor(
    private readonly store: TodoWriter,
    private readonly logger: AppLogger,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.snapshot = this.build(this.store.getTodos())
  }

  getSnapshot(): TodoSnapshot {
    return this.snapshot
  }

  add(title: string): TodoSnapshot {
    const todos = this.store.getTodos()
    if (todos.length >= MAX_TODOS) {
      this.logger.warn('refused a TODO because the list is full', { count: todos.length })
      return this.snapshot
    }

    const at = this.now()
    const added: Todo = {
      id: randomUUID(),
      title: title.trim().slice(0, MAX_TODO_TITLE_LENGTH),
      day: toLocalDayKey(at),
      createdAt: at.toISOString(),
      completedAt: null,
      rollCount: 0,
    }
    // The title is the user's own words, so it is counted and never logged (§8.7).
    this.logger.info('added a TODO', { count: todos.length + 1 })
    return this.commit([...todos, added])
  }

  toggle(todoId: string): TodoSnapshot {
    const completedAt = this.now().toISOString()
    return this.commit(
      this.store
        .getTodos()
        .map((todo) =>
          todo.id === todoId
            ? { ...todo, completedAt: todo.completedAt === null ? completedAt : null }
            : todo,
        ),
    )
  }

  /** Overdue lands on today; today lands on tomorrow. Completed never moves. */
  roll(todoId: string): TodoSnapshot {
    const today = toLocalDayKey(this.now())
    return this.commit(
      this.store.getTodos().map((todo) => (todo.id === todoId ? rollForward(todo, today) : todo)),
    )
  }

  rollAllOverdue(): TodoSnapshot {
    const today = toLocalDayKey(this.now())
    return this.commit(
      this.store
        .getTodos()
        .map((todo) => (isOverdue(todo, today) ? rollForward(todo, today) : todo)),
    )
  }

  remove(todoId: string): TodoSnapshot {
    return this.commit(this.store.getTodos().filter((todo) => todo.id !== todoId))
  }

  /** Regroups against a new "now" — what midnight needs, and nothing more. */
  refresh(): TodoSnapshot {
    this.snapshot = this.build(this.store.getTodos())
    this.changed.emit(this.snapshot)
    return this.snapshot
  }

  private commit(todos: readonly Todo[]): TodoSnapshot {
    const today = toLocalDayKey(this.now())
    this.store.setTodos(pruneCompleted(todos, today))
    return this.refresh()
  }

  private build(todos: readonly Todo[]): TodoSnapshot {
    const today = toLocalDayKey(this.now())

    return {
      today,
      overdue: byUrgency(todos.filter((todo) => isOverdue(todo, today))),
      current: byUrgency(todos.filter((todo) => todo.day === today)),
      upcoming: byUrgency(todos.filter((todo) => todo.day > today)),
    }
  }
}

function isOverdue(todo: Todo, today: string): boolean {
  return todo.completedAt === null && todo.day < today
}

function rollForward(todo: Todo, today: string): Todo {
  if (todo.completedAt !== null) {
    return todo
  }
  const next = addLocalDays(todo.day, 1)
  return { ...todo, day: next < today ? today : next, rollCount: todo.rollCount + 1 }
}

/** What is still to do comes first, oldest first; what is done sinks. */
function byUrgency(todos: readonly Todo[]): Todo[] {
  return [...todos].sort((left, right) => {
    if ((left.completedAt === null) !== (right.completedAt === null)) {
      return left.completedAt === null ? -1 : 1
    }
    return left.createdAt.localeCompare(right.createdAt)
  })
}
