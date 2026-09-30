import { todoSchema } from '../../shared/ipc/contract.ts'
import { MAX_TODOS, TODO_COMPLETED_RETENTION_DAYS } from '../../shared/constants.ts'
import { addLocalDays } from '../../shared/time.ts'
import type { Todo } from '../../shared/types/todo.ts'

/**
 * The persisted shape of the TODO list (docs/spec.md §8.2).
 *
 * Deliberately its own file rather than a field in `settings.json`: a bug in
 * something added this late must not be able to cost the user their accounts.
 */
// A type alias, not an interface: electron-store's generic is constrained to
// Record<string, any>, which only structural type aliases satisfy.
export type PersistedTodos = {
  schemaVersion: number
  todos: Todo[]
}

export const CURRENT_TODO_SCHEMA_VERSION = 1

export const DEFAULT_TODO_STATE: PersistedTodos = {
  schemaVersion: CURRENT_TODO_SCHEMA_VERSION,
  todos: [],
}

/** Every field a stored row may carry, with the value used when it is absent. */
const TODO_FALLBACKS: Readonly<Record<keyof Todo, unknown>> = {
  id: '',
  title: '',
  day: '',
  createdAt: '',
  completedAt: null,
  rollCount: 0,
}

/**
 * One unreadable row must not cost the user the rest of the list, so rows are
 * parsed individually and bad ones are dropped rather than failing the file.
 */
export function parseTodos(candidate: unknown): Todo[] {
  if (typeof candidate !== 'object' || candidate === null) {
    return []
  }

  const stored = (candidate as Readonly<Record<string, unknown>>)['todos']
  if (!Array.isArray(stored)) {
    return []
  }

  const seen = new Set<string>()
  const todos: Todo[] = []
  for (const row of stored) {
    const todo = parseTodo(row)
    if (!todo || seen.has(todo.id)) {
      continue
    }
    seen.add(todo.id)
    todos.push(todo)
    if (todos.length >= MAX_TODOS) {
      break
    }
  }
  return todos
}

/** Keeps the file from growing without bound once things are ticked off. */
export function pruneCompleted(todos: readonly Todo[], today: string): Todo[] {
  const cutoff = addLocalDays(today, -TODO_COMPLETED_RETENTION_DAYS)
  return todos.filter((todo) => todo.completedAt === null || todo.day >= cutoff)
}

function parseTodo(row: unknown): Todo | null {
  if (typeof row !== 'object' || row === null) {
    return null
  }

  const stored = row as Readonly<Record<string, unknown>>
  const known: Record<string, unknown> = { ...TODO_FALLBACKS }
  for (const key of Object.keys(TODO_FALLBACKS)) {
    if (key in stored) {
      known[key] = stored[key]
    }
  }

  const result = todoSchema.safeParse(known)
  return result.success ? result.data : null
}
