import { useCallback, useEffect, useState } from 'react'
import type { AccountView } from '../../../shared/types/account.ts'
import type { ProviderKind } from '../../../shared/types/calendar.ts'
import { accountListSchema } from '../../../shared/ipc/contract.ts'
import { fetchAccounts, settingsApi } from '../lib/ipcClient.ts'

export interface AccountsState {
  readonly accounts: readonly AccountView[]
  readonly busy: boolean
  readonly error: string | null
  connect(provider: ProviderKind): Promise<void>
  reconnect(accountId: string): Promise<void>
  disconnect(accountId: string): Promise<void>
  setCalendars(accountId: string, calendarIds: string[]): Promise<void>
  reload(): Promise<void>
}

export function useAccounts(): AccountsState {
  const [accounts, setAccounts] = useState<readonly AccountView[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const next = await fetchAccounts()
    setAccounts(next)
  }, [])

  // State is set from the IPC callback, and dropped if the window closed first.
  useEffect(() => {
    let active = true
    fetchAccounts()
      .then((next) => {
        if (active) {
          setAccounts(next)
        }
      })
      .catch(() => {
        if (active) {
          setError('Could not load accounts.')
        }
      })
    return () => {
      active = false
    }
  }, [])

  /** Sign-in opens a browser and can take a while, so every action is guarded. */
  const run = useCallback(async (action: () => Promise<unknown>, message: string) => {
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      const parsed = accountListSchema.safeParse(result)
      if (parsed.success) {
        setAccounts(parsed.data)
      }
    } catch {
      setError(message)
    } finally {
      setBusy(false)
    }
  }, [])

  const connect = useCallback(
    async (provider: ProviderKind) => {
      await run(() => settingsApi().connectAccount(provider), 'Could not connect that account.')
    },
    [run],
  )

  const reconnect = useCallback(
    async (accountId: string) => {
      await run(() => settingsApi().reconnectAccount(accountId), 'Could not reconnect.')
    },
    [run],
  )

  const disconnect = useCallback(
    async (accountId: string) => {
      await run(() => settingsApi().disconnectAccount(accountId), 'Could not disconnect.')
    },
    [run],
  )

  const setCalendars = useCallback(
    async (accountId: string, calendarIds: string[]) => {
      await run(
        () => settingsApi().setSelectedCalendars(accountId, calendarIds),
        'Could not save calendar selection.',
      )
    },
    [run],
  )

  return { accounts, busy, error, connect, reconnect, disconnect, setCalendars, reload }
}
