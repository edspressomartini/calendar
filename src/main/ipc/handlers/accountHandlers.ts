import { shell } from 'electron'
import { CHANNELS } from '../../../shared/ipc/channels.ts'
import type { AccountColour } from '../../../shared/types/account.ts'
import { ACCOUNT_COLOURS } from '../../../shared/constants.ts'
import type { AccountService } from '../../calendar/AccountService.ts'
import type { IpcRouter } from '../IpcRouter.ts'

/**
 * The Calendars pane of Privacy & Security. A fixed constant, never built
 * from anything the renderer sends (§8.6).
 */
const CALENDAR_PRIVACY_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars'

export interface AccountHandlerDeps {
  readonly accounts: AccountService
}

export function registerAccountHandlers(router: IpcRouter, deps: AccountHandlerDeps): void {
  router.handle(CHANNELS.accountsList, () => deps.accounts.list())

  router.handle(
    CHANNELS.accountsConnect,
    async ({ provider }) => await deps.accounts.connect(provider),
  )

  router.handle(
    CHANNELS.accountsReconnect,
    async ({ accountId }) => await deps.accounts.reconnect(accountId),
  )

  router.handle(
    CHANNELS.accountsDisconnect,
    async ({ accountId }) => await deps.accounts.disconnect(accountId),
  )

  router.handle(CHANNELS.accountsUpdate, ({ accountId, label, colour }) => {
    return deps.accounts.update(accountId, {
      ...(label === undefined ? {} : { label }),
      ...(colour === undefined ? {} : { colour: asColour(colour) }),
    })
  })

  router.handle(CHANNELS.accountsOpenCalendarPrivacy, async () => {
    await shell.openExternal(CALENDAR_PRIVACY_URL)
  })

  router.handle(
    CHANNELS.calendarsList,
    async ({ accountId }) => await deps.accounts.listCalendars(accountId),
  )

  router.handle(
    CHANNELS.calendarsSetSelected,
    async ({ accountId, calendarIds }) => await deps.accounts.setCalendars(accountId, calendarIds),
  )
}

/** The schema already narrowed this; the lookup keeps the type honest. */
function asColour(candidate: string): AccountColour {
  return ACCOUNT_COLOURS.find((colour) => colour === candidate) ?? 'sky'
}
