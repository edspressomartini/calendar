import type { JSX } from 'react'
import { formatClockTime, formatDayLabel } from '../../lib/formatTime.ts'

interface TitleBarProps {
  readonly pinned: boolean
  readonly privacyMode: boolean
  readonly nowIso: string
  readonly showTimeline: boolean
  readonly showTodos: boolean
  readonly onTogglePin: () => void
  readonly onToggleTimeline: () => void
  readonly onToggleTodos: () => void
  readonly onHide: () => void
  readonly onOpenSettings: () => void
}

/**
 * Drag region plus the controls the widget needs (docs/spec.md §6).
 * "Minimise" hides to the menu bar: there is no Dock icon to fall into.
 *
 * The two section toggles live here rather than in Settings because the whole
 * point of them is turning a section off for the next ten minutes. The day
 * label gives up its width first, so the buttons survive the 260px minimum.
 */
export function TitleBar({
  pinned,
  privacyMode,
  nowIso,
  showTimeline,
  showTodos,
  onTogglePin,
  onToggleTimeline,
  onToggleTodos,
  onHide,
  onOpenSettings,
}: TitleBarProps): JSX.Element {
  return (
    // The card is not decoration here. This was the one strip left sitting on
    // bare glass, which over a chat or an editor put the window behind it
    // directly underneath the date. The margin stays draggable, so the grab
    // area changes shape rather than shrinking.
    <header className="card drag-region mx-3 mt-2 mb-2 flex items-center gap-1.5 px-2.5 py-1.5">
      {/* The clock anchors the timeline below it (§6). */}
      <span className="tabular shrink-0 font-mono text-display leading-none font-semibold tracking-tight">
        {formatClockTime(nowIso)}
      </span>
      <span className="min-w-0 flex-1 truncate text-small text-text-muted">
        {formatDayLabel(nowIso)}
        {privacyMode ? ' · private' : ''}
      </span>

      <TitleBarButton
        label="Cal"
        title={showTimeline ? 'Hide the timeline' : 'Show the timeline'}
        active={showTimeline}
        onClick={onToggleTimeline}
      />
      <TitleBarButton
        label="Todo"
        title={showTodos ? 'Hide the TODO list' : 'Show the TODO list'}
        active={showTodos}
        onClick={onToggleTodos}
      />
      <TitleBarButton
        label={pinned ? 'Unpin' : 'Pin'}
        title={pinned ? 'Stop floating on top' : 'Float on top'}
        active={pinned}
        onClick={onTogglePin}
      />
      <TitleBarButton label="Settings" title="Open settings" onClick={onOpenSettings} />
      <TitleBarButton label="Hide" title="Hide to the menu bar" onClick={onHide} />
    </header>
  )
}

interface TitleBarButtonProps {
  readonly label: string
  readonly title: string
  readonly active?: boolean
  readonly onClick: () => void
}

function TitleBarButton({ label, title, active, onClick }: TitleBarButtonProps): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      // Every button here that carries `active` is a toggle, so the state is
      // announced rather than being left to the colour alone.
      aria-pressed={active}
      onClick={onClick}
      // Buttons must opt out of the drag region or they cannot be clicked (§10).
      className={`no-drag rounded-full px-1.5 py-0.5 text-body hover:bg-bg-subtle ${
        active ? 'text-accent' : 'text-text-muted'
      }`}
    >
      {label}
    </button>
  )
}
