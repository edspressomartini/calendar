import type { JSX } from 'react'

interface EmptyStateProps {
  readonly message: string
  /** Both or neither: a button with no handler is a lie. */
  readonly actionLabel?: string
  readonly onAction?: () => void
}

/** Centred muted line, generous whitespace (docs/spec.md §6). */
export function EmptyState({ message, actionLabel, onAction }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center text-text-muted">
      <span>{message}</span>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="no-drag rounded-full border border-border px-3 py-1 text-body text-accent hover:bg-accent/10"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
