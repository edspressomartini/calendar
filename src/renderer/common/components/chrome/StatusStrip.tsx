import type { JSX } from 'react'
import type { AgendaAccount } from '../../../../shared/types/agenda.ts'
import { formatRelativeSync } from '../../lib/formatTime.ts'

interface StatusStripProps {
  readonly accounts: readonly AgendaAccount[]
  readonly nowIso: string
  readonly onSync: () => void
}

/**
 * Quiet by design (docs/spec.md §7): a failed sync changes this line, never
 * the agenda above it.
 *
 * It doubles as the refresh control, because "how fresh is this" and "fetch
 * it again" are the same thought.
 */
export function StatusStrip({ accounts, nowIso, onSync }: StatusStripProps): JSX.Element | null {
  if (accounts.length === 0) {
    return null
  }

  const needsReauth = accounts.filter((account) => account.status === 'needsReauth')
  const offline = accounts.filter((account) => account.status === 'offline')
  const syncing = accounts.some((account) => account.status === 'syncing')

  const message = (() => {
    if (syncing) {
      return 'Syncing…'
    }
    if (needsReauth.length > 0) {
      return `${needsReauth.map((account) => account.label).join(', ')} needs reconnecting`
    }
    if (offline.length > 0) {
      return 'Offline — showing last known events'
    }
    const lastSynced = accounts
      .map((account) => account.lastSyncedAt)
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1)
    return formatRelativeSync(lastSynced ?? null, nowIso)
  })()

  const tone = needsReauth.length > 0 ? 'text-urgent' : 'text-text-muted'

  return (
    <footer className="flex items-center gap-2 px-3 py-1.5">
      <span className={`min-w-0 flex-1 truncate text-body ${tone}`}>{message}</span>
      <button
        type="button"
        onClick={onSync}
        disabled={syncing}
        title="Check for changes now"
        className="no-drag shrink-0 rounded-full px-1.5 py-0.5 text-body text-text-muted hover:bg-bg-subtle hover:text-accent disabled:opacity-40"
      >
        {syncing ? '…' : 'Sync'}
      </button>
    </footer>
  )
}
