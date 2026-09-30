import { beforeEach, describe, expect, it } from 'vitest'
import { TodoService } from '../../src/main/agenda/TodoService.ts'
import { DEFAULT_SETTINGS } from '../../src/main/storage/schema.ts'
import type { SettingsReader } from '../../src/main/storage/SettingsStore.ts'
import type { TodoWriter } from '../../src/main/storage/TodoStore.ts'
import type { AppLogger } from '../../src/main/infra/logger.ts'
import type { AppSettings } from '../../src/shared/types/settings.ts'
import type { Todo, TodoSnapshot } from '../../src/shared/types/todo.ts'

/**
 * Rolling forward is the whole point of the feature, and midnight is the one
 * moment it must not happen by itself (docs/spec.md §6).
 */

class InMemoryTodoStore implements TodoWriter {
  constructor(private todos: readonly Todo[] = []) {}

  getTodos(): readonly Todo[] {
    return this.todos
  }

  setTodos(todos: readonly Todo[]): readonly Todo[] {
    this.todos = todos
    return todos
  }
}

const silentLogger: AppLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
}

let now = new Date(2026, 8, 30, 9, 0)

function readerFor(settings: AppSettings): SettingsReader {
  return { getSettings: () => settings }
}

function serviceWith(
  todos: readonly Todo[] = [],
  settings: AppSettings = DEFAULT_SETTINGS,
): {
  service: TodoService
  store: InMemoryTodoStore
} {
  const store = new InMemoryTodoStore(todos)
  return {
    service: new TodoService(store, readerFor(settings), silentLogger, () => now),
    store,
  }
}

function todoOn(day: string, id: string, overrides: Partial<Todo> = {}): Todo {
  return {
    id,
    title: id,
    day,
    createdAt: `${day}T08:00:00.000Z`,
    completedAt: null,
    rollCount: 0,
    ...overrides,
  }
}

beforeEach(() => {
  now = new Date(2026, 8, 30, 9, 0)
})

describe('adding', () => {
  it('files a new TODO under the day it was added', () => {
    const { service } = serviceWith()

    const snapshot = service.add('  Call the bank  ')

    expect(snapshot.current).toHaveLength(1)
    expect(snapshot.current[0]?.title).toBe('Call the bank')
    expect(snapshot.current[0]?.day).toBe('2026-09-30')
  })

  it('persists, so a restart keeps the list', () => {
    const { service, store } = serviceWith()

    service.add('Call the bank')

    expect(store.getTodos()).toHaveLength(1)
  })

  it('emits a snapshot, which is how both windows find out', () => {
    const { service } = serviceWith()
    const seen: TodoSnapshot[] = []
    service.changed.subscribe((snapshot) => seen.push(snapshot))

    service.add('Call the bank')

    expect(seen).toHaveLength(1)
    expect(seen[0]?.current).toHaveLength(1)
  })
})

describe('grouping', () => {
  it('separates what was left behind from what is filed under today', () => {
    const { service } = serviceWith([
      todoOn('2026-09-28', 'old'),
      todoOn('2026-09-30', 'today'),
      todoOn('2026-10-02', 'later'),
    ])

    const snapshot = service.getSnapshot()

    expect(snapshot.overdue.map((todo) => todo.id)).toEqual(['old'])
    expect(snapshot.current.map((todo) => todo.id)).toEqual(['today'])
    expect(snapshot.upcoming.map((todo) => todo.id)).toEqual(['later'])
  })

  it('does not call a finished item overdue', () => {
    const { service } = serviceWith([
      todoOn('2026-09-28', 'old', { completedAt: '2026-09-28T10:00:00.000Z' }),
    ])

    expect(service.getSnapshot().overdue).toHaveLength(0)
  })

  it('sinks what is done below what is not', () => {
    const { service } = serviceWith([
      todoOn('2026-09-30', 'done', { completedAt: '2026-09-30T08:30:00.000Z' }),
      todoOn('2026-09-30', 'outstanding'),
    ])

    expect(service.getSnapshot().current.map((todo) => todo.id)).toEqual(['outstanding', 'done'])
  })

  it('regroups when the day turns, without rewriting anything', () => {
    const { service, store } = serviceWith([todoOn('2026-09-30', 'today')])
    now = new Date(2026, 9, 1, 0, 1)

    const snapshot = service.refresh()

    expect(snapshot.overdue.map((todo) => todo.id)).toEqual(['today'])
    expect(store.getTodos()[0]?.day).toBe('2026-09-30')
    expect(store.getTodos()[0]?.rollCount).toBe(0)
  })
})

