import type { JSX } from 'react'
import type { AccountView } from '../../../shared/types/account.ts'
import { Badge } from '../../common/components/ui/Badge.tsx'
import { Spinner } from '../../common/components/ui/Spinner.tsx'
import type { AccountsState } from '../../common/hooks/useAccounts.ts'
import { settingsApi } from '../../common/lib/ipcClient.ts'

interface AccountsViewProps {
  readonly state: AccountsState
}

const STATUS_LABEL: Record<AccountView['status'], string> = {
  ready: 'Connected',
  syncing: 'Syncing…',
  offline: 'Offline',
  needsReauth: 'Needs reconnecting',
}

export function AccountsView({ state }: AccountsViewProps): JSX.Element {
  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <h2 className="flex-1 text-base font-medium">Accounts</h2>
        <button
          type="button"
          disabled={state.busy}
          onClick={() => void state.connect('eventkit')}
          className="rounded border border-border px-3 py-1 text-xs text-accent hover:bg-accent/10 disabled:opacity-50"
        >
          Use Apple Calendar
        </button>
        <button
          type="button"
          disabled={state.busy}
          onClick={() => void state.connect('google')}
          className="rounded border border-border px-3 py-1 text-xs text-accent hover:bg-accent/10 disabled:opacity-50"
        >
          Connect Google account
        </button>
        {state.busy && <Spinner />}
      </header>

      {state.error && <p className="text-xs text-urgent">{state.error}</p>}

      {state.accounts.length === 0 ? (
        <p className="text-sm text-text-muted">
          No accounts yet. Apple Calendar reads whatever accounts this Mac already syncs — iCloud,
          Exchange, anything in Calendar.app — and never leaves the machine. Connecting Google
          instead opens your browser to sign in; the app never sees your password.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {state.accounts.map((account) => (
            <li
              key={account.id}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{account.label}</p>
                <p className="text-xs text-text-muted">
                  {account.calendarIds.length} calendar
                  {account.calendarIds.length === 1 ? '' : 's'} selected
                </p>
              </div>

              <Badge tone={account.status === 'needsReauth' ? 'urgent' : 'neutral'}>
                {STATUS_LABEL[account.status]}
              </Badge>

              {account.status === 'needsReauth' &&
                (account.provider === 'eventkit' ? (
                  <button
                    type="button"
                    onClick={() => void settingsApi().openCalendarPrivacy()}
                    className="rounded border border-border px-2 py-1 text-xs text-accent hover:bg-accent/10"
                  >
                    Open Calendar privacy settings
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={state.busy}
                    onClick={() => void state.reconnect(account.id)}
                    className="rounded border border-border px-2 py-1 text-xs text-accent hover:bg-accent/10 disabled:opacity-50"
                  >
                    Reconnect
                  </button>
                ))}

              <button
                type="button"
                disabled={state.busy}
                onClick={() => void state.disconnect(account.id)}
                className="rounded border border-border px-2 py-1 text-xs text-urgent hover:bg-urgent/10 disabled:opacity-50"
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-text-muted">
        Disconnecting a Google account revokes the token, then deletes it from this Mac. Apple
        Calendar accounts have no token to revoke; macOS keeps the permission until you remove it in
        System Settings.
      </p>
    </section>
  )
}
