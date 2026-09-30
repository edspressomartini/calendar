import { useCallback, useEffect, useState, type JSX } from 'react'
import { SPLIT_VIEW_MIN_WIDTH } from '../../shared/constants.ts'
import { AllDayStrip } from '../common/components/agenda/AllDayStrip.tsx'
import { NextUpBar } from '../common/components/agenda/NextUpBar.tsx'
import { EmptyState } from '../common/components/agenda/EmptyState.tsx'
import { StatusStrip } from '../common/components/chrome/StatusStrip.tsx'
import { TitleBar } from '../common/components/chrome/TitleBar.tsx'
import { TodoPanel } from '../common/components/todos/TodoPanel.tsx'
import { Spinner } from '../common/components/ui/Spinner.tsx'
import { useAgenda } from '../common/hooks/useAgenda.ts'
import { useTodos } from '../common/hooks/useTodos.ts'
import { widgetApi } from '../common/lib/ipcClient.ts'
import { MergedView } from './views/MergedView.tsx'
import { SplitView } from './views/SplitView.tsx'

export function WidgetApp(): JSX.Element {
  const snapshot = useAgenda()
  const todos = useTodos()
  const width = useWindowWidth()
  const [pinned, setPinned] = useState(true)

  const join = useCallback((eventId: string) => {
    void widgetApi().join(eventId)
  }, [])

  const toggleTodo = useCallback((todoId: string) => {
    void widgetApi().toggleTodo(todoId)
  }, [])

  const rollTodo = useCallback((todoId: string) => {
    void widgetApi().rollTodo(todoId)
  }, [])

  const rollAllOverdueTodos = useCallback(() => {
    void widgetApi().rollAllOverdueTodos()
  }, [])

  const removeTodo = useCallback((todoId: string) => {
    void widgetApi().removeTodo(todoId)
  }, [])

  const togglePin = useCallback(() => {
    setPinned((current) => {
      const next = !current
      void widgetApi().setPinned(next)
      return next
    })
  }, [])

  if (!snapshot) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const hasAccounts = snapshot.accounts.length > 0
  // Three narrow columns are unreadable, so split collapses to merged (§6).
  const useSplit = snapshot.viewMode === 'split' && width >= SPLIT_VIEW_MIN_WIDTH && hasAccounts

  const todoPanel = (
    <TodoPanel
      snapshot={todos}
      placement={snapshot.todoPlacement}
      onToggle={toggleTodo}
      onRoll={rollTodo}
      onRollAllOverdue={rollAllOverdueTodos}
      onRemove={removeTodo}
    />
  )

  return (
    <div className="flex h-full flex-col bg-bg">
      <TitleBar
        pinned={pinned}
        privacyMode={snapshot.privacyMode}
        nowIso={snapshot.now}
        onTogglePin={togglePin}
        onHide={() => void widgetApi().hide()}
        onOpenSettings={() => void widgetApi().openSettings()}
      />

      <NextUpBar nextUp={snapshot.nextUp} onJoin={join} />

      <AllDayStrip items={snapshot.allDay} />

      {snapshot.todoPlacement === 'above' && todoPanel}

      {!hasAccounts ? (
        <EmptyState message="No calendars connected yet. Open Settings to add one." />
      ) : useSplit ? (
        <SplitView snapshot={snapshot} onJoin={join} />
      ) : (
        <MergedView snapshot={snapshot} onJoin={join} />
      )}

      {snapshot.todoPlacement === 'below' && todoPanel}

      <StatusStrip
        accounts={snapshot.accounts}
        nowIso={snapshot.now}
        onSync={() => void widgetApi().syncNow()}
      />
    </div>
  )
}

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    const onResize = (): void => {
      setWidth(window.innerWidth)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return width
}
