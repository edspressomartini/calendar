import { useCallback, useEffect, useState } from 'react'
import type { AccountView, ConnectProblem } from '../../../shared/types/account.ts'
import type { ProviderKind } from '../../../shared/types/calendar.ts'
import { accountListSchema, connectAccountsResultSchema } from '../../../shared/ipc/contract.ts'
import { fetchAccounts, settingsApi } from '../lib/ipcClient.ts'

export interface AccountsState {
  readonly accounts: readonly AccountView[]
  readonly busy: boolean
  readonly error: string | null
  /**
   * Set when a sign-in added nothing and the response said why: macOS refused
   * or was never asked, or the helper could not be reached, answered too
   * late, disagreed with this build, or could not read the store. No account
   * exists in any of those cases, so the pane carries the explanation, and
   * the fix too when there is one (§7).
   */
  readonly connectProblem: ConnectProblem | null
  connect(provider: ProviderKind): Promise<void>
  reconnect(accountId: string): Promise<void>
  disconnect(accountId: string): Promise<void>
  setCalendars(accountId: string, calendarIds: string[]): Promise<void>
  openCalendarPrivacy(): Promise<void>
  reload(): Promise<void>
}

export function useAccounts(): AccountsState {
  const [accounts, setAccounts] = useState<readonly AccountView[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectProblem, setConnectProblem] = useState<ConnectProblem | null>(null)

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
    setConnectProblem(null)
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

  /**
   * Sign-in is the one action that can come back unanswered rather than
   * failed, and the two need different words: macOS refusing, or never being
   * asked, is not something that went wrong in the app.
   */
  const runConnect = useCallback(async (action: () => Promise<unknown>, message: string) => {
    setBusy(true)
    setError(null)
    setConnectProblem(null)
    try {
      const result = await action()
      const parsed = connectAccountsResultSchema.safeParse(result)
      if (!parsed.success) {
        setError(message)
        return
      }
      setAccounts(parsed.data.accounts)
      setConnectProblem(parsed.data.problem)
    } catch {
      setError(message)
    } finally {
      setBusy(false)
    }
  }, [])

  const connect = useCallback(
    async (provider: ProviderKind) => {
      await runConnect(
        () => settingsApi().connectAccount(provider),
        'Could not connect that account.',
      )
    },
    [runConnect],
  )

  const reconnect = useCallback(
    async (accountId: string) => {
      await runConnect(() => settingsApi().reconnectAccount(accountId), 'Could not reconnect.')
    },
    [runConnect],
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

  /**
   * Main rate-limits this channel, so a second click inside the window is
   * refused and the promise rejects. Handled here like every other action
   * rather than left to become an unhandled rejection.
   */
  const openCalendarPrivacy = useCallback(async () => {
    try {
      await settingsApi().openCalendarPrivacy()
      setError(null)
    } catch {
      setError('Could not open System Settings. Try again in a moment.')
    }
  }, [])

  return {
    accounts,
    busy,
    error,
    connectProblem,
    connect,
    reconnect,
    disconnect,
    setCalendars,
    openCalendarPrivacy,
    reload,
  }
}
