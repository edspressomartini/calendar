import { useCallback, useEffect, useState } from 'react'
import type { AccountView, CalendarAccessProblem } from '../../../shared/types/account.ts'
import type { ProviderKind } from '../../../shared/types/calendar.ts'
import { accountListSchema, connectAccountsResultSchema } from '../../../shared/ipc/contract.ts'
import { fetchAccounts, settingsApi } from '../lib/ipcClient.ts'

export interface AccountsState {
  readonly accounts: readonly AccountView[]
  readonly busy: boolean
  readonly error: string | null
  /**
   * Set when macOS handed over no calendar access during sign-in — refused, or
   * never asked at all. No account exists in that case, so the pane carries
   * the explanation, and the fix too when there is one (§7).
   */
  readonly calendarAccessProblem: CalendarAccessProblem | null
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
  const [calendarAccessProblem, setCalendarAccessProblem] = useState<CalendarAccessProblem | null>(
    null,
  )

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
    setCalendarAccessProblem(null)
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
    setCalendarAccessProblem(null)
    try {
      const result = await action()
      const parsed = connectAccountsResultSchema.safeParse(result)
      if (!parsed.success) {
        setError(message)
        return
      }
      setAccounts(parsed.data.accounts)
      setCalendarAccessProblem(parsed.data.accessProblem)
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
    calendarAccessProblem,
    connect,
    reconnect,
    disconnect,
    setCalendars,
    openCalendarPrivacy,
    reload,
  }
}