describe('rolling forward', () => {
  it('moves today onto tomorrow', () => {
    const { service } = serviceWith([todoOn('2026-09-30', 'today')])

    const snapshot = service.roll('today')

    expect(snapshot.upcoming[0]?.day).toBe('2026-10-01')
    expect(snapshot.upcoming[0]?.rollCount).toBe(1)
  })

  it('brings something long overdue to today rather than to the day after it was due', () => {
    const { service } = serviceWith([todoOn('2026-09-01', 'ancient')])

    const snapshot = service.roll('ancient')

    expect(snapshot.current[0]?.day).toBe('2026-09-30')
  })

  it('leaves a completed item where it is', () => {
    const completed = todoOn('2026-09-28', 'done', { completedAt: '2026-09-28T10:00:00.000Z' })
    const { service, store } = serviceWith([completed])

    service.roll('done')

    expect(store.getTodos()[0]?.day).toBe('2026-09-28')
  })

  it('collects every overdue item onto today in one go', () => {
    const { service } = serviceWith([
      todoOn('2026-09-20', 'a'),
      todoOn('2026-09-29', 'b'),
      todoOn('2026-09-30', 'c'),
    ])

    const snapshot = service.rollAllOverdue()

    expect(snapshot.overdue).toHaveLength(0)
    expect(snapshot.current.map((todo) => todo.id)).toEqual(['a', 'b', 'c'])
    // Today's own item is untouched, so "roll all" cannot push work away.
    expect(snapshot.upcoming).toHaveLength(0)
  })
})

describe('privacy mode', () => {
  const privately: AppSettings = { ...DEFAULT_SETTINGS, privacyMode: true }

  it('replaces titles before they reach the renderer, in every group', () => {
    const { service } = serviceWith(
      [todoOn('2026-09-28', 'old'), todoOn('2026-09-30', 'today'), todoOn('2026-10-02', 'later')],
      privately,
    )

    const snapshot = service.getSnapshot()

    expect(snapshot.overdue[0]?.title).toBe('Task')
    expect(snapshot.current[0]?.title).toBe('Task')
    expect(snapshot.upcoming[0]?.title).toBe('Task')
  })

  it('leaves the stored text alone, so turning it off restores the list', () => {
    const { service, store } = serviceWith([todoOn('2026-09-30', 'today')], privately)

    service.toggle('today')

    expect(store.getTodos()[0]?.title).toBe('today')
  })

  it('keeps the id, which is what the widget acts on', () => {
    const { service } = serviceWith([todoOn('2026-09-30', 'today')], privately)

    expect(service.getSnapshot().current[0]?.id).toBe('today')
  })
})

describe('completing and removing', () => {
  it('ticks and unticks the same item', () => {
    const { service } = serviceWith([todoOn('2026-09-30', 'today')])

    expect(service.toggle('today').current[0]?.completedAt).not.toBeNull()
    expect(service.toggle('today').current[0]?.completedAt).toBeNull()
  })

  it('removes only the item asked for', () => {
    const { service } = serviceWith([todoOn('2026-09-30', 'a'), todoOn('2026-09-30', 'b')])

    const snapshot = service.remove('a')

    expect(snapshot.current.map((todo) => todo.id)).toEqual(['b'])
  })

  it('ignores an id it has never seen, since the renderer is not trusted', () => {
    const { service } = serviceWith([todoOn('2026-09-30', 'a')])

    expect(service.toggle('nonsense').current).toHaveLength(1)
    expect(service.remove('nonsense').current).toHaveLength(1)
    expect(service.roll('nonsense').current).toHaveLength(1)
  })
})
