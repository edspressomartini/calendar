import ElectronStore from 'electron-store'
import type { Todo } from '../../shared/types/todo.ts'
import type { AppLogger } from '../infra/logger.ts'
import {
  CURRENT_TODO_SCHEMA_VERSION,
  DEFAULT_TODO_STATE,
  parseTodos,
  type PersistedTodos,
} from './todoSchema.ts'

/**
 * The read side, so the service can be tested without touching disk.
 */
export interface TodoReader {
  getTodos(): readonly Todo[]
}

export interface TodoWriter extends TodoReader {
  setTodos(todos: readonly Todo[]): readonly Todo[]
}

/**
 * The TODO list on disk, in its own `todos.json` beside the settings
 * (docs/spec.md §8.2). It holds what the user typed and nothing else, so it is
 * covered by the owner-only permissions on the user data directory, not by the
 * token vault.
 */
export class TodoStore implements TodoWriter {
  private readonly store: ElectronStore<PersistedTodos>

  constructor(private readonly logger: AppLogger) {
    this.store = new ElectronStore<PersistedTodos>({
      name: 'todos',
      defaults: DEFAULT_TODO_STATE,
      clearInvalidConfig: true,
    })
    this.migrate()
  }

  getTodos(): readonly Todo[] {
    return parseTodos(this.store.store)
  }

  setTodos(todos: readonly Todo[]): readonly Todo[] {
    this.store.set('todos', [...todos])
    return todos
  }

  private migrate(): void {
    const version = this.store.get('schemaVersion')
    if (version === CURRENT_TODO_SCHEMA_VERSION) {
      return
    }
    this.logger.info('migrating todo store', {
      from: typeof version === 'number' ? version : null,
      to: CURRENT_TODO_SCHEMA_VERSION,
    })
    this.store.set('todos', parseTodos(this.store.store))
    this.store.set('schemaVersion', CURRENT_TODO_SCHEMA_VERSION)
  }
}
