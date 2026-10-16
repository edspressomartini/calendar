import { randomUUID } from 'node:crypto'
import {
  MAX_TODOS,
  MAX_TODO_TITLE_LENGTH,
  PRIVACY_PLACEHOLDER_TODO_TITLE,
} from '../../shared/constants.ts'
import { addLocalDays, toLocalDayKey } from '../../shared/time.ts'
import type { Todo, TodoHistoryDay, TodoSnapshot } from '../../shared/types/todo.ts'
import { Signal } from '../infra/Signal.ts'
import type { AppLogger } from '../infra/logger.ts'
import { pruneCompleted } from '../storage/todoSchema.ts'
import type { SettingsReader } from '../storage/SettingsStore.ts'
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
 *
 * Privacy mode is applied here, for the same reason meeting titles are: what
 * a screen recorder can capture is whatever reached the renderer (§8.4).
 */
export class TodoService {
  readonly changed = new Signal<TodoSnapshot>()

  private snapshot: TodoSnapshot

  constructor(
    private readonly store: TodoWriter,
    private readonly settings: SettingsReader,
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
    const hideTitles = this.settings.getSettings().privacyMode
    const group = (matches: (todo: Todo) => boolean): Todo[] =>
      byUrgency(todos.filter(matches)).map((todo) => (hideTitles ? redact(todo) : todo))

    return {
      today,
      overdue: group((todo) => isOverdue(todo, today)),
      current: group((todo) => todo.day === today),
      upcoming: group((todo) => todo.day > today),
      history: buildHistory(todos, today, hideTitles),
    }
  }
}

/**
 * Completed TODOs from before today, newest day first (§6).
 *
 * Bucketed by when the work was ticked off, not by the day it was filed under:
 * something added on Monday and finished on Wednesday belongs to Wednesday,
 * because this is what the user reads out as "what I got done". Today's
 * completions are left out because `current` already shows them, and listing
 * them twice would make the two disagree.
 */
function buildHistory(
  todos: readonly Todo[],
  today: string,
  hideTitles: boolean,
): readonly TodoHistoryDay[] {
  const byDay = new Map<string, Todo[]>()

  for (const todo of todos) {
    if (todo.completedAt === null) {
      continue
    }
    // From the instant, not from slicing the string: an ISO timestamp is UTC,
    // so slicing would file anything ticked off late in the evening under
    // tomorrow for anyone east of Greenwich.
    const day = toLocalDayKey(new Date(todo.completedAt))
    if (day >= today) {
      continue
    }
    const existing = byDay.get(day)
    if (existing) {
      existing.push(todo)
      continue
    }
    byDay.set(day, [todo])
  }

  return [...byDay.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([day, items]) => ({
      day,
      todos: items
        .sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''))
        .map((todo) => (hideTitles ? redact(todo) : todo)),
    }))
}

/** The id is what the renderer acts on, so hiding the text costs nothing. */
function redact(todo: Todo): Todo {
  return { ...todo, title: PRIVACY_PLACEHOLDER_TODO_TITLE }
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
