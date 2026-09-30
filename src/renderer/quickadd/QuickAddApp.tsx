import { useCallback, useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { MAX_TODO_TITLE_LENGTH } from '../../shared/constants.ts'
import type { TodoSnapshot } from '../../shared/types/todo.ts'
import { onTodos, quickAddApi } from '../common/lib/ipcClient.ts'

/**
 * One field, one decision (docs/spec.md §6).
 *
 * Enter files it and gets out of the way; Cmd+Enter keeps the box open for a
 * run of them.
 *
 * Dictation is the system's, and deliberately not wired up here: macOS owns
 * the trigger, whatever the user has set it to, and the caret being in a real
 * focused field is the whole reason it works at all.
 */
export function QuickAddApp(): JSX.Element {
  const [title, setTitle] = useState('')
  const [snapshot, setSnapshot] = useState<TodoSnapshot | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return onTodos(quickAddApi(), setSnapshot)
  }, [])

  // The window is hidden rather than destroyed, so each reopen has to reset
  // the field itself.
  useEffect(() => {
    const onWindowFocus = (): void => {
      setTitle('')
      input.current?.focus()
    }
    window.addEventListener('focus', onWindowFocus)
    return () => {
      window.removeEventListener('focus', onWindowFocus)
    }
  }, [])

  const submit = useCallback(
    (keepOpen: boolean) => {
      const trimmed = title.trim()
      if (trimmed.length === 0) {
        return
      }
      void quickAddApi().addTodo(trimmed)
      setTitle('')
      if (!keepOpen) {
        void quickAddApi().close()
      }
    },
    [title],
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        void quickAddApi().close()
        return
      }
      if (event.key === 'Enter') {
        submit(event.metaKey)
      }
    },
    [submit],
  )

  const remaining = snapshot
    ? snapshot.overdue.length + snapshot.current.filter((todo) => !todo.completedAt).length
    : 0

  return (
    <div className="drag-region flex h-full flex-col justify-center gap-1.5 rounded-lg border border-border bg-bg px-4 py-3">
      <input
        ref={input}
        // The window exists for this one field; landing anywhere else is a bug.
        autoFocus
        type="text"
        value={title}
        maxLength={MAX_TODO_TITLE_LENGTH}
        placeholder="What needs doing?"
        aria-label="New TODO"
        onChange={(event) => {
          setTitle(event.target.value)
        }}
        onKeyDown={onKeyDown}
        className="no-drag w-full border-none bg-transparent text-base text-text outline-none select-text placeholder:text-text-muted"
      />
      <div className="flex justify-between text-[10px] text-text-muted">
        {/* The dictation trigger belongs to macOS and is often reassigned, so
            it is described rather than named. */}
        <span title="Set the trigger in System Settings › Keyboard › Dictation">
          Enter to add · Cmd+Enter to keep going · dictation types here
        </span>
        <span className="tabular">{remaining > 0 ? `${remaining} outstanding` : ''}</span>
      </div>
    </div>
  )
}
