import { useEffect, useState } from 'react'
import type { TodoSnapshot } from '../../../shared/types/todo.ts'
import { onTodos, widgetApi } from '../lib/ipcClient.ts'

/**
 * Subscribes to main's TODO pushes (docs/spec.md §7).
 *
 * As with the agenda, there is no local state to keep in step: every action
 * comes back as a new snapshot, so what is on screen is what is on disk.
 */
export function useTodos(): TodoSnapshot | null {
  const [snapshot, setSnapshot] = useState<TodoSnapshot | null>(null)

  useEffect(() => {
    return onTodos(widgetApi(), setSnapshot)
  }, [])

  return snapshot
}
