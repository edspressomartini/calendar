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
import { emptyPromptFor } from './emptyPrompt.ts'
import { MergedView } from './views/MergedView.tsx'
import { SplitView } from './views/SplitView.tsx'

export function WidgetApp(): JSX.Element {
  const snapshot = useAgenda()
  const todos = useTodos()
  const width = useWindowWidth()
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

  const reorderTodo = useCallback((todoId: string, afterId: string | null) => {
    void widgetApi().reorderTodo(todoId, afterId)
  }, [])

  // Like every other toggle here, the state lives in main and comes back on
  // the snapshot. Local state would start as a guess and drift the moment the
  // same setting was changed in the Settings window.
  const togglePin = useCallback(() => {
    if (!snapshot) {
      return
    }
    void widgetApi().setPinned(!snapshot.alwaysOnTop)
  }, [snapshot])

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

  const prompt = emptyPromptFor(snapshot.accounts)
  const hasAccounts = snapshot.accounts.length > 0
  // A day with nothing on it does not need an hour grid to say so. Drawing
  // one spends most of the widget on empty rules and pushes the TODO list
  // into whatever is left, which is the wrong way round when the list is the
  // only thing with anything in it.
  const clearDay = hasAccounts && snapshot.timed.length === 0 && snapshot.allDay.length === 0
  // Three narrow columns are unreadable, so split collapses to merged (§6).
  const useSplit = snapshot.viewMode === 'split' && width >= SPLIT_VIEW_MIN_WIDTH && hasAccounts

  const todoPanel = snapshot.showTodos ? (
    <TodoPanel
      snapshot={todos}
      shortcut={snapshot.quickAddShortcut}
      // Without the timeline there is no tall thing to take a share of, so a
      // percentage cap would be measured against a height this panel is
      // itself about to determine. A fixed ceiling cannot feed back.
      compact={!snapshot.showTimeline}
      // A clear day leaves the list as the only thing with content in it, so
      // the 45% cap would hold it to under half a widget that has nothing
      // else to show.
      uncapped={clearDay}
      onToggle={toggleTodo}
      onRoll={rollTodo}
      onRollAllOverdue={rollAllOverdueTodos}
      onRemove={removeTodo}
      onReorder={reorderTodo}
      onChangeShortcut={() => void widgetApi().openSettings('preferences')}
    />
  ) : null

  return (
    <div ref={contentRef} className="flex h-full flex-col bg-bg">
      <TitleBar
        pinned={snapshot.alwaysOnTop}
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

      {/* `flex flex-col` on the card is load-bearing, not decoration. The
          timeline sizes itself with flex-1 against this box and scrolls
          inside it; in a block container that resolves to content height, so
          the scroll container has nothing to overflow and `overflow-hidden`
          quietly clips the afternoon off instead. */}
      {snapshot.showTimeline && (
        <div
          className={`card mx-3 mb-2 flex flex-col overflow-hidden ${
            clearDay ? 'shrink-0' : 'min-h-0 flex-1'
          }`}
        >
          {prompt ? (
            <EmptyState
              message={prompt.message}
              actionLabel={prompt.actionLabel}
              onAction={() => void widgetApi().openSettings(prompt.tab)}
            />
          ) : clearDay ? (
            <EmptyState message="Nothing scheduled today" />
          ) : useSplit ? (
            <SplitView snapshot={snapshot} onJoin={join} />
          ) : (
            <MergedView snapshot={snapshot} onJoin={join} />
          )}
        </div>
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
      height += child.offsetHeight + verticalMargin(child)
    }

    const target = Math.ceil(height)
    if (target <= 0 || target === lastSent.current) {
      return
    }

    lastSent.current = target
    void widgetApi().fitHeight(target)
  })
}

/**
 * `offsetHeight` is border-box: it counts padding and border but not margin,
 * so the gaps between the section cards would be measured as nothing and the
 * window would come up short by the sum of them.
 */
function verticalMargin(element: HTMLElement): number {
  const style = getComputedStyle(element)
  const top = Number.parseFloat(style.marginTop)
  const bottom = Number.parseFloat(style.marginBottom)

  return (Number.isNaN(top) ? 0 : top) + (Number.isNaN(bottom) ? 0 : bottom)
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
