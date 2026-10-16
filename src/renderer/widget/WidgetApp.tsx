import { useCallback, useEffect, useRef, useState, type JSX, type RefObject } from 'react'
import { SPLIT_VIEW_MIN_WIDTH } from '../../shared/constants.ts'
import { AllDayStrip } from '../common/components/agenda/AllDayStrip.tsx'
import { NextUpBar } from '../common/components/agenda/NextUpBar.tsx'
import { EmptyState } from '../common/components/agenda/EmptyState.tsx'
import { StatusStrip } from '../common/components/chrome/StatusStrip.tsx'
import { TitleBar } from '../common/components/chrome/TitleBar.tsx'
import { TodoPanel } from '../common/components/todos/TodoPanel.tsx'
import { Spinner } from '../common/components/ui/Spinner.tsx'
import { useAgenda } from '../common/hooks/useAgenda.ts'
import { useColourScheme } from '../common/hooks/useColourScheme.ts'
import { useTodos } from '../common/hooks/useTodos.ts'
import { widgetApi } from '../common/lib/ipcClient.ts'
import { MergedView } from './views/MergedView.tsx'
import { SplitView } from './views/SplitView.tsx'

export function WidgetApp(): JSX.Element {
  const snapshot = useAgenda()
  const todos = useTodos()
  const width = useWindowWidth()
  const [pinned, setPinned] = useState(true)
  const contentRef = useRef<HTMLDivElement>(null)
  useFitToContent(snapshot?.showTimeline === false, contentRef)
  useColourScheme(snapshot?.colourScheme ?? null)

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

  // Both are sent every time: the channel takes the pair, so there is no state
  // in which main has one of them and not the other.
  const toggleTimeline = useCallback(() => {
    if (!snapshot) {
      return
    }
    void widgetApi().setSections({
      showTimeline: !snapshot.showTimeline,
      showTodos: snapshot.showTodos,
    })
  }, [snapshot])

  const toggleTodos = useCallback(() => {
    if (!snapshot) {
      return
    }
    void widgetApi().setSections({
      showTimeline: snapshot.showTimeline,
      showTodos: !snapshot.showTodos,
    })
  }, [snapshot])

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

  const todoPanel = snapshot.showTodos ? (
    <TodoPanel
      snapshot={todos}
      placement={snapshot.todoPlacement}
      shortcut={snapshot.quickAddShortcut}
      // Without the timeline there is no tall thing to take a share of, so a
      // percentage cap would be measured against a height this panel is
      // itself about to determine. A fixed ceiling cannot feed back.
      compact={!snapshot.showTimeline}
      onToggle={toggleTodo}
      onRoll={rollTodo}
      onRollAllOverdue={rollAllOverdueTodos}
      onRemove={removeTodo}
    />
  ) : null

  return (
    <div ref={contentRef} className="flex h-full flex-col bg-bg">
      <TitleBar
        pinned={pinned}
        privacyMode={snapshot.privacyMode}
        nowIso={snapshot.now}
        showTimeline={snapshot.showTimeline}
        showTodos={snapshot.showTodos}
        onTogglePin={togglePin}
        onToggleTimeline={toggleTimeline}
        onToggleTodos={toggleTodos}
        onHide={() => void widgetApi().hide()}
        onOpenSettings={() => void widgetApi().openSettings()}
      />

      {/* Never hidden: with both sections off this is the whole widget, and
          a panel that said nothing about the next meeting would be pointless. */}
      <NextUpBar nextUp={snapshot.nextUp} onJoin={join} />

      {snapshot.showTimeline && <AllDayStrip items={snapshot.allDay} />}

      {snapshot.todoPlacement === 'above' && todoPanel}

      {snapshot.showTimeline &&
        (!hasAccounts ? (
          <EmptyState message="No calendars connected yet. Open Settings to add one." />
        ) : useSplit ? (
          <SplitView snapshot={snapshot} onJoin={join} />
        ) : (
          <MergedView snapshot={snapshot} onJoin={join} />
        ))}

      {snapshot.todoPlacement === 'below' && todoPanel}

      <StatusStrip
        accounts={snapshot.accounts}
        nowIso={snapshot.now}
        onSync={() => void widgetApi().syncNow()}
      />
    </div>
  )
}

/**
 * Asks main to shrink the window to the content once the timeline is off
 * (docs/spec.md §6).
 *
 * The children are measured rather than the container, because the container
 * is sized to the window and would only ever report the height we are trying
 * to change. Runs after every render instead of watching for changes: the
 * reads are cheap, renders are rare, and main is only told when the number
 * actually moves.
 */
function useFitToContent(enabled: boolean, ref: RefObject<HTMLDivElement | null>): void {
  const lastSent = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      lastSent.current = null
      return
    }

    const element = ref.current
    if (!element) {
      return
    }

    let height = 0
    for (const child of element.children) {
      if (!(child instanceof HTMLElement)) {
        continue
      }
      height += child.offsetHeight
    }

    const target = Math.ceil(height)
    if (target <= 0 || target === lastSent.current) {
      return
    }

    lastSent.current = target
    void widgetApi().fitHeight(target)
  })
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
