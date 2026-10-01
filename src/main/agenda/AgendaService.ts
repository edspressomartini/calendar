import type { AccountStatus } from '../../shared/types/account.ts'
import type { AgendaAccount, AgendaItem, AgendaSnapshot } from '../../shared/types/agenda.ts'
import type { AccountId, CalendarEvent, EventId } from '../../shared/types/calendar.ts'
import { dedupeForMergedView, partitionByAllDay, sortEvents } from '../calendar/EventAggregator.ts'
import { findNextUp, toAgendaItem } from '../calendar/EventEnricher.ts'
import { resolveDayWindow } from '../../shared/timeline.ts'
import { Signal } from '../infra/Signal.ts'
import type { SettingsReader } from '../storage/SettingsStore.ts'

interface AccountRuntime {
  status: AccountStatus
  lastSyncedAt: string | null
}

/**
 * Turns events plus "now" into the one snapshot that the widget, the menu bar
 * and notifications all render from (docs/spec.md §5).
 *
 * It also owns the only in-memory copy of meeting URLs: the join handler asks
 * here by event id, so no URL ever crosses IPC (§8.6).
 */
export class AgendaService {
  readonly snapshotChanged = new Signal<AgendaSnapshot>()

  private readonly eventsByAccount = new Map<AccountId, readonly CalendarEvent[]>()
  private readonly runtimeByAccount = new Map<AccountId, AccountRuntime>()
  private snapshot: AgendaSnapshot

  constructor(
    private readonly settings: SettingsReader,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.snapshot = this.build(this.now())
  }

  getSnapshot(): AgendaSnapshot {
    return this.snapshot
  }

  setEvents(accountId: AccountId, events: readonly CalendarEvent[]): void {
    this.eventsByAccount.set(accountId, events)
    this.refresh()
  }

  setStatus(accountId: AccountId, status: AccountStatus, lastSyncedAt?: string): void {
    const existing = this.runtimeByAccount.get(accountId)
    this.runtimeByAccount.set(accountId, {
      status,
      lastSyncedAt: lastSyncedAt ?? existing?.lastSyncedAt ?? null,
    })
    this.refresh()
  }

  getStatus(accountId: AccountId): AccountStatus {
    return this.runtimeByAccount.get(accountId)?.status ?? 'ready'
  }

  getLastSyncedAt(accountId: AccountId): string | null {
    return this.runtimeByAccount.get(accountId)?.lastSyncedAt ?? null
  }

  forget(accountId: AccountId): void {
    this.eventsByAccount.delete(accountId)
    this.runtimeByAccount.delete(accountId)
    this.refresh()
  }

  /** The join path: a renderer sends an id, main resolves the URL (§8.6). */
  findConferenceUrl(eventId: EventId): string | null {
    for (const events of this.eventsByAccount.values()) {
      const match = events.find((event) => event.id === eventId)
      if (match?.conferenceUrl) {
        return match.conferenceUrl
      }
    }
    return null
  }

  refresh(at?: Date): AgendaSnapshot {
    this.snapshot = this.build(at ?? this.now())
    this.snapshotChanged.emit(this.snapshot)
    return this.snapshot
  }

  private build(now: Date): AgendaSnapshot {
    const settings = this.settings.getSettings()
    const accounts = settings.accounts
    const colourByAccount = new Map(accounts.map((account) => [account.id, account.colour]))
    const accountOrder = accounts.map((account) => account.id)

    const all = accountOrder.flatMap((accountId) => this.eventsByAccount.get(accountId) ?? [])
    const visible =
      settings.viewMode === 'merged' ? dedupeForMergedView(all, accountOrder) : sortEvents(all)
    const { timed, allDay } = partitionByAllDay(visible)

    const enrich = (event: CalendarEvent): AgendaItem =>
      toAgendaItem(event, {
        now,
        colour: colourByAccount.get(event.accountId) ?? 'sky',
        privacyMode: settings.privacyMode,
      })

    const timedItems = timed.map(enrich)

    const agendaAccounts: AgendaAccount[] = accounts.map((account) => ({
      id: account.id,
      label: account.label,
      colour: account.colour,
      status: this.getStatus(account.id),
      lastSyncedAt: this.getLastSyncedAt(account.id),
    }))

    const window = resolveDayWindow(now, timed, {
      startHour: settings.dayStartHour,
      endHour: settings.dayEndHour,
    })

    return {
      now: now.toISOString(),
      window: {
        start: new Date(window.startMs).toISOString(),
        end: new Date(window.endMs).toISOString(),
      },
      secondaryTimeZone: settings.secondaryTimeZone,
      timed: timedItems,
      allDay: allDay.map(enrich),
      accounts: agendaAccounts,
      nextUp: findNextUp(timedItems),
      viewMode: settings.viewMode,
      todoPlacement: settings.todoPlacement,
      quickAddShortcut: settings.quickAddShortcut,
      privacyMode: settings.privacyMode,
    }
  }
}
